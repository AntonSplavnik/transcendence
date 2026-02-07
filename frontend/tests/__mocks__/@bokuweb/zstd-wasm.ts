// Mock for @bokuweb/zstd-wasm
// Provides pass-through compression/decompression for testing

const MAGIC_PREFIX = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]); // Zstd magic number

let initialized = false;

export async function init(): Promise<void> {
	initialized = true;
}

export function compress(data: Uint8Array, _level?: number): Uint8Array {
	if (!initialized) {
		throw new Error('Zstd not initialized');
	}
	// Prepend magic bytes to simulate compression
	const result = new Uint8Array(MAGIC_PREFIX.length + data.length);
	result.set(MAGIC_PREFIX, 0);
	result.set(data, MAGIC_PREFIX.length);
	return result;
}

export function decompress(data: Uint8Array): Uint8Array {
	if (!initialized) {
		throw new Error('Zstd not initialized');
	}
	// Strip magic bytes to simulate decompression
	return data.slice(MAGIC_PREFIX.length);
}
