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
}

export interface GameStateSnapshot {
	frame_number: number;
	timestamp: number;
	characters: CharacterSnapshot[];
}

// From backend/src/game/messages.rs
// Using discriminated union with 'type' field (matches Rust #[serde(tag = "type")])
export type GameServerMessage =
	| ({ type: 'Snapshot' } & GameStateSnapshot)
	| { type: 'PlayerJoined'; player_id: number; name: string; character_class: string }
	| { type: 'PlayerLeft'; player_id: number }
	| { type: 'Death'; killer: number; victim: number }
	| { type: 'Damage'; attacker: number; victim: number; damage: number }
	| { type: 'Spawn'; player_id: number; position: Vector3D }
	| { type: 'StateChange'; player_id: number; state: number }
	| { type: 'MatchEnd' }
	| { type: 'Error'; message: string };

/** Subset of GameServerMessage that represents in-game events (not snapshots or meta). */
export type GameEvent = Extract<
	GameServerMessage,
	{ type: 'Death' | 'Damage' | 'Spawn' | 'StateChange' | 'MatchEnd' }
>;

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
