/**
 * Simple Sound Manager for game audio
 */
export class SoundManager {
  private sounds: Map<string, HTMLAudioElement[]> = new Map();
  private currentIndex: Map<string, number> = new Map();
  private volume: number = 0.5;

  /**
   * Preload a sound with multiple instances for simultaneous playback
   */
  loadSound(name: string, path: string, poolSize: number = 3) {
    const soundPool: HTMLAudioElement[] = [];
    
    for (let i = 0; i < poolSize; i++) {
      const audio = new Audio(path);
      audio.volume = this.volume;
      soundPool.push(audio);
    }
    
    this.sounds.set(name, soundPool);
    this.currentIndex.set(name, 0);
  }

  /**
   * Play a sound with optional pitch variation
   */
  play(name: string, pitchVariation: number = 0) {
    const soundPool = this.sounds.get(name);
    if (!soundPool || soundPool.length === 0) {
      console.warn(`Sound ${name} not loaded`);
      return;
    }

    // Get next available sound instance (round-robin)
    let index = this.currentIndex.get(name) || 0;
    const audio = soundPool[index];
    
    // Update index for next play
    index = (index + 1) % soundPool.length;
    this.currentIndex.set(name, index);

    // Apply pitch variation if specified
    if (pitchVariation > 0) {
      const randomPitch = 1 + (Math.random() * pitchVariation * 2 - pitchVariation);
      audio.playbackRate = randomPitch;
    } else {
      audio.playbackRate = 1;
    }

    // Reset and play
    audio.currentTime = 0;
    audio.play().catch(err => console.warn('Failed to play sound:', err));
  }

  /**
   * Set master volume (0 to 1)
   */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.sounds.forEach(pool => {
      pool.forEach(audio => {
        audio.volume = this.volume;
      });
    });
  }

  /**
   * Stop all sounds
   */
  stopAll() {
    this.sounds.forEach(pool => {
      pool.forEach(audio => {
        audio.pause();
        audio.currentTime = 0;
      });
    });
  }

  /**
   * Clean up all sounds
   */
  dispose() {
    this.stopAll();
    this.sounds.clear();
    this.currentIndex.clear();
  }
}

// Global singleton instance
let globalSoundManager: SoundManager | null = null;

export function getSoundManager(): SoundManager {
  if (!globalSoundManager) {
    globalSoundManager = new SoundManager();
  }
  return globalSoundManager;
}

export function initGameSounds() {
  const sm = getSoundManager();
  
  // Load game sounds
  sm.loadSound('arrow-shoot', '/sounds/game/ArrowShot.mp3', 5);
  
  return sm;
}
