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
  const currentMusicIdRef = useRef<string | null>(null);
  const currentAmbientRef = useRef<import('@babylonjs/core/AudioV2').StaticSound | null>(null);
  const currentAmbientIdRef = useRef<string | null>(null);
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
        console.debug('[AudioProvider] engine + sound bank initialised');
        setIsReady(true);
      })
      .catch((err) => console.warn('[AudioProvider] init failed', err));

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
      // Same track already playing → no-op (avoids restart on rerender).
      if (currentMusicIdRef.current === soundId) return;
      // Different track playing → stop it before starting the new one.
      if (currentMusicRef.current) {
        console.debug('[AudioProvider] switching music: %s → %s', currentMusicIdRef.current, soundId);
        (currentMusicRef.current as any).stop?.();
        currentMusicRef.current = null;
        currentMusicIdRef.current = null;
      }
      const sound = bank.getRandomSound(soundId);
      if (!sound) {
        console.warn('[AudioProvider] playMusic: sound not loaded: %s', soundId);
        return;
      }
      const def = bank.getDefinition(soundId);
      if (def) {
        sound.volume = def.volume.min;
      }
      (sound as any).loop = true;
      sound.play();
      currentMusicRef.current = sound;
      currentMusicIdRef.current = soundId;
      console.debug('[AudioProvider] playing music: %s', soundId);
    },

    stopMusic(): void {
      if (!currentMusicRef.current) return;
      (currentMusicRef.current as any).stop?.();
      currentMusicRef.current = null;
      currentMusicIdRef.current = null;
    },

    playAmbient(soundId: string): void {
      const engine = engineRef.current;
      const bank = bankRef.current;
      if (!engine?.isInitialized() || !bank) return;
      if (currentAmbientIdRef.current === soundId) return;
      if (currentAmbientRef.current) {
        (currentAmbientRef.current as any).stop?.();
        currentAmbientRef.current = null;
        currentAmbientIdRef.current = null;
      }
      const sound = bank.getRandomSound(soundId);
      if (!sound) return;
      const def = bank.getDefinition(soundId);
      if (def) {
        sound.volume = def.volume.min;
      }
      (sound as any).loop = true;
      sound.play();
      currentAmbientRef.current = sound;
      currentAmbientIdRef.current = soundId;
    },

    stopAmbient(): void {
      if (!currentAmbientRef.current) return;
      (currentAmbientRef.current as any).stop?.();
      currentAmbientRef.current = null;
      currentAmbientIdRef.current = null;
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
