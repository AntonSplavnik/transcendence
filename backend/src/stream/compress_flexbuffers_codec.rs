//! Stream codecs for efficient binary serialization over the network using FlexBuffers.
//!
//! This module provides [`CompressedFlexEncoder`] and [`CompressedFlexDecoder`],
//! length-delimited codecs that combine:
//! - **FlexBuffers serialization** via [flexbuffers](https://docs.rs/flexbuffers) for
//!   schema-less binary encoding with self-describing data and random-access support
//! - **Zstd compression** (optional) for payloads exceeding a configurable threshold
//! - **Adaptive buffering** to prevent memory bloat from rare large messages
//!
//! FlexBuffers is the schema-less cousin of FlatBuffers. It uses serde for
//! serialization/deserialization and supports self-describing binary data, making
//! it a compact alternative to JSON/CBOR without requiring a schema.
//!
//! # Wire Format
//!
//! Each frame on the wire has the following structure:
//!
//! ```text
//! ┌─────────────┬───────────┬────────────────────┐
//! │ total_len   │  flags    │       payload      │
//! │   (4 bytes) │  (1 byte) │  (variable length) │
//! └─────────────┴───────────┴────────────────────┘
//! ```
//!
//! - **`total_len`** (u32, big-endian): Length of `flags + payload`
//! - **`flags`** (u8): `0x00` = uncompressed FlexBuffers, `0x01` = Zstd-compressed
//! - **`payload`**: Raw or compressed FlexBuffers data
//!
//! # Usage Example
//!
//! ```ignore
//! use tokio_util::codec::{FramedRead, FramedWrite};
//! use your_crate::stream::compress_flexbuffers_codec::{CompressedFlexEncoder, CompressedFlexDecoder};
//!
//! // Wrap an AsyncWrite for sending messages
//! let sink = FramedWrite::new(writer, CompressedFlexEncoder::<MyMessage>::new());
//!
//! // Wrap an AsyncRead for receiving messages
//! let stream = FramedRead::new(reader, CompressedFlexDecoder::<MyMessage>::new());
//! ```
//!
//! # Compression Behavior
//!
//! Compression is applied only when the serialized FlexBuffers payload exceeds
//! [`COMPRESS_THRESHOLD`] bytes (default: 1 KiB). This avoids the overhead of
//! compressing small messages where the savings would be negligible.
//!
//! # Security
//!
//! The decoder enforces a maximum frame size (`MAX_DECODE_FRAME`, default: 8 MiB)
//! to prevent denial-of-service attacks via memory exhaustion.

use std::io::{Read, Write};
use std::marker::PhantomData;

use bytes::{Buf, BufMut, BytesMut};
use serde::{Serialize, de::DeserializeOwned};
use tokio_util::codec::{Decoder, Encoder};

use super::compress_cbor_codec::CodecBufferParams;
use crate::utils::adaptive_buffer::{AdaptiveBuffer, BufferParams};

// =============================================================================
// Constants
// =============================================================================

/// Minimum FlexBuffers payload size (in bytes) before Zstd compression is applied.
const COMPRESS_THRESHOLD: usize = 1024;

/// Zstd compression level (1-22, where higher = better compression but slower).
const COMPRESS_LEVEL: i32 = 3;

// =============================================================================
// CompressedFlexEncoder
// =============================================================================

/// An encoder that serializes types using FlexBuffers with optional Zstd compression.
///
/// This encoder implements [`Encoder`] from `tokio_util::codec`,
/// making it suitable for use with `FramedWrite`.
///
/// # Wire Format
///
/// ```text
/// [total_len: u32 BE][flags: u8][payload: bytes]
/// ```
///
/// - **`total_len`**: Length of everything after this field (flags + payload)
/// - **`flags`**: `0x00` = uncompressed, `0x01` = Zstd-compressed
/// - **`payload`**: The FlexBuffers data (raw or compressed)
///
/// # Memory Management
///
/// The internal [`FlexbufferSerializer`](flexbuffers::FlexbufferSerializer) is
/// reused across calls via `reset()`, preserving its buffer capacity. The Zstd
/// compression buffer uses [`AdaptiveBuffer`] to automatically shrink after
/// processing rare large messages.
///
/// # Type Parameters
/// - `T`: The type to serialize (must implement [`Serialize`])
/// - `BP`: Buffer parameters implementing [`BufferParams`] (default: [`CodecBufferParams`])
pub struct CompressedFlexEncoder<T, BP: BufferParams = CodecBufferParams> {
    /// Reusable FlexBuffers serializer (reset between calls to keep capacity).
    serializer: flexbuffers::FlexbufferSerializer,
    /// Temporary buffer for Zstd-compressed output.
    compress_buf: AdaptiveBuffer<u8, BP>,
    /// Marker for the message type `T`.
    _phantom: PhantomData<T>,
}

impl<T, BP: BufferParams> CompressedFlexEncoder<T, BP> {
    /// Creates a new encoder with default buffer capacities.
    #[must_use]
    pub fn new() -> Self {
        Self {
            serializer: flexbuffers::FlexbufferSerializer::new(),
            compress_buf: AdaptiveBuffer::new(),
            _phantom: PhantomData,
        }
    }
}

impl<T, BP: BufferParams> Default for CompressedFlexEncoder<T, BP> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Serialize, BP: BufferParams> Encoder<T> for CompressedFlexEncoder<T, BP> {
    type Error = anyhow::Error;

    fn encode(&mut self, item: T, dst: &mut BytesMut) -> Result<(), Self::Error> {
        // Step 1: Reset the serializer to reuse its internal buffer allocation
        self.serializer.reset();

        // Step 2: Serialize the item to FlexBuffers format
        item.serialize(&mut self.serializer)?;
        let serialized = self.serializer.view();

        // Step 3: Decide whether to compress based on payload size
        let (payload, flags) = if serialized.len() > COMPRESS_THRESHOLD {
            // Compress with Zstd
            let mut encoder = zstd::Encoder::new(self.compress_buf.as_mut_vec(), COMPRESS_LEVEL)?;
            encoder.write_all(serialized)?;
            encoder.finish()?;
            (self.compress_buf.as_vec().as_slice(), 1u8)
        } else {
            (serialized, 0u8)
        };

        // Step 4: Write the length-prefixed frame to the output buffer
        let total_len = 1 + payload.len();
        dst.reserve(4 + total_len);
        dst.put_u32(total_len as u32);
        dst.put_u8(flags);
        dst.extend_from_slice(payload);

        // Step 5: Reset compression buffer for next message (may trigger shrinking)
        if flags == 1u8 {
            self.compress_buf.finish();
        }

        Ok(())
    }
}

// =============================================================================
// CompressedFlexDecoder
// =============================================================================

/// A decoder that deserializes types using FlexBuffers with optional Zstd decompression.
///
/// This decoder implements [`Decoder`] from `tokio_util::codec`,
/// making it suitable for use with `FramedRead`.
///
/// # Wire Format
///
/// ```text
/// [total_len: u32 BE][flags: u8][payload: bytes]
/// ```
///
/// - **`total_len`**: Length of everything after this field (flags + payload)
/// - **`flags`**: `0x00` = uncompressed, `0x01` = Zstd-compressed
/// - **`payload`**: The FlexBuffers data (raw or compressed)
///
/// # Memory Management
///
/// Stores a reusable decompression buffer ([`AdaptiveBuffer`]) to avoid
/// per-message allocations when processing compressed frames. Uncompressed
/// frames are deserialized directly from the transport buffer with zero extra
/// allocations.
///
/// # Type Parameters
/// - `T`: The type to deserialize (must implement [`DeserializeOwned`])
///
/// # Const Generics
/// - `MAX_DECODE_FRAME`: Maximum allowed frame size for decoding (default: 8 MiB).
pub struct CompressedFlexDecoder<T, const MAX_DECODE_FRAME: usize = { 8 * 1024 * 1024 }> {
    /// Reusable buffer for Zstd decompression output.
    decompress_buf: AdaptiveBuffer<u8, CodecBufferParams>,
    /// Marker for the message type `T`.
    _phantom: PhantomData<T>,
}

impl<T, const MAX_DECODE_FRAME: usize> CompressedFlexDecoder<T, MAX_DECODE_FRAME> {
    /// Creates a new decoder.
    #[must_use]
    pub fn new() -> Self {
        Self {
            decompress_buf: AdaptiveBuffer::new(),
            _phantom: PhantomData,
        }
    }
}

impl<T, const MAX_DECODE_FRAME: usize> Default for CompressedFlexDecoder<T, MAX_DECODE_FRAME> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: DeserializeOwned, const MAX_DECODE_FRAME: usize> Decoder
    for CompressedFlexDecoder<T, MAX_DECODE_FRAME>
{
    type Item = T;
    type Error = anyhow::Error;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Self::Item>, Self::Error> {
        // Step 1: Check if we have enough bytes for the length prefix
        const LEN_PREFIX_SIZE: usize = 4;
        if src.len() < LEN_PREFIX_SIZE {
            return Ok(None);
        }

        // PEEK total_len (don't consume yet)
        let total_len = u32::from_be_bytes(src[..4].try_into()?) as usize;

        // Step 2: Validate frame size to prevent DoS attacks
        if total_len > MAX_DECODE_FRAME {
            return Err(anyhow::anyhow!(
                "Frame size {} exceeds maximum allowed size {}",
                total_len,
                MAX_DECODE_FRAME
            ));
        }
        if total_len < 1 {
            return Err(anyhow::anyhow!(
                "Invalid frame: total_len must be at least 1 (for flags byte), got {}",
                total_len
            ));
        }

        // Step 3: Check if we have the complete frame
        let frame_size = LEN_PREFIX_SIZE + total_len;
        if src.len() < frame_size {
            src.reserve(frame_size - src.len());
            return Ok(None);
        }

        // Step 4: Consume the length prefix
        src.advance(LEN_PREFIX_SIZE);

        // Step 5: Extract flags and payload
        let flags = src.get_u8();
        let payload_len = total_len - 1;

        // Step 6: Deserialize based on compression flag
        let item = match flags {
            1 => {
                // Compressed: decompress into reusable buffer, then deserialize
                let compressed_data = src.split_to(payload_len);
                let mut decoder = zstd::Decoder::new(compressed_data.reader())?;
                decoder.read_to_end(self.decompress_buf.as_mut_vec())?;
                let result = flexbuffers::from_slice(&self.decompress_buf)?;
                self.decompress_buf.finish();
                result
            }
            0 => {
                // Uncompressed: deserialize directly from transport buffer
                let raw_data = src.split_to(payload_len);
                flexbuffers::from_slice(&raw_data)?
            }
            unknown => {
                return Err(anyhow::anyhow!(
                    "Unknown frame flags: {} (expected 0 or 1)",
                    unknown
                ));
            }
        };

        Ok(Some(item))
    }
}
