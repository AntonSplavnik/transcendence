import { describe, it, expect } from 'vitest';
import { extractHudState, hudStateEqual } from '@/components/GameBoard/hud/types';
import type { CharacterSnapshot } from '@/game/types';

const baseChar: CharacterSnapshot = {
	player_id: 1,
	position: { x: 0, y: 0, z: 0 },
	velocity: { x: 0, y: 0, z: 0 },
	yaw: 0,
	state: 0,
	health: 80,
	max_health: 100,
	ability1_timer: 2.5,
	ability1_cooldown: 5,
	ability2_timer: 0,
	ability2_cooldown: 8,
	swing_progress: 0,
	is_grounded: true,
	stamina: 60,
	max_stamina: 100,
	exhausted: false,
};

describe('extractHudState', () => {
	it('extracts relevant fields from CharacterSnapshot', () => {
		const hud = extractHudState(baseChar);
		expect(hud).toEqual({
			health: 80,
			maxHealth: 100,
			stamina: 60,
			maxStamina: 100,
			exhausted: false,
			state: 0,
			ability1Timer: 2.5,
			ability1Cooldown: 5,
			ability2Timer: 0,
			ability2Cooldown: 8,
		});
	});

	it('preserves exhausted=true', () => {
		const hud = extractHudState({ ...baseChar, exhausted: true, stamina: 0 });
		expect(hud.exhausted).toBe(true);
		expect(hud.stamina).toBe(0);
	});
});

describe('hudStateEqual', () => {
	it('returns true for identical states', () => {
		const a = extractHudState(baseChar);
		const b = extractHudState(baseChar);
		expect(hudStateEqual(a, b)).toBe(true);
	});

	it('returns false when health differs', () => {
		const a = extractHudState(baseChar);
		const b = extractHudState({ ...baseChar, health: 50 });
		expect(hudStateEqual(a, b)).toBe(false);
	});

	it('returns false when exhausted differs', () => {
		const a = extractHudState(baseChar);
		const b = extractHudState({ ...baseChar, exhausted: true });
		expect(hudStateEqual(a, b)).toBe(false);
	});

	it('returns false when ability timer differs', () => {
		const a = extractHudState(baseChar);
		const b = extractHudState({ ...baseChar, ability1_timer: 1.0 });
		expect(hudStateEqual(a, b)).toBe(false);
	});
});
