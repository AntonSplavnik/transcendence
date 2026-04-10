
// ── Character state enum (mirrors backend) ──────────────────────────

export const CharacterState = {
	Idle: 0,
	Walking: 1,
	Sprinting: 2,
	Attacking: 3,
	Casting: 4,
	Stunned: 5,
	Dead: 6,
} as const;
export type CharacterState = (typeof CharacterState)[keyof typeof CharacterState];

// ── Isometric camera ────────────────────────────────────────────────

/** Distance from camera to target (doesn't affect size in ortho, just clipping) */
export const ISO_CAM_DIST = 80;
export const ISO_CAM_HEIGHT = ISO_CAM_DIST * 0.7071; // tan(35.264deg)
export const ISO_CAM_OFFSET = { x: ISO_CAM_DIST, y: ISO_CAM_HEIGHT, z: -ISO_CAM_DIST };
/** Controls zoom level (80 would be full world in view) */
export const ISO_ORTHO_SIZE = 10;

// ── HUD layout ─────────────────────────────────────────────────────

/** Vertical offset (world units) for enemy health bar above character root */
export const ENEMY_BAR_Y_OFFSET = 2.4;

// ── Combat tuning ───────────────────────────────────────────────────

/** Crossfade seconds between chain attack animations */
export const COMBAT_BLEND_DURATION = 0.1;

// ── Shared animation names ──────────────────────────────────────────

export const AnimationNames = {
	jumpStart: 'Jump_Start',
	jumpIdle: 'Jump_Idle',
	jumpLand: 'Jump_Land',
	hit: 'Hit_A',
	death: 'Death_A',
	deathPose: 'Death_pose_A',
	spawn: 'Spawn_Air',
};

// ── Input ───────────────────────────────────────────────────────────

// InputState is defined in game/types.ts (single source of truth)
export type { InputState } from './types';

/**
 * Precomputed isometric directions (camera rotated 45deg around Y).
 * Key: bitmask WASD (W=8, A=4, S=2, D=1), Value: [worldX, worldZ] normalized.
 */
const S = 0.7071;
export const ISO_DIRECTIONS: Record<number, [number, number]> = {
	0: [0, 0],     // no input
	8: [-S, S],    // W
	2: [S, -S],    // S
	4: [-S, -S],   // A
	1: [S, S],     // D
	9: [0, 1],     // W+D
	12: [-1, 0],   // W+A
	3: [1, 0],     // S+D
	6: [0, -1],    // S+A
	10: [0, 0],    // W+S (cancel)
	5: [0, 0],     // A+D (cancel)
	15: [0, 0],    // all (cancel)
	14: [-S, -S],  // W+A+S
	13: [-S, S],   // W+A+D
	11: [S, S],    // W+S+D
	7: [S, -S],    // A+S+D
};
