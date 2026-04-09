import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { GameAudioEngine } from './AudioEngine';
import { SoundBank } from './SoundBank';
import { loadAudioSettings } from './audioSettings';
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
				// Restore persisted user preferences before first playback.
				const settings = loadAudioSettings();
				const musicBus = engine.getBus('music');
				const uiBus = engine.getBus('ui');
				const sfxBus = engine.getBus('sfx');
				const ambientBus = engine.getBus('ambient');
				if (musicBus) musicBus.volume = settings.musicVolume;
				if (uiBus) uiBus.volume = settings.uiVolume;
				if (sfxBus) sfxBus.volume = settings.inGameVolume;
				if (ambientBus) ambientBus.volume = settings.inGameVolume;
				engine.setMasterVolume(settings.muted ? 0 : 1);
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

	// Global UI click sound — fires once per user click on any interactive element.
	// Listener is attached on the document in capture phase so it still fires when
	// a child handler calls stopPropagation().
	useEffect(() => {
		if (!isReady) return;
		const handler = (e: MouseEvent) => {
			if (e.button !== 0) return; // primary button / touch only
			const target = e.target as HTMLElement | null;
			if (!target) return;
			const interactive = target.closest('button, a, [role="button"]');
			if (!interactive) return;
			if (interactive instanceof HTMLButtonElement && interactive.disabled) return;
			if (interactive.getAttribute('aria-disabled') === 'true') return;

			// Inline dispatch — refs are stable across renders, no closure staleness.
			const engine = engineRef.current;
			const bank = bankRef.current;
			if (!engine?.isInitialized() || !bank) return;
			const sound = bank.getRandomSound('ui_click');
			if (!sound) return;
			const def = bank.getDefinition('ui_click');
			if (def) {
				sound.volume = def.volume.min + Math.random() * (def.volume.max - def.volume.min);
				sound.playbackRate =
					def.pitch.min + Math.random() * (def.pitch.max - def.pitch.min);
			}
			sound.play();
		};
		document.addEventListener('click', handler, true);
		return () => document.removeEventListener('click', handler, true);
	}, [isReady]);

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
				sound.playbackRate =
					def.pitch.min + Math.random() * (def.pitch.max - def.pitch.min);
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
				console.debug(
					'[AudioProvider] switching music: %s → %s',
					currentMusicIdRef.current,
					soundId,
				);
				currentMusicRef.current.stop();
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
			sound.loop = true;
			sound.play();
			currentMusicRef.current = sound;
			currentMusicIdRef.current = soundId;
			console.debug('[AudioProvider] playing music: %s', soundId);
		},

		stopMusic(): void {
			if (!currentMusicRef.current) return;
			currentMusicRef.current.stop();
			currentMusicRef.current = null;
			currentMusicIdRef.current = null;
		},

		playAmbient(soundId: string): void {
			const engine = engineRef.current;
			const bank = bankRef.current;
			if (!engine?.isInitialized() || !bank) return;
			if (currentAmbientIdRef.current === soundId) return;
			if (currentAmbientRef.current) {
				currentAmbientRef.current.stop();
				currentAmbientRef.current = null;
				currentAmbientIdRef.current = null;
			}
			const sound = bank.getRandomSound(soundId);
			if (!sound) return;
			const def = bank.getDefinition(soundId);
			if (def) {
				sound.volume = def.volume.min;
			}
			sound.loop = true;
			sound.play();
			currentAmbientRef.current = sound;
			currentAmbientIdRef.current = soundId;
		},

		stopAmbient(): void {
			if (!currentAmbientRef.current) return;
			currentAmbientRef.current.stop();
			currentAmbientRef.current = null;
			currentAmbientIdRef.current = null;
		},

		setBusVolume(bus, volume): void {
			const engine = engineRef.current;
			if (!engine?.isInitialized()) return;
			const audioBus = engine.getBus(bus);
			if (audioBus) audioBus.volume = volume;
		},

		setMuted(muted: boolean): void {
			const engine = engineRef.current;
			if (!engine?.isInitialized()) return;
			engine.setMasterVolume(muted ? 0 : 1);
		},
	};

	return <AudioCtx.Provider value={handle}>{children}</AudioCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUIAudio(): AudioHandle {
	const ctx = useContext(AudioCtx);
	if (!ctx) throw new Error('useUIAudio must be used inside <AudioProvider>');
	return ctx;
}
