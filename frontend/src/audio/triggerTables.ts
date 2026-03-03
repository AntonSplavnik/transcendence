import type { CharacterSnapshot, GameEvent } from '../game/types';
import { GameEventType } from '../game/types';
import type { Vector3D } from '../game/types';

// Single source of truth for InputState (AudioEventSystem imports from here)
// SimpleGameClient.tsx keeps its own local copy for structural compatibility
export interface InputState {
  movementDirection: Vector3D;
  isAttacking: boolean;
  isJumping: boolean;
  isSprinting: boolean;
  // Extend here: isDodging, isBlocking, isAbility1…
}

// ─── Pipeline 1: Local input triggers ────────────────────────────────────────

export interface LocalInputTrigger {
  soundId: string;
  field: keyof Pick<InputState, 'isJumping' | 'isAttacking' | 'isSprinting'>;
  edge: 'rising' | 'falling';
  volume?: number;
}

export const LOCAL_INPUT_TRIGGERS: LocalInputTrigger[] = [
  { soundId: 'player_jump', field: 'isJumping', edge: 'rising' },
  // { soundId: 'player_attack_swing', field: 'isAttacking', edge: 'rising' },
  // { soundId: 'player_dodge',        field: 'isDodging',   edge: 'rising' },
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

// ─── Pipeline 3: Server event triggers ───────────────────────────────────────

export interface ServerEventTrigger {
  eventType: number;
  soundId: string;
  /** true = already played via Pipeline 1 for local player; skip to avoid double */
  skipLocal?: boolean;
  volumeMapper?: (event: GameEvent) => number;
}

export const SERVER_EVENT_TRIGGERS: ServerEventTrigger[] = [
  { eventType: GameEventType.Jump, soundId: 'player_jump', skipLocal: true },
  {
    eventType: GameEventType.Land,
    soundId: 'player_land',
    volumeMapper: (e) => Math.max(0.3, Math.min(1.0, Math.abs(e.param1) / 20.0)),
  },
  // { eventType: GameEventType.Hit,   soundId: 'player_hit' },
  // { eventType: GameEventType.Death, soundId: 'player_death' },
  // { eventType: GameEventType.Dodge, soundId: 'player_dodge', skipLocal: true },
];
