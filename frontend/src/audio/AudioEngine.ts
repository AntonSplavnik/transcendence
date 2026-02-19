import { MixerBus } from './MixerBus';

export class AudioEngine {
  private context: AudioContext | null = null;
  private masterBus!: MixerBus;
  private sfxBus!: MixerBus;
  private musicBus!: MixerBus;
  private ambientBus!: MixerBus;
  private uiBus!: MixerBus;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.context = new AudioContext();

    // Create mixer bus hierarchy: SFX/Music/Ambient/UI → Master → Destination
    this.masterBus = new MixerBus(this.context, 'master');
    this.sfxBus = new MixerBus(this.context, 'sfx');
    this.musicBus = new MixerBus(this.context, 'music');
    this.ambientBus = new MixerBus(this.context, 'ambient');
    this.uiBus = new MixerBus(this.context, 'ui');

    this.masterBus.connectToDestination(this.context.destination);
    this.sfxBus.connect(this.masterBus);
    this.musicBus.connect(this.masterBus);
    this.ambientBus.connect(this.masterBus);
    this.uiBus.connect(this.masterBus);

    // Set default volumes
    this.sfxBus.setVolume(0.8);
    this.musicBus.setVolume(0.5);
    this.ambientBus.setVolume(0.6);
    this.uiBus.setVolume(0.7);

    this.initialized = true;
  }

  /** Resume audio context (must be called after user gesture) */
  async resume(): Promise<void> {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  suspend(): void {
    if (this.context && this.context.state === 'running') {
      this.context.suspend();
    }
  }

  getContext(): AudioContext {
    if (!this.context) throw new Error('AudioEngine not initialized');
    return this.context;
  }

  getMasterBus(): MixerBus { return this.masterBus; }
  getSfxBus(): MixerBus { return this.sfxBus; }
  getMusicBus(): MixerBus { return this.musicBus; }
  getAmbientBus(): MixerBus { return this.ambientBus; }
  getUiBus(): MixerBus { return this.uiBus; }

  getBus(name: string): MixerBus {
    switch (name) {
      case 'sfx': return this.sfxBus;
      case 'music': return this.musicBus;
      case 'ambient': return this.ambientBus;
      case 'ui': return this.uiBus;
      default: return this.sfxBus;
    }
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
    if (this.context) {
      this.context.close();
      this.context = null;
      this.initialized = false;
    }
  }
}
