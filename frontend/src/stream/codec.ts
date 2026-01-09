import { decode as cborDecode, encode as cborEncode } from 'cbor-x';
import {
	compress as zstdCompress,
	decompress as zstdDecompress,
	init as zstdInit,
} from '@bokuweb/zstd-wasm';

const LEN_PREFIX_SIZE = 4;
const FLAGS_SIZE = 1;
// Clients typically have bad upload speeds, so we want to compress even small frames.
const COMPRESS_THRESHOLD = 512;
const MAX_DECODE_FRAME = 8 * 1024 * 1024;

// Backend compatibility note:
// - flags=0: payload is raw CBOR bytes
// - flags=1: payload is [u32_be uncompressed_len][zstd(payload)]
const FLAG_UNCOMPRESSED = 0;
const FLAG_ZSTD_WITH_SIZE = 1;

let zstdInitPromise: Promise<void> | null = null;

async function ensureZstdReady(): Promise<void> {
	if (!zstdInitPromise) {
		zstdInitPromise = zstdInit() as Promise<void>;
	}
	await zstdInitPromise;
}

function asUint8Array(view: ArrayBufferView): Uint8Array {
	return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function readU32BE(buffer: Uint8Array, offset: number): number {
	return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(
		offset,
		false,
	);
}

function writeU32BE(buffer: Uint8Array, offset: number, value: number): void {
	new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setUint32(
		offset,
		value,
		false,
	);
}

export function encodeFrame(_value: unknown): Uint8Array {
	throw new Error('encodeFrame is async; use encodeFrameAsync');
}

export async function encodeFrameAsync(value: unknown): Promise<Uint8Array> {
	const rawPayload = cborEncode(value) as Uint8Array;

	let flags = FLAG_UNCOMPRESSED;
	let payload = rawPayload;
	let uncompressedLen = 0;

	if (rawPayload.byteLength > COMPRESS_THRESHOLD) {
		await ensureZstdReady();
		const compressed = zstdCompress(rawPayload, 3);
		flags = FLAG_ZSTD_WITH_SIZE;
		payload = compressed;
		uncompressedLen = rawPayload.byteLength;
	}

	const extra = flags === FLAG_ZSTD_WITH_SIZE ? 4 : 0;
	const totalLen = FLAGS_SIZE + extra + payload.byteLength;
	const out = new Uint8Array(LEN_PREFIX_SIZE + totalLen);
	writeU32BE(out, 0, totalLen);
	out[LEN_PREFIX_SIZE] = flags;
	let cursor = LEN_PREFIX_SIZE + FLAGS_SIZE;
	if (flags === FLAG_ZSTD_WITH_SIZE) {
		writeU32BE(out, cursor, uncompressedLen);
		cursor += 4;
	}
	out.set(payload, cursor);
	return out;
}

export function decodeFrame(flags: number, payload: Uint8Array): unknown {
	if (flags === FLAG_UNCOMPRESSED) {
		return cborDecode(payload);
	}
	if (flags === FLAG_ZSTD_WITH_SIZE) {
		throw new Error('decodeFrame for zstd is async; use decodeFrameAsync');
	}
	throw new Error(
		`Unknown frame flags: ${flags} (expected ${FLAG_UNCOMPRESSED} or ${FLAG_ZSTD_WITH_SIZE})`,
	);
}

export async function decodeFrameAsync(
	flags: number,
	payload: Uint8Array,
): Promise<unknown> {
	if (flags === FLAG_UNCOMPRESSED) {
		return cborDecode(payload);
	}
	if (flags !== FLAG_ZSTD_WITH_SIZE) {
		throw new Error(
			`Unknown frame flags: ${flags} (expected ${FLAG_UNCOMPRESSED} or ${FLAG_ZSTD_WITH_SIZE})`,
		);
	}
	if (payload.byteLength < 4) {
		throw new Error('Invalid compressed frame: missing uncompressed size');
	}

	const expectedSize = readU32BE(payload, 0);
	const compressed = payload.subarray(4);
	await ensureZstdReady();
	const raw = asUint8Array(zstdDecompress(compressed));
	if (raw.byteLength !== expectedSize) {
		throw new Error(
			`Invalid compressed frame: expected ${expectedSize} bytes, got ${raw.byteLength}`,
		);
	}
	return cborDecode(raw);
}

export class FramedReader {
	private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
	private buffer: Uint8Array = new Uint8Array(0);
	private offset = 0;
	private done = false;

	constructor(readable: ReadableStream<Uint8Array>) {
		this.reader = readable.getReader();
	}

	async cancel(reason?: unknown): Promise<void> {
		this.done = true;
		try {
			await this.reader.cancel(reason);
		} catch {
			// ignore
		}
	}

	async readOne(): Promise<unknown | null> {
		while (true) {
			const frame = this.tryParseOne();
			if (frame !== undefined) {
				return decodeFrameAsync(frame.flags, frame.payload);
			}
			if (this.done) {
				return null;
			}
			const result = await this.reader.read();
			if (result.done) {
				this.done = true;
				return null;
			}
			this.append(result.value);
		}
	}

	async *messages<T = unknown>(): AsyncGenerator<T, void, void> {
		while (true) {
			const value = await this.readOne();
			if (value === null) {
				return;
			}
			yield value as T;
		}
	}

	private append(chunk: Uint8Array): void {
		if (this.buffer.byteLength === 0) {
			this.buffer = chunk;
			this.offset = 0;
			return;
		}
		const remaining = this.buffer.subarray(this.offset);
		const merged = new Uint8Array(remaining.byteLength + chunk.byteLength);
		merged.set(remaining, 0);
		merged.set(chunk, remaining.byteLength);
		this.buffer = merged;
		this.offset = 0;
	}

	private tryParseOne():
		| { flags: number; payload: Uint8Array }
		| undefined {
		const available = this.buffer.byteLength - this.offset;
		if (available < LEN_PREFIX_SIZE) {
			return undefined;
		}

		const totalLen = readU32BE(this.buffer, this.offset);
		if (totalLen > MAX_DECODE_FRAME) {
			throw new Error(
				`Frame size ${totalLen} exceeds maximum allowed size ${MAX_DECODE_FRAME}`,
			);
		}
		if (totalLen < 1) {
			throw new Error(
				`Invalid frame: total_len must be at least 1 (for flags byte), got ${totalLen}`,
			);
		}

		const frameSize = LEN_PREFIX_SIZE + totalLen;
		if (available < frameSize) {
			return undefined;
		}

		this.offset += LEN_PREFIX_SIZE;
		const flags = this.buffer[this.offset];
		this.offset += FLAGS_SIZE;
		const payloadLen = totalLen - FLAGS_SIZE;
		const payload = this.buffer.subarray(this.offset, this.offset + payloadLen);
		this.offset += payloadLen;

		if (this.offset >= this.buffer.byteLength) {
			this.buffer = new Uint8Array(0);
			this.offset = 0;
		}

		return { flags, payload };
	}
}

export class FramedWriter {
	private readonly writer: WritableStreamDefaultWriter<Uint8Array>;

	constructor(writable: WritableStream<Uint8Array>) {
		this.writer = writable.getWriter();
	}

	async send(value: unknown): Promise<void> {
		await this.writer.write(await encodeFrameAsync(value));
	}

	async close(): Promise<void> {
		try {
			await this.writer.close();
		} finally {
			this.writer.releaseLock();
		}
	}

	abort(reason?: unknown): Promise<void> {
		try {
			return this.writer.abort(reason);
		} finally {
			this.writer.releaseLock();
		}
	}
}
