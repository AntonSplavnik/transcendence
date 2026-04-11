// TypeScript types mirroring backend Rust definitions
// From backend/src/game/ffi.rs and backend/src/game/messages.rs

export interface Vector3D {
	x: number;
	y: number;
	z: number;
}

export interface CharacterSnapshot {
	player_id: number;
	position: Vector3D;
	velocity: Vector3D;
	yaw: number;
	state: number;
	health: number;
	max_health: number;
	// Cooldown data
	ability1_timer: number;
	ability1_cooldown: number;
	ability2_timer: number;
	ability2_cooldown: number;
	swing_progress: number;
	is_grounded: boolean;
	// Stamina data
	stamina: number;
	max_stamina: number;
}

export interface GameStateSnapshot {
	frame_number: number;
	timestamp: number;
	characters: CharacterSnapshot[];
}

/** Per-player stats sent with the MatchEnd event. Mirrors backend PlayerMatchStatsPayload. */
export interface PlayerMatchStats {
	player_id: number;
	name: string;
	character_class: string;
	kills: number;
	deaths: number;
	damage_dealt: number;
	damage_taken: number;
	placement: number;
}

// From backend/src/game/messages.rs
// Using discriminated union with 'type' field (matches Rust #[serde(tag = "type")])
export type GameServerMessage =
	| ({ type: 'Snapshot' } & GameStateSnapshot)
	| { type: 'PlayerLeft'; player_id: number }
	| { type: 'Death'; killer: number; victim: number }
	| { type: 'Damage'; attacker: number; victim: number; damage: number }
	| { type: 'Spawn'; player_id: number; position: Vector3D; name: string; character_class: string }
	| { type: 'StateChange'; player_id: number; state: number }
	| { type: 'AttackStarted'; player_id: number; chain_stage: number }
	| { type: 'SkillUsed'; player_id: number; skill_slot: number }
	| { type: 'MatchEnd'; players: PlayerMatchStats[] }
	| { type: 'Error'; message: string };

// Game events sent by the server for audio/VFX triggers
export const AudioEventType = {
	Jump: 1,
	Land: 2,
	Hit: 3,
	Death: 4,
	Dodge: 5,
} as const;

export interface AudioEvent {
	event_type: number;
	player_id: number;
	position: Vector3D;
	param1: number;
}

/** Subset of GameServerMessage that represents in-game events (not snapshots or meta). */
export type GameEvent = Extract<
	GameServerMessage,
	{ type: 'Death' | 'Damage' | 'Spawn' | 'StateChange' | 'AttackStarted' | 'SkillUsed' | 'MatchEnd' }
>;

export interface InputState {
	movementDirection: Vector3D;
	isAttacking: boolean;
	isJumping: boolean;
	isSprinting: boolean;
	isGrounded: boolean;
	isUsingAbility1: boolean;
	isUsingAbility2: boolean;
}

export type GameClientMessage =
	| {
			type: 'Input';
			movement: Vector3D;
			look_direction: Vector3D;
			attacking?: boolean;
			jumping?: boolean;
			sprinting?: boolean;
			ability1?: boolean;
			ability2?: boolean;
			dodging?: boolean;
	  }
	| { type: 'RegisterHit'; victim_id: number; damage: number }
	| { type: 'Leave' };
