# Wire Protocol Reference

Specification for the binary framing protocol used on all WebTransport streams
between backend and frontend.

## Table of Contents

- [Frame Format](#frame-format)
- [Flags Byte](#flags-byte)
- [Compression](#compression)
- [Frame Size Limits](#frame-size-limits)
- [StreamType Header](#streamtype-header)
- [Serde Encoding Rules](#serde-encoding-rules)
- [CBOR Specifics](#cbor-specifics)
- [Byte Order & Alignment](#byte-order--alignment)
- [Implementation Reference](#implementation-reference)

---

## Frame Format

Every message on a WebTransport stream is wrapped in a length-delimited frame:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
├─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┼─┤
│                          total_len                                │
├─┼─┼─┼─┼─┼─┼─┼─┼─────────────────────────────────────────────────-┤
│    flags      │               payload ...                         │
├─┼─┼─┼─┼─┼─┼─┼─┤                                                  │
│               │                                                    │
└───────────────┴────────────────────────────────────────────────────┘
```

| Field       | Offset | Size     | Type     | Description                              |
|-------------|--------|----------|----------|------------------------------------------|
| `total_len` | 0      | 4 bytes  | u32 BE   | Length of `flags` + `payload` in bytes    |
| `flags`     | 4      | 1 byte   | u8       | Compression flag (see below)             |
| `payload`   | 5      | variable | bytes    | CBOR data (raw or Zstd-compressed)        |

**`total_len`** does _not_ include the 4 bytes of the length prefix itself.
The total bytes on the wire for one frame is `4 + total_len`.

**Invariant:** `total_len >= 1` (at minimum the flags byte must be present).

---

## Flags Byte

| Value  | Meaning                   |
|--------|---------------------------|
| `0x00` | Payload is raw CBOR       |
| `0x01` | Payload is Zstd-compressed CBOR |

Any other value is a protocol error. The receiver must reject the frame.

---

## Compression

Zstd compression is applied **per-frame** (not per-stream). Each frame is
independently compressed or not, based on the CBOR payload size before
compression.

### Compression Thresholds

| Side       | Threshold | Rationale                                              |
|------------|-----------|--------------------------------------------------------|
| **Server** | 1024 B    | Server has more CPU headroom; save bandwidth for large payloads |
| **Client** | 512 B     | Client upload bandwidth is often constrained; compress earlier  |

If `cbor_payload.length > threshold`, the frame is compressed. Otherwise
it is sent raw.

### Zstd Parameters

| Parameter          | Value |
|--------------------|-------|
| Compression level  | 3     |
| Dictionary         | None  |
| Window size        | Default (Zstd library default) |

Level 3 provides good compression ratio with minimal latency impact for
real-time traffic.

### Compression Flow (Encoder)

```
1. Serialize value to CBOR bytes
2. If cbor_bytes.length > threshold:
     compressed = zstd_compress(cbor_bytes, level=3)
     flags = 0x01
     payload = compressed
   Else:
     flags = 0x00
     payload = cbor_bytes
3. total_len = 1 + payload.length
4. Write: [total_len: u32 BE][flags: u8][payload]
```

### Decompression Flow (Decoder)

```
1. Read total_len (u32 BE, 4 bytes)
2. Validate: 1 <= total_len <= MAX_DECODE_FRAME
3. Wait until total_len bytes are available after the prefix
4. Read flags (1 byte)
5. Read payload (total_len - 1 bytes)
6. If flags == 0x01:
     decompressed = zstd_decompress(payload)
     value = cbor_decode(decompressed)
   Elif flags == 0x00:
     value = cbor_decode(payload)
   Else:
     protocol error
```

---

## Frame Size Limits

| Context                  | Limit  | Enforced by       | Purpose                         |
|--------------------------|--------|-------------------|---------------------------------|
| Client outgoing encode   | 8 MiB  | `CompressedCborEncoder` (TS) | Fail fast on oversized messages |
| Server incoming decode   | 8 MiB  | `CompressedCborDecoder` (Rust) | Prevent client DoS              |
| Server outgoing encode   | No explicit limit | — | Encoder doesn't check (trust server code) |
| Client incoming decode   | 64 MiB | `CompressedCborDecoder` (TS) | Generous limit; catch corrupted length prefix |

The limit applies to `total_len` (the value in the 4-byte prefix), not to
the decompressed size. A compressed payload that decompresses to more than
the limit is accepted — the limit only prevents unbounded _buffering_ before
decompression begins.

---

## StreamType Header

The **first frame** on every stream is a `StreamType` value. It identifies the
stream's purpose so the receiver can dispatch to the correct handler.

This header frame uses the exact same wire format as all other frames (length-
delimited, optionally compressed CBOR). In practice, `StreamType` values are
small enough that compression is never applied.

### StreamType Enum (Backend Definition)

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub enum StreamType {
    Ctrl(PendingConnectionKey),
    Notifications,
    // Future variants:
    // ChatRoom(i32),
    // GameSession { id: Ulid },
}
```

### Stream Direction by Type

| StreamType       | Direction                          | Description                        |
|------------------|------------------------------------|------------------------------------|
| `Ctrl`           | Unidirectional (server → client)   | Auth handshake + lifecycle signals (e.g. `Displaced`) |
| `Notifications`  | Unidirectional (server → client)   | Server → client push               |

Future stream types will declare their direction when added.

---

## Serde Encoding Rules

All CBOR-encoded values follow **serde's externally-tagged enum encoding**
(the default for Rust enums). This determines how Rust types appear on the
wire.

### Enum Variants

| Rust variant type   | CBOR encoding                       | Example                              |
|---------------------|-------------------------------------|--------------------------------------|
| Unit variant        | String                              | `Notifications` → `"Notifications"`  |
| Newtype variant     | Single-key map                      | `Ctrl(key)` → `{"Ctrl": {…}}`        |
| Struct variant      | Single-key map with object value    | `Game { id: 1 }` → `{"Game": {"id": 1}}` |

### Struct Fields

Rust structs serialize as CBOR maps with string keys matching field names:

```rust
pub struct WireNotification {
    pub payload: NotificationPayload,  // → enum (see above)
    pub created_at: DateTime<Utc>,     // → string (ISO-8601)
}
```

Wire encoding:
```cbor
{
  "payload": "ServerHello",
  "created_at": "2026-02-17T14:30:00.000000Z"
}
```

### Special Types

| Rust type           | CBOR encoding                    | Notes                              |
|---------------------|----------------------------------|------------------------------------|
| `i32`, `u64`, etc.  | CBOR integer                     | Standard integer encoding          |
| `String`            | CBOR text string                 | UTF-8                              |
| `DateTime<Utc>`     | CBOR text string (ISO-8601)      | chrono's default serde format      |
| `FixedBlob<N>`      | CBOR text string (base64url)     | No padding, URL-safe alphabet      |
| `Vec<T>`            | CBOR array                       | Ordered sequence                   |
| `Option<T>`         | CBOR null or T                   | `None` → null, `Some(v)` → v      |

---

## CBOR Specifics

### Libraries

| Side       | Library     | Notes                                        |
|------------|-------------|----------------------------------------------|
| Backend    | `ciborium` | Serde-based CBOR encoder/decoder             |
| Frontend   | `cbor-x`   | High-performance JavaScript CBOR codec        |

Both libraries produce compatible CBOR output for the types used in this
project. They use standard CBOR (RFC 8949) encoding.

### Why CBOR over JSON

- **Binary format** — no text parsing overhead, smaller on the wire.
- **Native binary types** — byte strings don't need base64 encoding.
- **Schema-free** — no `.proto` files or code generation needed.
- **Serde integration** — Rust types serialize/deserialize with zero boilerplate.

---

## Byte Order & Alignment

| Item                  | Byte order    | Notes                                  |
|-----------------------|---------------|----------------------------------------|
| `total_len` prefix    | Big-endian    | Network byte order                     |
| CBOR integers         | Big-endian    | Per CBOR spec (RFC 8949)               |
| Zstd frames           | Little-endian | Zstd's native format                   |

No alignment requirements — all fields are read byte-by-byte.

---

## Implementation Reference

### Backend (Rust)

| Component                | File                                       | Role                         |
|--------------------------|--------------------------------------------|------------------------------|
| `CompressedCborEncoder`  | `backend/src/stream/compress_cbor_codec.rs` | Framing + compression        |
| `CompressedCborDecoder`  | `backend/src/stream/compress_cbor_codec.rs` | Deframing + decompression    |
| `frame_stream()`         | `backend/src/stream/stream_manager.rs`      | Sends StreamType + returns typed Sender/Receiver |
| `frame_uni_stream()`     | `backend/src/stream/stream_manager.rs`      | Same for uni-directional     |
| `CodecBufferParams`      | `backend/src/stream/compress_cbor_codec.rs` | Adaptive buffer tuning       |

### Frontend (TypeScript)

| Component                | File                                       | Role                         |
|--------------------------|--------------------------------------------|------------------------------|
| `CompressedCborEncoder`  | `frontend/src/stream/CompressedCborCodec.ts` | Framing + compression       |
| `CompressedCborDecoder`  | `frontend/src/stream/CompressedCborCodec.ts` | Incremental streaming decoder |
| `Codec` interface        | `frontend/src/stream/codec.ts`             | Swappable codec abstraction   |
| `CborZstdCodec`          | `frontend/src/stream/codec.ts`             | Default codec wrapping above  |
| `parseStreamType()`      | `frontend/src/stream/types.ts`             | Parses serde externally-tagged enum from CBOR |

### Adaptive Buffering (Backend)

The backend encoder uses `AdaptiveBuffer` to prevent memory bloat:

| Parameter                | Value | Effect                                            |
|--------------------------|-------|---------------------------------------------------|
| `MIN_CAPACITY`           | 2048  | Minimum buffer size (avoids small reallocations)   |
| `SHRINK_FACTOR`          | 3     | Shrink when capacity > 3× max observed usage       |
| `SHRINK_CHECK_INTERVAL`  | 64    | Check for shrinking every 64 messages              |

This means a buffer that grew to 1 MiB for a rare large message will shrink
back after 64 subsequent small messages, rather than holding 1 MiB forever.

---

## Related Documentation

- [Streaming Architecture](streaming-architecture.md) — connection lifecycle,
  auth handshake, stream multiplexing
- [Frontend Stream Integration](frontend-stream-integration.md) — codec
  abstraction, handler pattern
- [Notification System](notification-system.md) — first consumer of the
  streaming wire format
- [How to: Add a Stream Type](how-to/add-streamtype.md) — adding new
  WebTransport stream types
