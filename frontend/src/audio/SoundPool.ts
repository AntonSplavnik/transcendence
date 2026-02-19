import type { MixerBus } from './MixerBus';
import type { Vector3D } from '../game/types';

export interface PlayRequest {
  buffer: AudioBuffer;
  bus: MixerBus;
  volume: number;
  pitch: number;
  spatial?: { position: Vector3D; listenerPos: Vector3D };
  priority: number;
  context: AudioContext;
}

export class SoundInstance {
  private source: AudioBufferSourceNode;
  private gainNode: GainNode;
  private pannerNode: PannerNode | null = null;
  private playing = true;

  constructor(request: PlayRequest) {
    const { context, buffer, bus, volume, pitch, spatial } = request;

    // Create source
    this.source = context.createBufferSource();
    this.source.buffer = buffer;
    this.source.playbackRate.value = pitch;

    // Create gain
    this.gainNode = context.createGain();
    this.gainNode.gain.value = volume;

    // Build audio graph
    if (spatial) {
      this.pannerNode = context.createPanner();
      this.pannerNode.panningModel = 'HRTF';
      this.pannerNode.distanceModel = 'inverse';
      this.pannerNode.refDistance = 5;
      this.pannerNode.maxDistance = 50;
      this.pannerNode.rolloffFactor = 1;
      this.pannerNode.positionX.value = spatial.position.x;
      this.pannerNode.positionY.value = spatial.position.y;
      this.pannerNode.positionZ.value = spatial.position.z;

      // Set listener position
      const listener = context.listener;
      if (listener.positionX) {
        listener.positionX.value = spatial.listenerPos.x;
        listener.positionY.value = spatial.listenerPos.y;
        listener.positionZ.value = spatial.listenerPos.z;
      }

      this.source.connect(this.gainNode);
      this.gainNode.connect(this.pannerNode);
      this.pannerNode.connect(bus.getOutputNode());
    } else {
      this.source.connect(this.gainNode);
      this.gainNode.connect(bus.getOutputNode());
    }

    this.source.onended = () => {
      this.playing = false;
    };

    this.source.start();
  }

  stop(): void {
    if (this.playing) {
      this.source.stop();
      this.playing = false;
    }
  }

  setPosition(pos: Vector3D): void {
    if (this.pannerNode) {
      this.pannerNode.positionX.value = pos.x;
      this.pannerNode.positionY.value = pos.y;
      this.pannerNode.positionZ.value = pos.z;
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }

  dispose(): void {
    this.source.disconnect();
    this.gainNode.disconnect();
    if (this.pannerNode) this.pannerNode.disconnect();
  }
}

export class SoundPool {
  private activeSounds: SoundInstance[] = [];
  private maxConcurrent: number;

  constructor(maxConcurrent = 32) {
    this.maxConcurrent = maxConcurrent;
  }

  play(request: PlayRequest): SoundInstance | null {
    // Clean up finished sounds first
    this.update();

    // If at capacity, evict lowest priority
    if (this.activeSounds.length >= this.maxConcurrent) {
      // Can't play - at capacity
      return null;
    }

    const instance = new SoundInstance(request);
    this.activeSounds.push(instance);
    return instance;
  }

  stopAll(): void {
    for (const sound of this.activeSounds) {
      sound.stop();
      sound.dispose();
    }
    this.activeSounds = [];
  }

  update(): void {
    this.activeSounds = this.activeSounds.filter((sound) => {
      if (!sound.isPlaying()) {
        sound.dispose();
        return false;
      }
      return true;
    });
  }

  getActiveCount(): number {
    return this.activeSounds.length;
  }
}
