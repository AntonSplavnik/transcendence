import type { CharacterSnapshot } from '@/game/types';

export interface HudState {
	health: number;
	maxHealth: number;
	stamina: number;
	maxStamina: number;
	exhausted: boolean;
	state: number;
	ability1Timer: number;
	ability1Cooldown: number;
	ability2Timer: number;
	ability2Cooldown: number;
}

export function extractHudState(char: CharacterSnapshot): HudState {
	return {
		health: char.health,
		maxHealth: char.max_health,
		stamina: char.stamina,
		maxStamina: char.max_stamina,
		exhausted: char.exhausted,
		state: char.state,
		ability1Timer: char.ability1_timer,
		ability1Cooldown: char.ability1_cooldown,
		ability2Timer: char.ability2_timer,
		ability2Cooldown: char.ability2_cooldown,
	};
}

export function hudStateEqual(a: HudState, b: HudState): boolean {
	return (
		a.health === b.health &&
		a.maxHealth === b.maxHealth &&
		a.stamina === b.stamina &&
		a.maxStamina === b.maxStamina &&
		a.exhausted === b.exhausted &&
		a.state === b.state &&
		a.ability1Timer === b.ability1Timer &&
		a.ability1Cooldown === b.ability1Cooldown &&
		a.ability2Timer === b.ability2Timer &&
		a.ability2Cooldown === b.ability2Cooldown
	);
}
