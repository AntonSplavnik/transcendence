import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

import {
	CompressedCborEncoder,
	CompressedCborDecoder,
	initZstd,
	DEFAULT_COMPRESS_THRESHOLD,
	DEFAULT_MAX_ENCODE_FRAME_BYTES,
	MAX_DECODE_FRAME_BYTES,
} from '../../../src/stream/CompressedCborCodec';

describe('CompressedCborCodec', () => {
	beforeAll(async () => {
		await initZstd();
	});

	describe('initZstd', () => {
		it('initializes zstd module', async () => {
			// Already initialized in beforeAll, should return same promise
			const result = await initZstd();
			expect(result).toBeUndefined();
		});

		it('is idempotent - multiple calls return same promise', async () => {
			const promise1 = initZstd();
			const promise2 = initZstd();
			expect(promise1).toBe(promise2);
		});
	});

	describe('CompressedCborEncoder', () => {
		it('encodes small messages without compression (flags=0)', async () => {
			const encoder = new CompressedCborEncoder({ compressThreshold: 1000 });
			const data = { message: 'hello' };

			const frame = encoder.encode(data);

			// Frame structure: [u32 totalLen][u8 flags][payload]
			expect(frame.length).toBeGreaterThan(5);

			// Read total length (big-endian u32)
			const totalLen = (frame[0] << 24) | (frame[1] << 16) | (frame[2] << 8) | frame[3];
			expect(totalLen).toBe(frame.length - 4);

			// Check flags byte - should be 0 (uncompressed)
			expect(frame[4]).toBe(0);
		});

		it('encodes large messages with compression (flags=1)', async () => {
			const encoder = new CompressedCborEncoder({ compressThreshold: 10 });
			// Create a message larger than threshold
			const data = { message: 'hello world this is a long message that exceeds threshold' };

			const frame = encoder.encode(data);

			// Check flags byte - should be 1 (compressed)
			expect(frame[4]).toBe(1);
		});

		it('throws on frame size exceeding maxFrameBytes', () => {
			const encoder = new CompressedCborEncoder({
				compressThreshold: Infinity, // Disable compression
				maxFrameBytes: 10, // Very small limit
			});

			const data = { message: 'this will exceed the limit' };

			expect(() => encoder.encode(data)).toThrow(/exceeds maxFrameBytes/);
		});

		it('uses default options', () => {
			const encoder = new CompressedCborEncoder();

			expect(encoder.compressThreshold).toBe(DEFAULT_COMPRESS_THRESHOLD);
			expect(encoder.maxFrameBytes).toBe(DEFAULT_MAX_ENCODE_FRAME_BYTES);
		});

		it('respects custom compression threshold', () => {
			const encoder = new CompressedCborEncoder({ compressThreshold: 100 });
			expect(encoder.compressThreshold).toBe(100);
		});
	});

	describe('CompressedCborDecoder', () => {
		let encoder: CompressedCborEncoder;
		let decoder: CompressedCborDecoder;

		beforeEach(() => {
			encoder = new CompressedCborEncoder({ compressThreshold: Infinity });
			decoder = new CompressedCborDecoder();
		});

		it('decodes a single complete frame', () => {
			const original = { type: 'test', value: 42 };
			const frame = encoder.encode(original);

			const messages = decoder.push(frame);

			expect(messages).toHaveLength(1);
			expect(messages[0]).toEqual(original);
		});

		it('buffers partial frames across multiple pushes', () => {
			const original = { type: 'test', value: 42 };
			const frame = encoder.encode(original);

			// Split frame in half
			const firstHalf = frame.slice(0, Math.floor(frame.length / 2));
			const secondHalf = frame.slice(Math.floor(frame.length / 2));

			// First push should return empty (incomplete frame)
			const messages1 = decoder.push(firstHalf);
			expect(messages1).toHaveLength(0);
			expect(decoder.bufferedBytes).toBe(firstHalf.length);

			// Second push should complete the frame
			const messages2 = decoder.push(secondHalf);
			expect(messages2).toHaveLength(1);
			expect(messages2[0]).toEqual(original);
		});

		it('handles multiple messages in single buffer', () => {
			const msg1 = { id: 1 };
			const msg2 = { id: 2 };
			const msg3 = { id: 3 };

			const frame1 = encoder.encode(msg1);
			const frame2 = encoder.encode(msg2);
			const frame3 = encoder.encode(msg3);

			// Combine all frames
			const combined = new Uint8Array(frame1.length + frame2.length + frame3.length);
			combined.set(frame1, 0);
			combined.set(frame2, frame1.length);
			combined.set(frame3, frame1.length + frame2.length);

			const messages = decoder.push(combined);

			expect(messages).toHaveLength(3);
			expect(messages[0]).toEqual(msg1);
			expect(messages[1]).toEqual(msg2);
			expect(messages[2]).toEqual(msg3);
		});

		it('throws on frame size exceeding maxFrameBytes', () => {
			const smallDecoder = new CompressedCborDecoder({ maxFrameBytes: 10 });

			// Create a fake frame header with large total_len
			const fakeFrame = new Uint8Array(8);
			// Set total_len to 1000 (big-endian)
			fakeFrame[0] = 0;
			fakeFrame[1] = 0;
			fakeFrame[2] = 3;
			fakeFrame[3] = 232; // 1000 in decimal
			fakeFrame[4] = 0; // flags

			expect(() => smallDecoder.push(fakeFrame)).toThrow(/exceeds maximum allowed size/);
		});

		it('throws on invalid total_len of 0', () => {
			const fakeFrame = new Uint8Array(8);
			// Set total_len to 0 (invalid - must be at least 1 for flags byte)
			fakeFrame[0] = 0;
			fakeFrame[1] = 0;
			fakeFrame[2] = 0;
			fakeFrame[3] = 0;

			expect(() => decoder.push(fakeFrame)).toThrow(/must be at least 1/);
		});

		it('throws on unknown flags value', () => {
			const original = { test: true };
			const frame = encoder.encode(original);

			// Corrupt the flags byte
			frame[4] = 0x99;

			expect(() => decoder.push(frame)).toThrow(/Unknown frame flags/);
		});

		it('handles ArrayBuffer input', () => {
			const original = { message: 'test' };
			const frame = encoder.encode(original);

			// Convert to ArrayBuffer
			const arrayBuffer = frame.buffer.slice(
				frame.byteOffset,
				frame.byteOffset + frame.byteLength
			);

			const messages = decoder.push(arrayBuffer);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toEqual(original);
		});

		it('reset clears buffer state', () => {
			const original = { test: true };
			const frame = encoder.encode(original);

			// Push partial frame
			decoder.push(frame.slice(0, 5));
			expect(decoder.bufferedBytes).toBe(5);

			decoder.reset();
			expect(decoder.bufferedBytes).toBe(0);
		});

		it('handles empty chunk gracefully', () => {
			const messages = decoder.push(new Uint8Array(0));
			expect(messages).toHaveLength(0);
		});

		it('uses default maxFrameBytes', () => {
			const defaultDecoder = new CompressedCborDecoder();
			expect(defaultDecoder.maxFrameBytes).toBe(MAX_DECODE_FRAME_BYTES);
		});

		it('decodes compressed frames', async () => {
			const compressingEncoder = new CompressedCborEncoder({ compressThreshold: 10 });
			const largeData = { data: 'a'.repeat(100) };

			const frame = compressingEncoder.encode(largeData);
			expect(frame[4]).toBe(1); // Should be compressed

			const messages = decoder.push(frame);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toEqual(largeData);
		});
	});
});
