/*
 * CompressedCborCodec (browser/client)
 *
 * Matches the backend Rust implementation in:
 * - backend/src/stream/compress_cbor_codec.rs
 *
 * Wire format per frame:
 *   [total_len: u32 BE][flags: u8][payload: bytes]
 *
 * Where:
 * - total_len = length of (flags + payload) in bytes
 * - flags:
 *     0x00 => payload is raw CBOR
 *     0x01 => payload is Zstd-compressed CBOR
 * - payload:
 *     CBOR bytes produced by `cbor-x` (raw), or those bytes after Zstd compression
 *
 * This file provides:
 * - CompressedCborEncoder: encode JS values into frames
 * - CompressedCborDecoder: incremental streaming decoder (push chunks, get messages)
 *
 * Notes:
 * - Zstd requires a one-time async initialization (`initZstd`).
 * - The decoder enforces a hard maximum frame size (`MAX_DECODE_FRAME_BYTES`).
 *   Even if your application logic “trusts” peers, an upper bound is still a
 *   practical safety measure: a corrupted/garbled length prefix would otherwise
 *   make the decoder buffer indefinitely and potentially OOM the page.
 */

import {
	compress as zstdCompress,
	decompress as zstdDecompress,
	init as zstdInit,
} from '@bokuweb/zstd-wasm';
import { decode as cborDecode, encode as cborEncode } from 'cbor-x';

/**
 * Minimum CBOR payload size (bytes) before applying Zstd compression.
 * On the client side, we use a default of 512 bytes because
 * - We don't need to be that careful about compute resources (unlike on the server).
 * - Upload Bandwith is often a lot more constrained for clients.
 */
export const DEFAULT_COMPRESS_THRESHOLD = 512;

/** Zstd compression level. The wasm library default is also 3; we make it explicit. */
export const DEFAULT_ZSTD_LEVEL = 3;

/**
 * Default upper bound for *encoding* a single frame: 8 MiB.
 *
 * This matches the backend’s current per-frame limit (`MAX_STREAM_FRAME_SIZE`).
 * We enforce it on the client encoder side to fail fast and to avoid producing
 * frames the backend would reject.
 */
export const DEFAULT_ENCODE_FRAME_BYTES_LIMIT = 8 * 1024 * 1024;

/**
 * Hard upper bound for decoding a single frame: 64 MiB.
 *
 * Rationale:
 * - A bogus `total_len` (e.g. from corrupted transport data) could otherwise
 *   force unbounded buffering.
 * - 64 MiB is intentionally generous while still preventing catastrophic OOM.
 *
 * This limits `total_len` (flags + payload), exactly like the backend’s
 * `MAX_DECODE_FRAME` check.
 */
export const MAX_DECODE_FRAME_BYTES = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Zstd init (one-shot)
// ---------------------------------------------------------------------------

let zstdInitPromise: Promise<void> | null = null;
let zstdReady = false;

/**
 * Initialize the Zstd wasm module exactly once.
 *
 * If you are running in the browser without a bundler, pass a URL/path to `zstd.wasm`.
 * With most bundlers, calling without arguments is sufficient.
 */
export function initZstd(): Promise<void> {
	if (!zstdInitPromise) {
		zstdInitPromise = zstdInit().then(() => {
			zstdReady = true;
		});
	}
	return zstdInitPromise!;
}

function assertZstdInitialized(): void {
	if (!zstdInitPromise) {
		throw new Error(
			'Zstd is not initialized. Call `await initZstd()` before encoding/decoding compressed frames.',
		);
	}
	if (!zstdReady) {
		throw new Error(
			'Zstd initialization is in progress. Make sure you `await initZstd()` before encoding/decoding compressed frames.',
		);
	}
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function readU32BE(buf: Uint8Array, offset: number): number {
	// Big-endian u32
	return (
		(buf[offset] << 24) |
		(buf[offset + 1] << 16) |
		(buf[offset + 2] << 8) |
		buf[offset + 3]
	) >>> 0;
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
	buf[offset] = (value >>> 24) & 0xff;
	buf[offset + 1] = (value >>> 16) & 0xff;
	buf[offset + 2] = (value >>> 8) & 0xff;
	buf[offset + 3] = value & 0xff;
}

function nextCapacity(minCapacity: number): number {
	// Grow geometrically to keep appends amortized O(1)
	let cap = 2048;
	while (cap < minCapacity) cap *= 2;
	return cap;
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

export interface EncoderOptions {
	/** Apply Zstd only if the CBOR payload length is greater than this threshold. */
	compressThreshold?: number;
	/** Zstd compression level (1..22). Default: 3. */
	zstdLevel?: number;
	/**
	 * Maximum allowed outgoing frame size in bytes for the on-wire `total_len` field
	 * (flags + payload).
	 *
	 * This is a client-side safety/guardrail for *outgoing* frames.
	 * If set and the encoded `total_len` would exceed this size, `encode()` throws.
	 *
	 * Default: `MAX_ENCODE_FRAME_BYTES`.
	 */
	maxFrameBytes?: number;
}

export interface DecoderOptions {
	/**
	 * Maximum allowed incoming frame size in bytes for the on-wire `total_len` field
	 * (flags + payload).
	 *
	 * Use this to mirror per-stream limits enforced by the backend.
	 * Default: `MAX_DECODE_FRAME_BYTES`.
	 */
	maxFrameBytes?: number;
}

/**
 * Stateless encoder producing frames compatible with the Rust backend.
 */
export class CompressedCborEncoder {
	readonly compressThreshold: number;
	readonly zstdLevel: number;
	readonly maxFrameBytes: number;

	constructor(options: EncoderOptions = {}) {
		this.compressThreshold =
			options.compressThreshold ?? DEFAULT_COMPRESS_THRESHOLD;
		this.zstdLevel = options.zstdLevel ?? DEFAULT_ZSTD_LEVEL;
		this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_ENCODE_FRAME_BYTES_LIMIT;
	}

	/**
	 * Encode a JS value into a single wire frame:
	 *   [u32 total_len BE][u8 flags][payload]
	 */
	encode<T>(value: T): Uint8Array {
		const cborPayload = cborEncode(value) as Uint8Array;

		let flags = 0;
		let payload = cborPayload;

		if (cborPayload.length > this.compressThreshold) {
			assertZstdInitialized();
			flags = 1;
			payload = zstdCompress(cborPayload, this.zstdLevel);
		}

		const totalLen = 1 + payload.length;
		if (totalLen > this.maxFrameBytes) {
			throw new Error(
				`Outgoing frame too large: total_len=${totalLen} exceeds maxFrameBytes=${this.maxFrameBytes}`,
			);
		}
		if (totalLen > 0xffffffff) {
			throw new Error(
				`Frame too large to encode: total_len=${totalLen} exceeds u32`,
			);
		}

		const out = new Uint8Array(4 + totalLen);
		writeU32BE(out, 0, totalLen);
		out[4] = flags;
		out.set(payload, 5);
		return out;
	}
}

// ---------------------------------------------------------------------------
// Decoder (incremental)
// ---------------------------------------------------------------------------

/**
 * Incremental streaming decoder.
 *
 * Usage:
 *   await initZstd(); // recommended once during startup
 *   const dec = new CompressedCborDecoder<MyMsg>();
 *   const msgs = dec.push(chunkFromWebTransport);
 */
export class CompressedCborDecoder<T = unknown> {
	private buf: Uint8Array;
	private start: number;
	private end: number;
	readonly maxFrameBytes: number;

	constructor(options: DecoderOptions = {}) {
		this.buf = new Uint8Array(2048);
		this.start = 0;
		this.end = 0;
		this.maxFrameBytes = options.maxFrameBytes ?? MAX_DECODE_FRAME_BYTES;
	}

	/** Bytes currently buffered but not yet decoded (for debugging/metrics). */
	get bufferedBytes(): number {
		return this.end - this.start;
	}

	/** Reset internal buffer state (drops any partial frame). */
	reset(): void {
		this.start = 0;
		this.end = 0;
	}

	/**
	 * Push a new chunk of bytes and decode as many frames as possible.
	 *
	 * Returns decoded messages in arrival order.
	 * Keeps any incomplete trailing frame buffered for the next call.
	 */
	push(chunk: Uint8Array | ArrayBuffer): T[] {
		const inChunk =
			chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
		this.append(inChunk);
		return this.drain();
	}

	private append(chunk: Uint8Array): void {
		if (chunk.length === 0) return;

		// If there is space at the front (start > 0), compact before growing.
		if (this.start > 0) {
			const remaining = this.end - this.start;
			if (remaining === 0) {
				this.start = 0;
				this.end = 0;
			} else if (this.end + chunk.length > this.buf.length) {
				// Move remaining bytes to front.
				this.buf.copyWithin(0, this.start, this.end);
				this.start = 0;
				this.end = remaining;
			}
		}

		const needed = this.end + chunk.length;
		if (needed > this.buf.length) {
			const newBuf = new Uint8Array(nextCapacity(needed));
			newBuf.set(this.buf.subarray(this.start, this.end), 0);
			this.end = this.end - this.start;
			this.start = 0;
			this.buf = newBuf;
		}

		this.buf.set(chunk, this.end);
		this.end += chunk.length;
	}

	private drain(): T[] {
		const out: T[] = [];

		while (true) {
			const available = this.end - this.start;
			if (available < 4) break; // need length prefix

			const totalLen = readU32BE(this.buf, this.start);
			if (totalLen < 1) {
				throw new Error(
					`Invalid frame: total_len must be at least 1 (flags byte), got ${totalLen}`,
				);
			}
			if (totalLen > this.maxFrameBytes) {
				throw new Error(
					`Frame size ${totalLen} exceeds maximum allowed size ${this.maxFrameBytes}`,
				);
			}

			const frameSize = 4 + totalLen;
			if (available < frameSize) break; // incomplete frame

			const flags = this.buf[this.start + 4];
			const payloadLen = totalLen - 1;
			const payloadStart = this.start + 5;
			const payloadEnd = payloadStart + payloadLen;

			let msg: unknown;
			if (flags === 0) {
				const payload = this.buf.subarray(payloadStart, payloadEnd);
				msg = cborDecode(payload);
			} else if (flags === 1) {
				assertZstdInitialized();
				const compressed = this.buf.subarray(payloadStart, payloadEnd);
				const decompressed = zstdDecompress(compressed);
				msg = cborDecode(decompressed);
			} else {
				throw new Error(
					`Unknown frame flags: ${flags} (expected 0 or 1)`,
				);
			}

			out.push(msg as T);
			this.start += frameSize;
		}

		// Compact occasionally to avoid unbounded growth when reading many frames.
		if (this.start > 0) {
			const remaining = this.end - this.start;
			if (remaining === 0) {
				this.start = 0;
				this.end = 0;
			} else if (this.start >= 64 * 1024 || this.start > (this.buf.length >>> 1)) {
				this.buf.copyWithin(0, this.start, this.end);
				this.start = 0;
				this.end = remaining;
			}
		}

		return out;
	}
}
