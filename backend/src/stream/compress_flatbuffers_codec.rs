//! Stream codecs for efficient FlatBuffers binary transport over the network.
//!
//! This module provides [`CompressedFlatEncoder`] and [`CompressedFlatDecoder`],
//! length-delimited codecs that combine:
//! - **FlatBuffers zero-copy** binary data — the encoder accepts pre-serialized bytes
//!   and the decoder returns raw bytes suitable for direct `flatbuffers::root::<T>()` access
//! - **Zstd compression** (optional) for payloads exceeding a configurable threshold
//! - **Adaptive buffering** on the encoder side to prevent memory bloat
//!
//! Unlike the CBOR and FlexBuffers codecs, this codec operates on raw byte slices
//! rather than serde types. FlatBuffers uses schema-generated code with its own
//! `Follow`/`Verifiable` traits, so the user is responsible for building and
//! verifying FlatBuffer data.
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
//! - **`flags`** (u8): `0x00` = uncompressed FlatBuffers, `0x01` = Zstd-compressed
//! - **`payload`**: Raw or compressed FlatBuffers data
//!
//! # Usage Example
//!
//! ```ignore
//! use bytes::Bytes;
//! use tokio_util::codec::{FramedRead, FramedWrite};
//! use your_crate::stream::compress_flatbuffers_codec::{CompressedFlatEncoder, CompressedFlatDecoder};
//!
//! // Build a FlatBuffer message
//! let mut builder = flatbuffers::FlatBufferBuilder::new();
//! // ... build your message ...
//! let data = Bytes::copy_from_slice(builder.finished_data());
//!
//! // Wrap an AsyncWrite for sending pre-built FlatBuffer bytes
//! let sink = FramedWrite::new(writer, CompressedFlatEncoder::<Bytes>::new());
//!
//! // Wrap an AsyncRead for receiving raw FlatBuffer bytes
//! let stream = FramedRead::new(reader, CompressedFlatDecoder::new());
//! // Then verify & access: let msg = flatbuffers::root::<MyMessage>(&received_bytes)?;
//! ```
//!
//! # Compression Behavior
//!
//! Compression is applied only when the FlatBuffer payload exceeds
//! [`COMPRESS_THRESHOLD`] bytes (default: 1 KiB).
//!
//! # Zero-Copy Design
//!
//! - **Encoder**: No serialization step — data is already in FlatBuffers wire format.
//!   Only a compression buffer is needed for large payloads.
//! - **Decoder (uncompressed)**: Returns a `Bytes` view directly from the transport
//!   buffer via `split_to` + `freeze` — true zero-copy from network to FlatBuffers access.
//! - **Decoder (compressed)**: Decompresses into a fresh `Vec<u8>` wrapped as `Bytes`.
//!   Exactly one allocation per compressed message with no extra copies.
//!
//! # Security
//!
//! The decoder enforces a maximum frame size (`MAX_DECODE_FRAME`, default: 8 MiB)
//! to prevent denial-of-service attacks via memory exhaustion. Callers should
//! additionally verify the returned bytes with `flatbuffers::root::<T>()` before use.

use std::io::{Read, Write};
use std::marker::PhantomData;

use bytes::{Buf, BufMut, Bytes, BytesMut};
use tokio_util::codec::{Decoder, Encoder};

use super::compress_cbor_codec::CodecBufferParams;
use crate::utils::adaptive_buffer::{AdaptiveBuffer, BufferParams};

// =============================================================================
// Constants
// =============================================================================

/// Minimum FlatBuffer payload size (in bytes) before Zstd compression is applied.
const COMPRESS_THRESHOLD: usize = 1024;

/// Zstd compression level (1-22, where higher = better compression but slower).
const COMPRESS_LEVEL: i32 = 3;

// =============================================================================
// CompressedFlatEncoder
// =============================================================================

/// An encoder that frames pre-serialized FlatBuffer bytes with optional Zstd compression.
///
/// This encoder implements [`Encoder<T>`] from `tokio_util::codec` where
/// `T: AsRef<[u8]>`, making it suitable for use with `FramedWrite`.
///
/// Since FlatBuffer data is already serialized (via `FlatBufferBuilder`), this
/// encoder skips the serialization step entirely — it only handles framing and
/// optional compression.
///
/// # Wire Format
///
/// ```text
/// [total_len: u32 BE][flags: u8][payload: bytes]
/// ```
///
/// - **`total_len`**: Length of everything after this field (flags + payload)
/// - **`flags`**: `0x00` = uncompressed, `0x01` = Zstd-compressed
/// - **`payload`**: The FlatBuffer data (raw or compressed)
///
/// # Memory Management
///
/// Only requires a compression buffer ([`AdaptiveBuffer`]) for large payloads.
/// No serialization buffer is needed since data arrives pre-serialized.
///
/// # Type Parameters
/// - `T`: The byte container type (e.g., `Bytes`, `Vec<u8>`) — must implement `AsRef<[u8]>`
/// - `BP`: Buffer parameters implementing [`BufferParams`] (default: [`CodecBufferParams`])
pub struct CompressedFlatEncoder<T = Bytes, BP: BufferParams = CodecBufferParams> {
    /// Temporary buffer for Zstd-compressed output.
    compress_buf: AdaptiveBuffer<u8, BP>,
    /// Marker for the byte container type `T`.
    _phantom: PhantomData<T>,
}

impl<T, BP: BufferParams> CompressedFlatEncoder<T, BP> {
    /// Creates a new encoder with default buffer capacities.
    #[must_use]
    pub fn new() -> Self {
        Self {
            compress_buf: AdaptiveBuffer::new(),
            _phantom: PhantomData,
        }
    }
}

impl<T, BP: BufferParams> Default for CompressedFlatEncoder<T, BP> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: AsRef<[u8]>, BP: BufferParams> Encoder<T> for CompressedFlatEncoder<T, BP> {
    type Error = anyhow::Error;

    fn encode(&mut self, item: T, dst: &mut BytesMut) -> Result<(), Self::Error> {
        let data = item.as_ref();

        // Step 1: Decide whether to compress based on payload size
        let (payload, flags) = if data.len() > COMPRESS_THRESHOLD {
            // Compress with Zstd
            let mut encoder = zstd::Encoder::new(self.compress_buf.as_mut_vec(), COMPRESS_LEVEL)?;
            encoder.write_all(data)?;
            encoder.finish()?;
            (self.compress_buf.as_vec().as_slice(), 1u8)
        } else {
            // Send uncompressed — no intermediate buffer needed
            (data, 0u8)
        };

        // Step 2: Write the length-prefixed frame to the output buffer
        let total_len = 1 + payload.len();
        dst.reserve(4 + total_len);
        dst.put_u32(total_len as u32);
        dst.put_u8(flags);
        dst.extend_from_slice(payload);

        // Step 3: Reset compression buffer for next message (may trigger shrinking)
        if flags == 1u8 {
            self.compress_buf.finish();
        }

        Ok(())
    }
}

// =============================================================================
// CompressedFlatDecoder
// =============================================================================

/// A decoder that extracts FlatBuffer bytes with optional Zstd decompression.
///
/// This decoder implements [`Decoder`] from `tokio_util::codec`,
/// making it suitable for use with `FramedRead`. Returns [`Bytes`] containing
/// the raw FlatBuffer data, ready for zero-copy verification and access via
/// `flatbuffers::root::<T>()`.
///
/// # Wire Format
///
/// ```text
/// [total_len: u32 BE][flags: u8][payload: bytes]
/// ```
///
/// - **`total_len`**: Length of everything after this field (flags + payload)
/// - **`flags`**: `0x00` = uncompressed, `0x01` = Zstd-compressed
/// - **`payload`**: The FlatBuffer data (raw or compressed)
///
/// # Zero-Copy Path
///
/// For uncompressed frames, the decoder returns a `Bytes` slice directly from the
/// transport buffer — no copies, no allocations. For compressed frames, exactly one
/// `Vec<u8>` allocation is made for decompression output.
///
/// # Const Generics
/// - `MAX_DECODE_FRAME`: Maximum allowed frame size for decoding (default: 8 MiB).
pub struct CompressedFlatDecoder<const MAX_DECODE_FRAME: usize = { 8 * 1024 * 1024 }>;

impl<const MAX_DECODE_FRAME: usize> CompressedFlatDecoder<MAX_DECODE_FRAME> {
    /// Creates a new decoder.
    ///
    /// The decoder is stateless — no internal buffers are allocated.
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

impl<const MAX_DECODE_FRAME: usize> Default for CompressedFlatDecoder<MAX_DECODE_FRAME> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const MAX_DECODE_FRAME: usize> Decoder for CompressedFlatDecoder<MAX_DECODE_FRAME> {
    type Item = Bytes;
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

        // Step 6: Extract bytes based on compression flag
        let bytes = match flags {
            1 => {
                // Compressed: decompress into a fresh Vec, wrap as Bytes (zero-copy wrap)
                let compressed_data = src.split_to(payload_len);
                let mut decoder = zstd::Decoder::new(compressed_data.reader())?;
                let mut decompressed = Vec::new();
                decoder.read_to_end(&mut decompressed)?;
                Bytes::from(decompressed)
            }
            0 => {
                // Uncompressed: zero-copy slice directly from the transport buffer
                src.split_to(payload_len).freeze()
            }
            unknown => {
                return Err(anyhow::anyhow!(
                    "Unknown frame flags: {} (expected 0 or 1)",
                    unknown
                ));
            }
        };

        Ok(Some(bytes))
    }
}
