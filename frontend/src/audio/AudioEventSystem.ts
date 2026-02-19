import type { AudioEngine } from './AudioEngine';
import type { SoundBank } from './SoundBank';
import type { SoundPool } from './SoundPool';
import type { GameEvent, Vector3D } from '../game/types';
import { GameEventType } from '../game/types';

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class AudioEventSystem {
  private engine: AudioEngine;
  private soundBank: SoundBank;
  private soundPool: SoundPool;
  private lastPlayTimes = new Map<string, number>();
  private localPlayerId: number | null = null;

  constructor(engine: AudioEngine, soundBank: SoundBank, soundPool: SoundPool) {
    this.engine = engine;
    this.soundBank = soundBank;
    this.soundPool = soundPool;
  }

  setLocalPlayerId(id: number): void {
    this.localPlayerId = id;
  }

  /** Process server events - skip local player events (already played via prediction) */
  processServerEvents(events: GameEvent[], listenerPosition: Vector3D): void {
    if (!this.engine.isInitialized()) return;

    for (const event of events) {
      // Skip local player events - already played immediately via playLocalEvent
      if (event.player_id === this.localPlayerId) continue;

      const mapping = this.mapEventToSound(event);
      if (!mapping) continue;

      this.playSoundInternal(mapping.soundId, event.position, listenerPosition, mapping.volume, mapping.pitch);
    }
  }

  /** Play sound immediately for local player (zero latency prediction) */
  playLocalEvent(soundId: string, position: Vector3D): void {
    if (!this.engine.isInitialized()) return;
    // Local player: no spatial attenuation (it's you), play at full volume
    this.playSoundInternal(soundId, position, position, undefined, undefined);
  }

  private playSoundInternal(
    soundId: string,
    position: Vector3D,
    listenerPosition: Vector3D,
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

    const buffer = this.soundBank.getRandomBuffer(soundId);
    if (!buffer) return;

    const volume = overrideVolume ?? randomRange(def.volume.min, def.volume.max);
    const pitch = overridePitch ?? randomRange(def.pitch.min, def.pitch.max);
    const bus = this.engine.getBus(def.bus);

    this.soundPool.play({
      buffer,
      bus,
      volume,
      pitch,
      spatial: def.spatial ? { position, listenerPos: listenerPosition } : undefined,
      priority: def.priority,
      context: this.engine.getContext(),
    });
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
        // Louder landing for higher impact velocity
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
