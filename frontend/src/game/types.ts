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

// Game events for audio/effects
export interface GameEvent {
  event_type: number;
  player_id: number;
  position: Vector3D;
  param1: number;
  param2: number;
}

export const GameEventType = {
  Jump: 0,
  Land: 1,
  Hit: 2,
  Death: 3,
  Footstep: 4,
  Attack: 5,
  Dodge: 6,
} as const;

// From backend/src/game/messages.rs
// Using discriminated union with 'type' field (matches Rust #[serde(tag = "type")])
export type GameServerMessage =
  | ({ type: 'Snapshot' } & GameStateSnapshot)
  | { type: 'GameEvents'; events: GameEvent[] }
  | { type: 'PlayerJoined'; player_id: number; name: string }
  | { type: 'PlayerLeft'; player_id: number }
  | { type: 'Error'; message: string };

export type GameClientMessage =
  | {
      type: 'Input';
      movement: Vector3D;
      look_direction: Vector3D;
      attacking?: boolean;
      jumping?: boolean;
      ability1?: boolean;
      ability2?: boolean;
      dodging?: boolean;
    }
  | { type: 'RegisterHit'; victim_id: number; damage: number }
  | { type: 'Leave' };
