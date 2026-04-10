import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Node } from '@babylonjs/core/node';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { StaticSound } from '@babylonjs/core/AudioV2';
import { GameAudioEngine } from './AudioEngine';
import type { BusName } from './AudioEngine';
import { SoundBank } from './SoundBank';
import { loadAudioSettings } from './audioSettings';

export type { BusName };

/** UI-facing audio API: menu music, UI clicks, notifications, settings modal. */
export interface AudioHandle {
	isReady: boolean;
	playSound(soundId: string): void;
	playMusic(soundId: string): void;
	stopMusic(): void;
	playAmbient(soundId: string): void;
	stopAmbient(): void;
	setBusVolume(bus: BusName, volume: number): void;
	setMuted(muted: boolean): void;
}

/**
 * Game-facing audio API: exposes the shared engine + sound bank so gameplay
 * code can play SFX via AudioEventSystem, and provides scene-scoped
 * music/ambient helpers with the same lifecycle semantics as the UI side.
 *
 * Listener detachment is intentionally not part of the API: Babylon's listener
 * is a singleton on the engine, and the next game mount simply re-attaches it
 * to the new camera. Between games the listener harmlessly references the
 * previous camera node until it is overwritten.
 */
export interface GameAudioHandle {
	isReady: boolean;
	engine: GameAudioEngine | null;
	soundBank: SoundBank | null;
	attachListener(camera: Node): void;
	playSceneAmbient(soundId: string): void;
	stopSceneAmbient(): void;
	playSceneMusic(soundId: string): void;
	stopSceneMusic(): void;
	/** Start a shuffled playlist of in-game music tracks. */
	playMusicPlaylist(): void;
	/** Stop the shuffled playlist. */
	stopMusicPlaylist(): void;
}

interface AudioContextValue extends AudioHandle, GameAudioHandle {}

const AudioCtx = createContext<AudioContextValue | null>(null);

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
	// Mirror of the refs as reactive state — consumers like `useGameAudio` need
	// the actual engine/bank instances, and reading refs during render is unsafe.
	const [engine, setEngine] = useState<GameAudioEngine | null>(null);
	const [bank, setBank] = useState<SoundBank | null>(null);

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
				setEngine(engine);
				setBank(bank);
				setIsReady(true);
			})
			.catch((err) => console.warn('[AudioProvider] init failed', err));

		return () => {
			bank.dispose();
			engine.dispose();
			engineRef.current = null;
			bankRef.current = null;
			setEngine(null);
			setBank(null);
			setIsReady(false);
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

			const engine = engineRef.current;
			const bank = bankRef.current;
			if (!engine?.isInitialized() || !bank) return;
			bank.playRandomised('ui_click');
		};
		document.addEventListener('click', handler, true);
		return () => document.removeEventListener('click', handler, true);
	}, [isReady]);

	const playAmbientImpl = (soundId: string): void => {
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
		if (def) sound.volume = def.volume.min;
		sound.loop = true;
		sound.play();
		currentAmbientRef.current = sound;
		currentAmbientIdRef.current = soundId;
	};

	const stopAmbientImpl = (): void => {
		if (!currentAmbientRef.current) return;
		currentAmbientRef.current.stop();
		currentAmbientRef.current = null;
		currentAmbientIdRef.current = null;
	};

	const playMusicImpl = (soundId: string): void => {
		const engine = engineRef.current;
		const bank = bankRef.current;
		if (!engine?.isInitialized() || !bank) return;
		if (currentMusicIdRef.current === soundId) return;
		if (currentMusicRef.current) {
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
		if (def) sound.volume = def.volume.min;
		sound.loop = true;
		sound.play();
		currentMusicRef.current = sound;
		currentMusicIdRef.current = soundId;
	};

	const stopMusicImpl = (): void => {
		if (!currentMusicRef.current) return;
		currentMusicRef.current.stop();
		currentMusicRef.current = null;
		currentMusicIdRef.current = null;
	};

	// ─── Shuffle playlist for in-game music ─────────────────────────────────
	const playlistActiveRef = useRef(false);
	const playlistObserverRef = useRef<Observer<StaticSound> | null>(null);

	const playNextPlaylistTrack = (): void => {
		const engine = engineRef.current;
		const bank = bankRef.current;
		if (!engine?.isInitialized() || !bank || !playlistActiveRef.current) return;

		// Clean up previous observer
		if (playlistObserverRef.current && currentMusicRef.current) {
			currentMusicRef.current.onEndedObservable.remove(playlistObserverRef.current);
			playlistObserverRef.current = null;
		}

		// Stop current track
		if (currentMusicRef.current) {
			currentMusicRef.current.stop();
			currentMusicRef.current = null;
		}

		const sound = bank.getRandomSound('music_ingame');
		if (!sound) return;

		const def = bank.getDefinition('music_ingame');
		if (def) sound.volume = def.volume.min;
		sound.loop = false;
		sound.play();
		currentMusicRef.current = sound;
		currentMusicIdRef.current = 'music_ingame';

		// When track ends, play another random variation
		playlistObserverRef.current = sound.onEndedObservable.addOnce(() => {
			playNextPlaylistTrack();
		});
	};

	const playMusicPlaylistImpl = (): void => {
		playlistActiveRef.current = true;
		playNextPlaylistTrack();
	};

	const stopMusicPlaylistImpl = (): void => {
		playlistActiveRef.current = false;
		if (playlistObserverRef.current && currentMusicRef.current) {
			currentMusicRef.current.onEndedObservable.remove(playlistObserverRef.current);
			playlistObserverRef.current = null;
		}
		stopMusicImpl();
	};

	const handle: AudioContextValue = useMemo(() => ({
		isReady,
		engine,
		soundBank: bank,

		attachListener(node: Node): void {
			engineRef.current?.attachListener(node);
		},

		playSceneAmbient: playAmbientImpl,
		stopSceneAmbient: stopAmbientImpl,
		playSceneMusic: playMusicImpl,
		stopSceneMusic: stopMusicImpl,
		playMusicPlaylist: playMusicPlaylistImpl,
		stopMusicPlaylist: stopMusicPlaylistImpl,

		playSound(soundId: string): void {
			const engine = engineRef.current;
			const bank = bankRef.current;
			if (!engine?.isInitialized() || !bank) return;
			bank.playRandomised(soundId);
		},

		playMusic: playMusicImpl,
		stopMusic: stopMusicImpl,
		playAmbient: playAmbientImpl,
		stopAmbient: stopAmbientImpl,

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
	}), [isReady, engine, bank]);

	return <AudioCtx.Provider value={handle}>{children}</AudioCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUIAudio(): AudioHandle {
	const ctx = useContext(AudioCtx);
	if (!ctx) throw new Error('useUIAudio must be used inside <AudioProvider>');
	return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useGameAudio(): GameAudioHandle {
	const ctx = useContext(AudioCtx);
	if (!ctx) throw new Error('useGameAudio must be used inside <AudioProvider>');
	return ctx;
}
