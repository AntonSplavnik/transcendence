import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { GameAudioEngine } from './AudioEngine';
import { SoundBank } from './SoundBank';
import type { AudioHandle } from './useAudio';

const AudioCtx = createContext<AudioHandle | null>(null);

/**
 * Singleton audio provider for UI/menu sounds.
 * Mount once at the app root — the engine survives navigation.
 */
export function AudioProvider({ children }: { children: React.ReactNode }) {
  const engineRef = useRef<GameAudioEngine | null>(null);
  const bankRef = useRef<SoundBank | null>(null);
  const currentMusicRef = useRef<import('@babylonjs/core/AudioV2').StaticSound | null>(null);
  const currentAmbientRef = useRef<import('@babylonjs/core/AudioV2').StaticSound | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const engine = new GameAudioEngine();
    const bank = new SoundBank();
    engineRef.current = engine;
    bankRef.current = bank;

    engine
      .initialize()
      .then(async () => {
        await bank.loadAll(engine);
        setIsReady(true);
      })
      .catch((err) => console.warn('AudioProvider: init failed', err));

    return () => {
      engine.dispose();
      engineRef.current = null;
      bankRef.current = null;
    };
  }, []);

  const handle: AudioHandle = {
    isReady,

    playSound(soundId: string): void {
      const engine = engineRef.current;
      const bank = bankRef.current;
      if (!engine?.isInitialized() || !bank) return;
      const sound = bank.getRandomSound(soundId);
      if (!sound) return;
      const def = bank.getDefinition(soundId);
      if (def) {
        sound.volume = def.volume.min + Math.random() * (def.volume.max - def.volume.min);
        sound.playbackRate = def.pitch.min + Math.random() * (def.pitch.max - def.pitch.min);
      }
      sound.play();
    },

    playMusic(soundId: string): void {
      const engine = engineRef.current;
      const bank = bankRef.current;
      if (!engine?.isInitialized() || !bank) return;
      // Already playing this track — do nothing
      if (currentMusicRef.current) return;
      const sound = bank.getRandomSound(soundId);
      if (!sound) return;
      const def = bank.getDefinition(soundId);
      if (def) {
        sound.volume = def.volume.min;
      }
      (sound as any).loop = true;
      sound.play();
      currentMusicRef.current = sound;
    },

    stopMusic(): void {
      if (!currentMusicRef.current) return;
      (currentMusicRef.current as any).stop?.();
      currentMusicRef.current = null;
    },

    playAmbient(soundId: string): void {
      const engine = engineRef.current;
      const bank = bankRef.current;
      if (!engine?.isInitialized() || !bank) return;
      if (currentAmbientRef.current) return;
      const sound = bank.getRandomSound(soundId);
      if (!sound) return;
      const def = bank.getDefinition(soundId);
      if (def) {
        sound.volume = def.volume.min;
      }
      (sound as any).loop = true;
      sound.play();
      currentAmbientRef.current = sound;
    },

    stopAmbient(): void {
      if (!currentAmbientRef.current) return;
      (currentAmbientRef.current as any).stop?.();
      currentAmbientRef.current = null;
    },

    setBusVolume(bus, volume): void {
      const engine = engineRef.current;
      if (!engine?.isInitialized()) return;
      const audioBus = engine.getBus(bus);
      if (audioBus) (audioBus as any).volume = volume;
    },
  };

  return <AudioCtx.Provider value={handle}>{children}</AudioCtx.Provider>;
}

export function useUIAudio(): AudioHandle {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error('useUIAudio must be used inside <AudioProvider>');
  return ctx;
}
