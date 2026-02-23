import type { StaticSound } from '@babylonjs/core/AudioV2';
import type { GameAudioEngine } from './AudioEngine';
import { SOUND_DEFINITIONS } from './soundDefinitions';

export interface SoundDefinition {
  id: string;
  variations: string[];
  volume: { min: number; max: number };
  pitch: { min: number; max: number };
  bus: 'sfx' | 'music' | 'ambient' | 'ui';
  spatial: boolean;
  maxDistance: number;
  minDistance: number;
  cooldown: number;
  priority: number;
  maxInstances: number;
}

export class SoundBank {
  private definitions = new Map<string, SoundDefinition>();
  private sounds = new Map<string, StaticSound[]>();

  async loadAll(engine: GameAudioEngine): Promise<void> {
    for (const def of SOUND_DEFINITIONS) {
      this.definitions.set(def.id, def);
    }

    const audioEngine = engine.getEngine();
    const loadPromises: Promise<void>[] = [];

    for (const def of SOUND_DEFINITIONS) {
      const promise = this.loadSoundDefinition(def, engine, audioEngine).catch(err => {
        console.warn(`Failed to load sounds for "${def.id}":`, err);
      });
      loadPromises.push(promise);
    }

    await Promise.all(loadPromises);
  }

  private async loadSoundDefinition(
    def: SoundDefinition,
    engine: GameAudioEngine,
    audioEngine: import('@babylonjs/core/AudioV2').AudioEngineV2,
  ): Promise<void> {
    const bus = engine.getBus(def.bus);
    const variations: StaticSound[] = [];

    for (const url of def.variations) {
      try {
        const sound = await audioEngine.createSoundAsync(def.id, url, {
          outBus: bus,
          maxInstances: def.maxInstances,
          spatialEnabled: def.spatial,
          spatialMinDistance: def.minDistance,
          spatialMaxDistance: def.maxDistance,
          spatialDistanceModel: 'inverse',
          spatialPanningModel: 'HRTF',
        });
        variations.push(sound);
      } catch {
        console.warn(`Failed to load sound "${def.id}" from ${url}, using procedural fallback`);
        const fallbackSound = await this.createProceduralFallback(def, engine, audioEngine);
        if (fallbackSound) variations.push(fallbackSound);
      }
    }

    this.sounds.set(def.id, variations);
  }

  private async createProceduralFallback(
    def: SoundDefinition,
    engine: GameAudioEngine,
    audioEngine: import('@babylonjs/core/AudioV2').AudioEngineV2,
  ): Promise<StaticSound | null> {
    const sampleRate = 44100;
    const id = def.id;
    let buffer: AudioBuffer;

    if (id.includes('jump')) {
      const duration = 0.12;
      buffer = new AudioBuffer({ length: Math.ceil(sampleRate * duration), sampleRate });
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const freq = 200 + (t / duration) * 400;
        const envelope = Math.max(0, 1 - t / duration);
        data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3;
      }
    } else if (id.includes('land')) {
      const duration = 0.15;
      buffer = new AudioBuffer({ length: Math.ceil(sampleRate * duration), sampleRate });
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const freq = 80 + Math.exp(-t * 30) * 120;
        const envelope = Math.exp(-t * 20);
        const noise = (Math.random() * 2 - 1) * 0.15;
        data[i] = (Math.sin(2 * Math.PI * freq * t) * 0.5 + noise) * envelope;
      }
    } else {
      const duration = 0.1;
      buffer = new AudioBuffer({ length: Math.ceil(sampleRate * duration), sampleRate });
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const envelope = Math.max(0, 1 - t / duration);
        data[i] = Math.sin(2 * Math.PI * 440 * t) * envelope * 0.2;
      }
    }

    try {
      const bus = engine.getBus(def.bus);
      return await audioEngine.createSoundAsync(id, buffer, {
        outBus: bus,
        maxInstances: def.maxInstances,
        spatialEnabled: def.spatial,
        spatialMinDistance: def.minDistance,
        spatialMaxDistance: def.maxDistance,
        spatialDistanceModel: 'inverse',
        spatialPanningModel: 'HRTF',
      });
    } catch (err) {
      console.warn(`Failed to create procedural fallback for "${id}":`, err);
      return null;
    }
  }

  getDefinition(id: string): SoundDefinition | undefined {
    return this.definitions.get(id);
  }

  getRandomSound(id: string): StaticSound | undefined {
    const variations = this.sounds.get(id);
    if (!variations || variations.length === 0) return undefined;
    return variations[Math.floor(Math.random() * variations.length)];
  }
}
