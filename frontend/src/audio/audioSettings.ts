/**
 * Persistent user audio settings (music/UI volumes + global mute).
 *
 * Stored in localStorage under `transcendence.audio_settings`.
 * Volumes are stored as normalized floats in [0, 1].
 */

export interface AudioSettings {
	musicVolume: number;
	uiVolume: number;
	/** In-game music slider driving the `music_ingame` bus. */
	inGameMusicVolume: number;
	/** In-game SFX slider driving the `sfx` and `ambient` buses. */
	inGameSfxVolume: number;
	muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
	musicVolume: 0.5,
	uiVolume: 0.7,
	inGameMusicVolume: 1.0,
	inGameSfxVolume: 1.0,
	muted: false,
};

const STORAGE_KEY = 'transcendence.audio_settings';

function clamp01(n: number): number {
	if (Number.isNaN(n)) return 0;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

export function loadAudioSettings(): AudioSettings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
		const parsed = JSON.parse(raw) as Partial<AudioSettings> & { inGameVolume?: number };
		const legacyInGameVolume =
			typeof parsed.inGameVolume === 'number' ? clamp01(parsed.inGameVolume) : null;
		return {
			musicVolume:
				typeof parsed.musicVolume === 'number'
					? clamp01(parsed.musicVolume)
					: DEFAULT_AUDIO_SETTINGS.musicVolume,
			uiVolume:
				typeof parsed.uiVolume === 'number'
					? clamp01(parsed.uiVolume)
					: DEFAULT_AUDIO_SETTINGS.uiVolume,
			inGameMusicVolume:
				typeof parsed.inGameMusicVolume === 'number'
					? clamp01(parsed.inGameMusicVolume)
					: (legacyInGameVolume ?? DEFAULT_AUDIO_SETTINGS.inGameMusicVolume),
			inGameSfxVolume:
				typeof parsed.inGameSfxVolume === 'number'
					? clamp01(parsed.inGameSfxVolume)
					: (legacyInGameVolume ?? DEFAULT_AUDIO_SETTINGS.inGameSfxVolume),
			muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_AUDIO_SETTINGS.muted,
		};
	} catch {
		return { ...DEFAULT_AUDIO_SETTINGS };
	}
}

export function saveAudioSettings(settings: AudioSettings): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Storage unavailable (private mode, quota) — silently ignore; settings stay in memory only.
	}
}
