import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

// ModelPreview uses BabylonJS + WebGL which are unavailable in jsdom
vi.mock('@/components/ui/ModelPreview', () => ({ default: () => null }));

// GameProvider uses useStream + WebTransport; stub useGame with idle state for all tests
vi.mock('@/contexts/GameContext', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/contexts/GameContext')>();
	return {
		...actual,
		useGame: () => ({
			gameState: { status: 'idle' },
			snapshotRef: { current: null },
			sendInput: vi.fn(),
		}),
	};
});

// LobbyProvider uses useStream + useNavigate; stub useLobby with idle state for all tests
vi.mock('@/contexts/LobbyContext', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/contexts/LobbyContext')>();
	return {
		...actual,
		useLobby: () => ({
			lobbyState: { status: 'idle' },
			setReady: vi.fn().mockResolvedValue(undefined),
			updateSettings: vi.fn().mockResolvedValue(undefined),
			leave: vi.fn().mockResolvedValue(undefined),
		}),
	};
});
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
	if (localStorage && typeof localStorage.clear === 'function') {
		localStorage.clear();
	}
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
