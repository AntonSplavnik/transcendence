import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import GameHud from '@/components/GameBoard/hud/GameHud';
import { useHudState } from '@/components/GameBoard/hud/useHudState';
import { renderHook } from '@testing-library/react';
import type { GameStateSnapshot } from '@/game/types';

const makeSnapshot = (overrides = {}): GameStateSnapshot => ({
	frame_number: 1,
	timestamp: 0,
	characters: [
		{
			player_id: 42,
			position: { x: 0, y: 0, z: 0 },
			velocity: { x: 0, y: 0, z: 0 },
			yaw: 0,
			state: 0,
			health: 80,
			max_health: 100,
			ability1_timer: 0,
			ability1_cooldown: 5,
			ability2_timer: 3,
			ability2_cooldown: 8,
			swing_progress: 0,
			is_grounded: true,
			stamina: 60,
			max_stamina: 100,
			exhausted: false,
			...overrides,
		},
	],
});

describe('useHudState', () => {
	let rafCallbacks: ((time: number) => void)[];
	let rafId: number;

	beforeEach(() => {
		rafCallbacks = [];
		rafId = 0;
		vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
			rafCallbacks.push(cb);
			return ++rafId;
		});
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function flushRaf(time: number) {
		const cbs = rafCallbacks.splice(0);
		for (const cb of cbs) cb(time);
	}

	it('returns null when snapshot ref is empty', () => {
		const ref = { current: null };
		const { result } = renderHook(() => useHudState(ref, 42));

		act(() => flushRaf(100));

		expect(result.current).toBeNull();
	});

	it('extracts HUD state from snapshot', () => {
		const ref = { current: makeSnapshot() };
		const { result } = renderHook(() => useHudState(ref, 42));

		act(() => flushRaf(100));

		expect(result.current).not.toBeNull();
		expect(result.current!.health).toBe(80);
		expect(result.current!.stamina).toBe(60);
	});

	it('returns null when local player not in snapshot', () => {
		const ref = { current: makeSnapshot() };
		const { result } = renderHook(() => useHudState(ref, 999));

		act(() => flushRaf(100));

		expect(result.current).toBeNull();
	});
});

describe('GameHud', () => {
	let rafCallbacks: ((time: number) => void)[];
	let rafId: number;

	beforeEach(() => {
		rafCallbacks = [];
		rafId = 0;
		vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
			rafCallbacks.push(cb);
			return ++rafId;
		});
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function flushRaf(time: number) {
		const cbs = rafCallbacks.splice(0);
		for (const cb of cbs) cb(time);
	}

	it('renders nothing when no snapshot available', () => {
		const ref = { current: null };
		render(<GameHud snapshotRef={ref} localPlayerId={42} />);

		act(() => flushRaf(100));

		expect(screen.queryByTestId('game-hud')).not.toBeInTheDocument();
	});

	it('renders all HUD elements when snapshot available', () => {
		const ref = { current: makeSnapshot() };
		render(<GameHud snapshotRef={ref} localPlayerId={42} />);

		act(() => flushRaf(100));

		expect(screen.getByTestId('game-hud')).toBeInTheDocument();
		expect(screen.getByText('❤️')).toBeInTheDocument();
		expect(screen.getByText('⚡')).toBeInTheDocument();
		expect(screen.getByTestId('ability-bar')).toBeInTheDocument();
	});

	it('dims HUD to 30% opacity when player is dead', () => {
		const ref = { current: makeSnapshot({ state: 6 }) };
		render(<GameHud snapshotRef={ref} localPlayerId={42} />);

		act(() => flushRaf(100));

		const hud = screen.getByTestId('game-hud');
		expect(hud.style.opacity).toBe('0.3');
	});

	it('has full opacity when player is alive', () => {
		const ref = { current: makeSnapshot({ state: 0 }) };
		render(<GameHud snapshotRef={ref} localPlayerId={42} />);

		act(() => flushRaf(100));

		const hud = screen.getByTestId('game-hud');
		expect(hud.style.opacity).toBe('1');
	});
});
