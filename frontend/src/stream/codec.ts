/*
 * Codec abstraction layer for the streaming system.
 *
 * Provides a `Codec` interface that can be swapped at runtime (dependency
 * injection) without touching the rest of the streaming infrastructure.
 * The default implementation wraps the existing CompressedCborCodec, but any
 * alternative (e.g. FlatBuffers, raw JSON, Protobuf) can be plugged in by
 * implementing the same interface.
 */

import {
	CompressedCborDecoder,
	CompressedCborEncoder,
	initZstd,
	type DecoderOptions,
	type EncoderOptions,
} from './CompressedCborCodec';

// Re-export so consumers only need to import from this module.
export { initZstd };

// ─── Codec interface ─────────────────────────────────────────────────────────

/**
 * Incremental stream decoder.
 *
 * Implementations buffer incomplete frames internally and yield fully-decoded
 * messages as they become available.
 */
export interface StreamDecoder<T = unknown> {
	/** Feed raw bytes and return all fully-decoded messages (may be empty). */
	push(chunk: Uint8Array | ArrayBuffer): T[];
	/** Discard any buffered partial frame. */
	reset(): void;
}

/**
 * Swappable wire-format codec.
 *
 * The `ConnectionManager` depends on this interface — not on a concrete
 * encoder/decoder — so the serialization format can be changed without
 * modifying the transport layer.
 */
export interface Codec {
	/** Encode a value into a single wire frame. */
	encode(value: unknown): Uint8Array;

	/** Create a new incremental decoder instance (one per stream). */
	createDecoder<T = unknown>(): StreamDecoder<T>;
}

// ─── Default implementation: CBOR + Zstd ─────────────────────────────────────

export interface CborZstdCodecOptions {
	encoder?: EncoderOptions;
	decoder?: DecoderOptions;
}

/**
 * Default codec implementation using CBOR serialization with optional Zstd
 * compression.
 *
 * Wraps the existing `CompressedCborEncoder` and `CompressedCborDecoder` to
 * satisfy the generic `Codec` interface.
 *
 * **Important**: `await initZstd()` must be called once before encoding or
 * decoding compressed frames.
 */
export class CborZstdCodec implements Codec {
	private readonly encoderOpts: EncoderOptions;
	private readonly decoderOpts: DecoderOptions;

	constructor(options: CborZstdCodecOptions = {}) {
		this.encoderOpts = options.encoder ?? {};
		this.decoderOpts = options.decoder ?? {};
	}

	encode(value: unknown): Uint8Array {
		// A new encoder instance is cheap (no state) and keeps the class
		// thread-safe for potential future Web Worker use.
		const encoder = new CompressedCborEncoder(this.encoderOpts);
		return encoder.encode(value);
	}

	createDecoder<T = unknown>(): StreamDecoder<T> {
		return new CompressedCborDecoder<T>(this.decoderOpts);
	}
}
