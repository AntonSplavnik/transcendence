import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { GameAudioEngine } from './AudioEngine';
import type { SoundBank } from './SoundBank';
import type { GameEvent, Vector3D } from '../game/types';
import { GameEventType } from '../game/types';

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class AudioEventSystem {
  private engine: GameAudioEngine;
  private soundBank: SoundBank;
  private lastPlayTimes = new Map<string, number>();
  private localPlayerId: number | null = null;

  constructor(engine: GameAudioEngine, soundBank: SoundBank) {
    this.engine = engine;
    this.soundBank = soundBank;
  }

  setLocalPlayerId(id: number): void {
    this.localPlayerId = id;
  }

  /** Process server events - skip local player events (already played via prediction) */
  processServerEvents(events: GameEvent[]): void {
    if (!this.engine.isInitialized()) return;

    for (const event of events) {
      if (event.player_id === this.localPlayerId) continue;

      const mapping = this.mapEventToSound(event);
      if (!mapping) continue;

      this.playSoundInternal(mapping.soundId, event.position, mapping.volume, mapping.pitch);
    }
  }

  /** Play sound immediately for local player (zero latency prediction) */
  playLocalEvent(soundId: string, position: Vector3D): void {
    if (!this.engine.isInitialized()) return;
    this.playSoundInternal(soundId, position, undefined, undefined);
  }

  private playSoundInternal(
    soundId: string,
    position: Vector3D,
    overrideVolume?: number,
    overridePitch?: number
  ): void {
    const def = this.soundBank.getDefinition(soundId);
    if (!def) return;

    // Cooldown check
    const now = performance.now();
    const lastPlay = this.lastPlayTimes.get(soundId) || 0;
    if (now - lastPlay < def.cooldown) return;
    this.lastPlayTimes.set(soundId, now);

    const sound = this.soundBank.getRandomSound(soundId);
    if (!sound) return;

    const volume = overrideVolume ?? randomRange(def.volume.min, def.volume.max);
    const pitch = overridePitch ?? randomRange(def.pitch.min, def.pitch.max);

    // Set volume and playback rate
    sound.volume = volume;
    sound.playbackRate = pitch;

    // Set spatial position if spatial is enabled
    if (def.spatial) {
      sound.spatial.position = new Vector3(position.x, position.y, position.z);
    }

    sound.play();
  }

  /** Map game event type to sound definition + parameters */
  private mapEventToSound(event: GameEvent): { soundId: string; volume: number; pitch: number } | null {
    switch (event.event_type) {
      case GameEventType.Jump:
        return {
          soundId: 'player_jump',
          volume: randomRange(0.7, 0.85),
          pitch: randomRange(0.95, 1.05),
        };

      case GameEventType.Land: {
        const impactVelocity = Math.abs(event.param1);
        const volume = Math.max(0.3, Math.min(1.0, impactVelocity / 20.0));
        return {
          soundId: 'player_land',
          volume,
          pitch: randomRange(0.9, 1.1),
        };
      }

      default:
        return null;
    }
  }
}
