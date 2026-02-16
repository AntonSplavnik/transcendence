// Polyfill ProgressEvent for Node environments where jsdom doesn't expose it globally (e.g. Node 20)
if (typeof globalThis.ProgressEvent === 'undefined') {
	globalThis.ProgressEvent = class ProgressEvent extends Event {
		lengthComputable: boolean;
		loaded: number;
		total: number;
		constructor(type: string, params: ProgressEventInit = {}) {
			super(type, params);
			this.lengthComputable = params.lengthComputable ?? false;
			this.loaded = params.loaded ?? 0;
			this.total = params.total ?? 0;
		}
	} as any;
}

import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './tests/helpers/msw-handlers';

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Reset handlers after each test
afterEach(() => {
	server.resetHandlers();
	cleanup();
	localStorage.clear();
	vi.clearAllTimers();
});

// Close server after all tests
afterAll(() => server.close());

// Mock window.location.reload (jsdom marks reload as non-configurable,
// so we replace the entire location object via Vitest's stubGlobal API)
vi.stubGlobal('location', { ...window.location, reload: vi.fn() });

// Mock navigator.clipboard (only if not already defined)
if (!navigator.clipboard) {
	Object.defineProperty(navigator, 'clipboard', {
		value: {
			writeText: vi.fn().mockResolvedValue(undefined),
			readText: vi.fn().mockResolvedValue(''),
		},
		writable: true,
		configurable: true,
	});
}
