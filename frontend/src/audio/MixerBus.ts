export class MixerBus {
  private gainNode: GainNode;
  private name: string;
  private muted = false;
  private savedVolume = 1.0;

  constructor(context: AudioContext, name: string) {
    this.name = name;
    this.gainNode = context.createGain();
  }

  setVolume(volume: number): void {
    this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    if (!this.muted) {
      this.savedVolume = this.gainNode.gain.value;
    }
  }

  getVolume(): number {
    return this.gainNode.gain.value;
  }

  mute(): void {
    if (!this.muted) {
      this.savedVolume = this.gainNode.gain.value;
      this.gainNode.gain.value = 0;
      this.muted = true;
    }
  }

  unmute(): void {
    if (this.muted) {
      this.gainNode.gain.value = this.savedVolume;
      this.muted = false;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  connect(destination: MixerBus): void {
    this.gainNode.connect(destination.getOutputNode());
  }

  connectToDestination(destination: AudioNode): void {
    this.gainNode.connect(destination);
  }

  getOutputNode(): GainNode {
    return this.gainNode;
  }

  getName(): string {
    return this.name;
  }
}
