import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { GameAudioEngine } from './AudioEngine';
import type { SoundBank } from './SoundBank';
import type { GameEvent, Vector3D, CharacterSnapshot } from '../game/types';
import {
  LOCAL_INPUT_TRIGGERS,
  LOCAL_CONTINUOUS_TRIGGERS,
  REMOTE_SNAPSHOT_TRIGGERS,
  SERVER_EVENT_TRIGGERS,
} from './triggerTables';
import type { InputState } from './triggerTables';

export type { InputState };

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class AudioEventSystem {
  private engine: GameAudioEngine;
  private soundBank: SoundBank;
  private lastPlayTimes = new Map<string, number>();
  private localPlayerId: number | null = null;
  // Pipeline 1: edge-detection state — auto-initialised from LOCAL_INPUT_TRIGGERS
  private prevInputState: Record<string, boolean> = {};
  // Pipeline 2: per-player adaptive footstep timers
  private footstepTimers = new Map<number, number>();
  // Pipeline 1b: continuous trigger timers (local player)
  private continuousTimers = new Map<string, number>();

  constructor(engine: GameAudioEngine, soundBank: SoundBank) {
    this.engine = engine;
    this.soundBank = soundBank;
    for (const trigger of LOCAL_INPUT_TRIGGERS) {
      this.prevInputState[trigger.field] = false;
    }
  }

  setLocalPlayerId(id: number): void {
    this.localPlayerId = id;
  }

  /** Pipeline 1: local player input (0 ms, same trigger as updateLocalAnimation) */
  onLocalInput(input: InputState, position: Vector3D): void {
    if (!this.engine.isInitialized()) return;

    for (const trigger of LOCAL_INPUT_TRIGGERS) {
      const current = input[trigger.field] as boolean;
      const previous = this.prevInputState[trigger.field];
      const fired = trigger.edge === 'rising' ? current && !previous : !current && previous;

      if (fired) {
        this.playSoundAt(trigger.soundId, position, trigger.volume);
      }
      this.prevInputState[trigger.field] = current;
    }

    // Pipeline 1b: continuous triggers (e.g. footsteps while walking)
    for (const trigger of LOCAL_CONTINUOUS_TRIGGERS) {
      if (!trigger.predicate(input)) continue;

      const now = performance.now();
      const last = this.continuousTimers.get(trigger.soundId) ?? 0;
      if (now - last < trigger.intervalMs) continue;

      this.continuousTimers.set(trigger.soundId, now);
      this.playSoundAt(trigger.soundId, position, trigger.volume);
    }
  }

  /** Pipeline 2: remote players via snapshot delta (same trigger as updateRemoteAnimation) */
  onRemoteSnapshot(prev: CharacterSnapshot, cur: CharacterSnapshot): void {
    if (!this.engine.isInitialized()) return;

    for (const trigger of REMOTE_SNAPSHOT_TRIGGERS) {
      if (!trigger.predicate(prev, cur)) continue;

      if (trigger.throttled) {
        const speedXZ = Math.sqrt(cur.velocity.x ** 2 + cur.velocity.z ** 2);
        const interval = Math.max(200, 500 - speedXZ * 15);
        const now = performance.now();
        const lastFootstep = this.footstepTimers.get(cur.player_id) ?? 0;
        if (now - lastFootstep < interval) continue;
        this.footstepTimers.set(cur.player_id, now);
      }

      const volume = trigger.volumeMapper?.(prev, cur);
      this.playSoundAt(trigger.soundId, cur.position, volume);
    }
  }

  /** Pipeline 3: server critical events */
  onServerEvents(events: GameEvent[]): void {
    if (!this.engine.isInitialized()) return;

    for (const event of events) {
      for (const trigger of SERVER_EVENT_TRIGGERS) {
        if (event.event_type !== trigger.eventType) continue;
        if (trigger.skipLocal && event.player_id === this.localPlayerId) continue;

        const volume = trigger.volumeMapper?.(event);
        this.playSoundAt(trigger.soundId, event.position, volume);
      }
    }
  }

  private playSoundAt(
    soundId: string,
    position: Vector3D,
    overrideVolume?: number,
    overridePitch?: number,
  ): void {
    const def = this.soundBank.getDefinition(soundId);
    if (!def) return;

    const now = performance.now();
    const lastPlay = this.lastPlayTimes.get(soundId) ?? 0;
    if (now - lastPlay < def.cooldown) return;
    this.lastPlayTimes.set(soundId, now);

    const sound = this.soundBank.getRandomSound(soundId);
    if (!sound) return;

    sound.volume = overrideVolume ?? randomRange(def.volume.min, def.volume.max);
    sound.playbackRate = overridePitch ?? randomRange(def.pitch.min, def.pitch.max);

    if (def.spatial) {
      sound.spatial.position = new Vector3(position.x, position.y, position.z);
    }

    sound.play();
  }
}
