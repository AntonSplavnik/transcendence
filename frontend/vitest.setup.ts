import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './tests/helpers/msw-handlers';

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Seed auth hint so AuthProvider's initial check calls getMe() (mirrors a returning user).
// localStorage.clear() in afterEach wipes it between tests.
beforeEach(() => {
	localStorage.setItem('auth_hint', '1');
});

// Reset handlers after each test
afterEach(() => {
	server.resetHandlers();
	cleanup();
	localStorage.clear();
	vi.clearAllTimers();
});

// Close server after all tests
afterAll(() => server.close());

// Mock window.location.reload
Object.defineProperty(window, 'location', {
	value: {
		...window.location,
		reload: vi.fn(),
	},
	writable: true,
});

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
