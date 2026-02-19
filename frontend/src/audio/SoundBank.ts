import type { AudioEngine } from './AudioEngine';

export interface SoundDefinition {
  id: string;
  variations: string[];
  volume: { min: number; max: number };
  pitch: { min: number; max: number };
  bus: string;
  spatial: boolean;
  maxDistance: number;
  refDistance: number;
  cooldown: number;   // ms between plays
  priority: number;   // 0-10, higher = more important
}

export class SoundBank {
  private definitions = new Map<string, SoundDefinition>();
  private buffers = new Map<string, AudioBuffer[]>();
  private engine: AudioEngine;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  register(definition: SoundDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  async loadAll(): Promise<void> {
    const context = this.engine.getContext();
    const loadPromises: Promise<void>[] = [];

    for (const [id, def] of this.definitions) {
      const bufferPromise = Promise.all(
        def.variations.map(async (url) => {
          try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            return await context.decodeAudioData(arrayBuffer);
          } catch (err) {
            console.warn(`Failed to load sound "${id}" from ${url}, using procedural fallback`);
            return this.createProceduralFallback(context, id);
          }
        })
      ).then((loadedBuffers) => {
        this.buffers.set(id, loadedBuffers);
      });

      loadPromises.push(bufferPromise);
    }

    await Promise.all(loadPromises);
  }

  getDefinition(id: string): SoundDefinition | undefined {
    return this.definitions.get(id);
  }

  getRandomBuffer(id: string): AudioBuffer | undefined {
    const buffers = this.buffers.get(id);
    if (!buffers || buffers.length === 0) return undefined;
    return buffers[Math.floor(Math.random() * buffers.length)];
  }

  /** Generate a simple procedural sound as fallback when .wav files aren't available */
  private createProceduralFallback(context: AudioContext, id: string): AudioBuffer {
    const sampleRate = context.sampleRate;

    if (id.includes('jump')) {
      // Short rising chirp
      const duration = 0.12;
      const buffer = context.createBuffer(1, sampleRate * duration, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const freq = 200 + (t / duration) * 400;
        const envelope = Math.max(0, 1 - t / duration);
        data[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.3;
      }
      return buffer;
    }

    if (id.includes('land')) {
      // Short thud/impact
      const duration = 0.15;
      const buffer = context.createBuffer(1, sampleRate * duration, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const freq = 80 + Math.exp(-t * 30) * 120;
        const envelope = Math.exp(-t * 20);
        // Mix sine with noise for impact feel
        const noise = (Math.random() * 2 - 1) * 0.15;
        data[i] = (Math.sin(2 * Math.PI * freq * t) * 0.5 + noise) * envelope;
      }
      return buffer;
    }

    // Generic fallback: short beep
    const duration = 0.1;
    const buffer = context.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const envelope = Math.max(0, 1 - t / duration);
      data[i] = Math.sin(2 * Math.PI * 440 * t) * envelope * 0.2;
    }
    return buffer;
  }
}
