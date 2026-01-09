//! Stream codecs for efficient binary serialization over the network.
//!
//! This module provides [`CompressedCborEncoder`] and [`CompressedCborDecoder`],
//! length-delimited codecs that combine:
//! - **CBOR serialization** via [ciborium](https://docs.rs/ciborium) for compact binary encoding
//! - **Zstd compression** (optional) for payloads exceeding a configurable threshold
//! - **Adaptive buffering** to prevent memory bloat from rare large messages
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
//! - **`flags`** (u8): `0x00` = uncompressed CBOR, `0x01` = Zstd-compressed CBOR
//! - **`payload`**: Raw or compressed CBOR data
//!
//! # Usage Example
//!
//! ```ignore
//! use tokio_util::codec::{FramedRead, FramedWrite};
//! use your_crate::stream::{CompressedCborEncoder, CompressedCborDecoder};
//!
//! // Wrap an AsyncWrite for sending messages
//! let sink = FramedWrite::new(writer, CompressedCborEncoder::<MyMessage>::new());
//!
//! // Wrap an AsyncRead for receiving messages
//! let stream = FramedRead::new(reader, CompressedCborDecoder::<MyMessage>::new());
//! ```
//!
//! # Compression Behavior
//!
//! Compression is applied only when the serialized CBOR payload exceeds
//! [`COMPRESS_THRESHOLD`] bytes (default: 1 KiB). This avoids the overhead of
//! compressing small messages where the savings would be negligible.
//!
//! # Security
//!
//! The decoder enforces a maximum frame size (`MAX_DECODE_FRAME`, default: 8 MiB)
//! to prevent denial-of-service attacks via memory exhaustion.

use std::{io::Write, marker::PhantomData};

use anyhow::bail;
use bytes::{Buf, BufMut, BytesMut};
use serde::{Serialize, de::DeserializeOwned};
use tokio_util::codec::{Decoder, Encoder};

use crate::utils::adaptive_buffer::{AdaptiveBuffer, BufferParams};

// =============================================================================
// Constants
// =============================================================================

/// Minimum CBOR payload size (in bytes) before Zstd compression is applied.
///
/// Payloads smaller than this threshold are sent uncompressed to avoid the
/// CPU overhead of compression when the space savings would be minimal.
const COMPRESS_THRESHOLD: usize = 1024;

/// Zstd compression level (1-22, where higher = better compression but slower).
///
/// Level 3 provides a good balance between compression ratio and speed,
/// suitable for real-time network traffic.
const COMPRESS_LEVEL: i32 = 3;

// =============================================================================
// Codec Buffer Parameters
// =============================================================================

/// Buffer parameters optimized for codec usage.
///
/// These parameters configure the [`AdaptiveBuffer`] used internally:
/// - `MIN_CAPACITY = 2048`: Avoids frequent small reallocations for typical messages
/// - `SHRINK_FACTOR = 3`: Shrinks when capacity > 3× the max observed usage
/// - `SHRINK_CHECK_INTERVAL = 64`: Checks for shrinking every 64 messages
#[derive(Debug, Clone, Copy, Default)]
pub struct CodecBufferParams;

impl BufferParams for CodecBufferParams {
    const MIN_CAPACITY: usize = 2048;
    const SHRINK_FACTOR: usize = 3;
    const SHRINK_CHECK_INTERVAL: usize = 64;
}

// =============================================================================
// CompressedCborEncoder
// =============================================================================

/// An encoder that serializes types using CBOR with optional Zstd compression.
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
/// - **`payload`**: The CBOR data (raw) or `[u32_be uncompressed_len][zstd(cbor)]`
///
/// # Memory Management
///
/// Internal buffers use [`AdaptiveBuffer`] to automatically shrink after
/// processing rare large messages, preventing long-term memory bloat.
///
/// # Type Parameters
/// - `T`: The type to serialize
/// - `BP`: Buffer parameters implementing [`BufferParams`] (default: [`CodecBufferParams`])
pub struct CompressedCborEncoder<T, BP: BufferParams = CodecBufferParams> {
    /// Temporary buffer for CBOR serialization (before compression).
    cbor_buf: AdaptiveBuffer<u8, BP>,
    /// Temporary buffer for Zstd-compressed output.
    compress_buf: AdaptiveBuffer<u8, BP>,
    /// Marker for the message type `T`.
    _phantom: PhantomData<T>,
}

impl<T, BP: BufferParams> CompressedCborEncoder<T, BP> {
    /// Creates a new encoder with default buffer capacities.
    ///
    /// Buffers start at `BP::MIN_CAPACITY` and grow as needed, shrinking
    /// automatically if they become oversized relative to actual usage.
    #[must_use]
    pub fn new() -> Self {
        Self {
            cbor_buf: AdaptiveBuffer::new(),
            compress_buf: AdaptiveBuffer::new(),
            _phantom: PhantomData,
        }
    }
}

impl<T, BP: BufferParams> Default for CompressedCborEncoder<T, BP> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Serialize, BP: BufferParams> Encoder<T>
    for CompressedCborEncoder<T, BP>
{
    type Error = anyhow::Error;

    fn encode(
        &mut self,
        item: T,
        dst: &mut BytesMut,
    ) -> Result<(), Self::Error> {
        // Step 1: Serialize the item to CBOR into our reusable buffer
        ciborium::into_writer(&item, self.cbor_buf.as_mut_vec())?;

        // Step 2: Decide whether to compress based on payload size
        let (payload, flags) = if self.cbor_buf.len() > COMPRESS_THRESHOLD {
            // Compressed payload format: [u32_be uncompressed_len][zstd(cbor)]
            // Put the uncompressed length directly into the compression buffer
            // so Step 3 can treat it like a normal payload.
            let uncompressed_len = self.cbor_buf.len() as u32;
            self.compress_buf
                .as_mut_vec()
                .extend_from_slice(&uncompressed_len.to_be_bytes());

            // Compress with Zstd - encoder must be finished to flush all data
            let mut encoder = zstd::Encoder::new(
                self.compress_buf.as_mut_vec(),
                COMPRESS_LEVEL,
            )?;
            encoder.write_all(&self.cbor_buf)?;
            encoder.finish()?; // Critical: flushes remaining compressed data
            (self.compress_buf.as_vec().as_slice(), 1u8)
        } else {
            // Send uncompressed
            (self.cbor_buf.as_vec().as_slice(), 0u8)
        };

        // Step 3: Write the length-prefixed frame to the output buffer
        // Frame structure: [total_len: u32][flags: u8][payload: bytes]
        let total_len = 1 + payload.len(); // flags (1 byte) + payload
        dst.reserve(4 + total_len); // length prefix (4 bytes) + frame content
        dst.put_u32(total_len as u32);
        dst.put_u8(flags);
        dst.extend_from_slice(payload);

        // Step 4: Reset internal buffers for next message (may trigger shrinking)
        self.cbor_buf.finish();
        if flags == 1u8 {
            self.compress_buf.finish();
        }

        Ok(())
    }
}

// =============================================================================
// CompressedCborDecoder
// =============================================================================

/// A decoder that deserializes types using CBOR with optional Zstd decompression.
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
/// - **`payload`**: The CBOR data (raw) or `[u32_be uncompressed_len][zstd(cbor)]`
///
/// # Type Parameters
/// - `T`: The type to deserialize
///
/// # Const Generics
/// - `MAX_DECODE_FRAME`: Maximum allowed frame size for decoding (default: 8 MiB).
///   Frames larger than this will cause a decoding error.
pub struct CompressedCborDecoder<
    T,
    const MAX_DECODE_FRAME: usize = { 8 * 1024 * 1024 },
> {
    /// Marker for the message type `T`.
    _phantom: PhantomData<T>,
}

impl<T, const MAX_DECODE_FRAME: usize>
    CompressedCborDecoder<T, MAX_DECODE_FRAME>
{
    /// Creates a new decoder.
    #[must_use]
    pub fn new() -> Self {
        Self {
            _phantom: PhantomData,
        }
    }
}

impl<T, const MAX_DECODE_FRAME: usize> Default
    for CompressedCborDecoder<T, MAX_DECODE_FRAME>
{
    fn default() -> Self {
        Self::new()
    }
}

impl<T: DeserializeOwned, const MAX_DECODE_FRAME: usize> Decoder
    for CompressedCborDecoder<T, MAX_DECODE_FRAME>
{
    type Item = T;
    type Error = anyhow::Error;

    fn decode(
        &mut self,
        src: &mut BytesMut,
    ) -> Result<Option<Self::Item>, Self::Error> {
        // Step 1: Check if we have enough bytes for the length prefix
        const LEN_PREFIX_SIZE: usize = 4;
        if src.len() < LEN_PREFIX_SIZE {
            return Ok(None); // Need more data
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
            // Reserve space for the remaining bytes to hint the transport layer
            src.reserve(frame_size - src.len());
            return Ok(None); // Need more data
        }

        // Step 4: Now we have a complete frame - consume the length prefix
        src.advance(LEN_PREFIX_SIZE);

        // Step 5: Extract flags and payload
        let flags = src.get_u8();
        let payload_len = total_len - 1; // Subtract the flags byte

        // Step 6: Deserialize based on compression flag
        let item = match flags {
            1 => {
                if payload_len < 4 {
                    bail!(
                        "Invalid compressed frame: missing uncompressed length prefix"
                    );
                }

                // Compressed payload format: [u32_be uncompressed_len][zstd(cbor)]
                let mut compressed_data = src.split_to(payload_len);
                let _uncompressed_len = compressed_data.get_u32();
                let decoder = zstd::Decoder::new(compressed_data.reader())?;
                ciborium::from_reader(decoder)?
            }
            0 => {
                // Uncompressed: parse CBOR directly
                let raw_data = src.split_to(payload_len);
                ciborium::from_reader(raw_data.reader())?
            }
            unknown => {
                bail!("Unknown frame flags: {} (expected 0 or 1)", unknown);
            }
        };

        Ok(Some(item))
    }
}
