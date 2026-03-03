import { useEffect, useRef, useState } from 'react';
import type { StaticSound } from '@babylonjs/core/AudioV2';
import { GameAudioEngine } from './AudioEngine';
import { SoundBank } from './SoundBank';

export type BusName = 'sfx' | 'music' | 'ambient' | 'ui';

export interface AudioHandle {
  playSound(soundId: string): void;
  playMusic(soundId: string): void;
  stopMusic(): void;
  setBusVolume(bus: BusName, volume: number): void;
  isReady: boolean;
}

/**
 * React hook for non-game audio (menus, lobby, UI, notifications).
 *
 * Creates its own GameAudioEngine + SoundBank instance.
 * If the game and menus ever need a shared engine, lift into an AudioProvider context
 * — this hook's API will remain unchanged.
 */
export function useAudio(): AudioHandle {
  const engineRef = useRef<GameAudioEngine | null>(null);
  const soundBankRef = useRef<SoundBank | null>(null);
  const currentMusicRef = useRef<StaticSound | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const gameAudio = new GameAudioEngine();
    const soundBank = new SoundBank();
    engineRef.current = gameAudio;
    soundBankRef.current = soundBank;

    gameAudio
      .initialize()
      .then(async () => {
        await soundBank.loadAll(gameAudio);
        setIsReady(true);
      })
      .catch((err) => {
        console.warn('useAudio: initialization failed', err);
      });

    return () => {
      gameAudio.dispose();
      engineRef.current = null;
      soundBankRef.current = null;
      currentMusicRef.current = null;
    };
  }, []);

  return {
    isReady,

    playSound(soundId: string): void {
      const engine = engineRef.current;
      const bank = soundBankRef.current;
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
      const bank = soundBankRef.current;
      if (!engine?.isInitialized() || !bank) return;

      // Stop current music before switching
      if (currentMusicRef.current) {
        (currentMusicRef.current as any).stop?.();
        currentMusicRef.current = null;
      }

      const sound = bank.getRandomSound(soundId);
      if (!sound) return;

      (sound as any).loop = true;
      sound.play();
      currentMusicRef.current = sound;
    },

    stopMusic(): void {
      if (!currentMusicRef.current) return;
      (currentMusicRef.current as any).stop?.();
      currentMusicRef.current = null;
    },

    setBusVolume(bus: BusName, volume: number): void {
      const engine = engineRef.current;
      if (!engine?.isInitialized()) return;
      const audioBus = engine.getBus(bus);
      if (audioBus) {
        (audioBus as any).volume = volume;
      }
    },
  };
}
