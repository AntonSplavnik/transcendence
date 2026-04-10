import type { CharacterSnapshot, GameEvent, Vector3D } from '../game/types';

// Single source of truth for InputState (AudioEventSystem imports from here)
// SimpleGameClient.tsx keeps its own local copy for structural compatibility
export interface InputState {
	movementDirection: Vector3D;
	isAttacking: boolean;
	isJumping: boolean;
	isSprinting: boolean;
	isGrounded: boolean;
	isUsingAbility1: boolean;
	isUsingAbility2: boolean;
}

// ─── Pipeline 1: Local input triggers ────────────────────────────────────────

export interface LocalInputTrigger {
	soundId: string;
	field: keyof Pick<InputState, 'isJumping' | 'isAttacking' | 'isSprinting' | 'isUsingAbility1' | 'isUsingAbility2'>;
	edge: 'rising' | 'falling';
	volume?: number;
	/** Optional delay in ms before the sound plays — use to sync with animation */
	delayMs?: number;
}

export const LOCAL_INPUT_TRIGGERS: LocalInputTrigger[] = [
	{ soundId: 'player_jump', field: 'isJumping', edge: 'rising' },
	{ soundId: 'player_land', field: 'isJumping', edge: 'rising', delayMs: 550 },
	{ soundId: 'player_attack_swing', field: 'isAttacking', edge: 'rising', delayMs: 250 },
	{ soundId: 'player_ability1', field: 'isUsingAbility1', edge: 'rising', delayMs: 250 },
	{ soundId: 'player_ability2', field: 'isUsingAbility2', edge: 'rising', delayMs: 250 },
];

// ─── Pipeline 1b: Local continuous triggers ──────────────────────────────────

export interface LocalContinuousTrigger {
	soundId: string;
	/** Returns true while the sound should keep firing */
	predicate: (input: InputState) => boolean;
	/** Minimum interval (ms) between two consecutive plays */
	intervalMs: number;
	/** Override volume (uses SoundDefinition range if omitted) */
	volume?: number;
}

const isWalking = (input: InputState) =>
	input.isGrounded &&
	!input.isSprinting &&
	(input.movementDirection.x !== 0 || input.movementDirection.z !== 0);

const isRunning = (input: InputState) =>
	input.isGrounded &&
	input.isSprinting &&
	(input.movementDirection.x !== 0 || input.movementDirection.z !== 0);


export const LOCAL_CONTINUOUS_TRIGGERS: LocalContinuousTrigger[] = [
	{ soundId: 'player_footstep', predicate: isWalking, intervalMs: 550 },
	{ soundId: 'player_footstep', predicate: isRunning, intervalMs: 320, volume: 0.4 },
];

// ─── Pipeline 2: Remote snapshot triggers ────────────────────────────────────

export interface RemoteSnapshotTrigger {
	soundId: string;
	predicate: (prev: CharacterSnapshot, cur: CharacterSnapshot) => boolean;
	volumeMapper?: (prev: CharacterSnapshot, cur: CharacterSnapshot) => number;
	/** true = pipeline applies adaptive per-player throttle (footstep-style) */
	throttled?: boolean;
}

export const REMOTE_SNAPSHOT_TRIGGERS: RemoteSnapshotTrigger[] = [
	{
		soundId: 'player_land',
		predicate: (prev, cur) => prev.velocity.y < -2 && cur.velocity.y >= -0.5,
		volumeMapper: (prev) => Math.max(0.3, Math.min(1.0, Math.abs(prev.velocity.y) / 20.0)),
	},
	{
		soundId: 'player_jump',
		predicate: (prev, cur) => prev.velocity.y <= 0.5 && cur.velocity.y > 5,
	},
	{
		soundId: 'player_footstep',
		predicate: (_, cur) => Math.sqrt(cur.velocity.x ** 2 + cur.velocity.z ** 2) > 2.0,
		throttled: true,
	},
	// { soundId: 'player_hit_react', predicate: (prev, cur) => cur.health < prev.health },
];

// ─── Pipeline 3: Game event triggers ─────────────────────────────────────────
//
// Unified data-driven dispatcher for discrete gameplay events arriving from the
// server (GameServerMessage → GameEvent: Damage, Death, Spawn, StateChange…).
//
// Adding a new sound for any gameplay event = 1 entry in GAME_EVENT_TRIGGERS.
// No new methods, no new plumbing — the dispatcher in AudioEventSystem stays as-is.

/** Runtime context passed to every trigger, so callbacks can resolve positions. */
export interface GameEventContext {
	localPlayerId: number;
	localPosition: Vector3D;
	/** Last-known server positions for remote players (prev snapshot). */
	remotePositions: ReadonlyMap<number, Vector3D>;
}

/** Loose runtime shape stored in the table (narrowed via the `trigger()` helper). */
export interface GameEventTrigger {
	type: GameEvent['type'];
	soundId: string;
	/** Optional filter — e.g. only fire when local player is the attacker. */
	predicate?: (event: GameEvent, ctx: GameEventContext) => boolean;
	/** Return 3D position for spatial playback, or null to skip this event. */
	position: (event: GameEvent, ctx: GameEventContext) => Vector3D | null;
	volumeMapper?: (event: GameEvent) => number;
}

/**
 * Type-safe authoring helper: narrows the event type inside each callback,
 * so `e.attacker` / `e.victim` / etc. are known properties when authoring.
 */
function trigger<T extends GameEvent['type']>(
	type: T,
	cfg: {
		soundId: string;
		predicate?: (event: Extract<GameEvent, { type: T }>, ctx: GameEventContext) => boolean;
		position: (
			event: Extract<GameEvent, { type: T }>,
			ctx: GameEventContext,
		) => Vector3D | null;
		volumeMapper?: (event: Extract<GameEvent, { type: T }>) => number;
	},
): GameEventTrigger {
	return {
		type,
		soundId: cfg.soundId,
		predicate: cfg.predicate as GameEventTrigger['predicate'],
		position: cfg.position as GameEventTrigger['position'],
		volumeMapper: cfg.volumeMapper as GameEventTrigger['volumeMapper'],
	};
}

export const GAME_EVENT_TRIGGERS: GameEventTrigger[] = [
	// Local player landed a hit → confirmation SFX at the victim's position.
	trigger('Damage', {
		soundId: 'player_hit',
		predicate: (e, ctx) => e.attacker === ctx.localPlayerId,
		position: (e, ctx) => ctx.remotePositions.get(e.victim) ?? ctx.localPosition,
	}),
	// Examples for future sounds — uncomment & provide the SFX file + definition:
	// trigger('Death', {
	//   soundId: 'player_death',
	//   position: (e, ctx) => ctx.remotePositions.get(e.victim) ?? ctx.localPosition,
	// }),
	// trigger('Spawn', {
	//   soundId: 'player_spawn',
	//   position: (e) => e.position,
	// }),
];
