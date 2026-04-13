import '@testing-library/jest-dom';

// jsdom normalises hex colour strings to rgb(...) when you set style.backgroundColor.
// Patch CSSStyleDeclaration so inline hex values are preserved exactly as assigned,
// which lets tests assert `fill.style.backgroundColor === '#2ecc71'` instead of rgb().
{
	const proto = window.CSSStyleDeclaration.prototype;
	const desc = Object.getOwnPropertyDescriptor(proto, 'backgroundColor');
	if (desc && desc.get && desc.set) {
		const _rawBg = Symbol('rawBg');
		Object.defineProperty(proto, 'backgroundColor', {
			get(this: CSSStyleDeclaration & { [_rawBg]?: string }) {
				return this[_rawBg] ?? desc.get!.call(this);
			},
			set(this: CSSStyleDeclaration & { [_rawBg]?: string }, value: string) {
				this[_rawBg] = value;
				desc.set!.call(this, value);
			},
			enumerable: true,
			configurable: true,
		});
	}
}
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

// Node.js 25 ships a built-in localStorage stub that lacks setItem/getItem
// unless --localstorage-file is provided. Vitest's jsdom environment should
// override it, but the global may leak through. Provide a minimal in-memory
// fallback so beforeEach/afterEach calls don't throw.
if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') {
	const store: Record<string, string> = {};
	Object.defineProperty(globalThis, 'localStorage', {
		value: {
			getItem: (k: string) => store[k] ?? null,
			setItem: (k: string, v: string) => { store[k] = String(v); },
			removeItem: (k: string) => { delete store[k]; },
			clear: () => { Object.keys(store).forEach(k => delete store[k]); },
			key: (i: number) => Object.keys(store)[i] ?? null,
			get length() { return Object.keys(store).length; },
		},
		writable: true,
		configurable: true,
	});
}

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
