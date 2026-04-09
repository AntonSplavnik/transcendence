import { describe, it, expect, beforeEach } from 'vitest';
import {
	loadAudioSettings,
	saveAudioSettings,
	DEFAULT_AUDIO_SETTINGS,
} from '../../../src/audio/audioSettings';

const STORAGE_KEY = 'transcendence.audio_settings';

describe('audioSettings', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	describe('loadAudioSettings', () => {
		it('returns defaults when storage is empty', () => {
			expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
		});

		it('returns a fresh copy (not the defaults reference)', () => {
			const a = loadAudioSettings();
			const b = loadAudioSettings();
			expect(a).not.toBe(b);
			expect(a).not.toBe(DEFAULT_AUDIO_SETTINGS);
		});

		it('loads previously saved settings', () => {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ musicVolume: 0.25, uiVolume: 0.9, muted: true }),
			);
			expect(loadAudioSettings()).toEqual({
				musicVolume: 0.25,
				uiVolume: 0.9,
				muted: true,
			});
		});

		it('clamps musicVolume above 1 down to 1', () => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ musicVolume: 5 }));
			expect(loadAudioSettings().musicVolume).toBe(1);
		});

		it('clamps musicVolume below 0 up to 0', () => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ musicVolume: -2 }));
			expect(loadAudioSettings().musicVolume).toBe(0);
		});

		it('clamps uiVolume to [0, 1]', () => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiVolume: 1.5 }));
			expect(loadAudioSettings().uiVolume).toBe(1);

			localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiVolume: -0.5 }));
			expect(loadAudioSettings().uiVolume).toBe(0);
		});

		it('falls back to default for non-number volume fields', () => {
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ musicVolume: 'loud', uiVolume: null }),
			);
			const s = loadAudioSettings();
			expect(s.musicVolume).toBe(DEFAULT_AUDIO_SETTINGS.musicVolume);
			expect(s.uiVolume).toBe(DEFAULT_AUDIO_SETTINGS.uiVolume);
		});

		it('falls back to default muted for non-boolean muted field', () => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: 'yes' }));
			expect(loadAudioSettings().muted).toBe(DEFAULT_AUDIO_SETTINGS.muted);
		});

		it('merges partial settings with defaults', () => {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: true }));
			expect(loadAudioSettings()).toEqual({
				musicVolume: DEFAULT_AUDIO_SETTINGS.musicVolume,
				uiVolume: DEFAULT_AUDIO_SETTINGS.uiVolume,
				muted: true,
			});
		});

		it('returns defaults when stored JSON is corrupted', () => {
			localStorage.setItem(STORAGE_KEY, '{not json');
			expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
		});

		it('returns defaults when localStorage throws', () => {
			const original = Storage.prototype.getItem;
			Storage.prototype.getItem = () => {
				throw new Error('quota');
			};
			try {
				expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
			} finally {
				Storage.prototype.getItem = original;
			}
		});
	});

	describe('saveAudioSettings', () => {
		it('persists settings as JSON under the expected key', () => {
			saveAudioSettings({ musicVolume: 0.1, uiVolume: 0.2, muted: false });
			const raw = localStorage.getItem(STORAGE_KEY);
			expect(raw).not.toBeNull();
			expect(JSON.parse(raw!)).toEqual({
				musicVolume: 0.1,
				uiVolume: 0.2,
				muted: false,
			});
		});

		it('is readable back by loadAudioSettings (round-trip)', () => {
			const input = { musicVolume: 0.42, uiVolume: 0.77, muted: true };
			saveAudioSettings(input);
			expect(loadAudioSettings()).toEqual(input);
		});

		it('silently swallows storage errors', () => {
			const original = Storage.prototype.setItem;
			Storage.prototype.setItem = () => {
				throw new Error('quota');
			};
			try {
				expect(() =>
					saveAudioSettings({ musicVolume: 0.5, uiVolume: 0.5, muted: false }),
				).not.toThrow();
			} finally {
				Storage.prototype.setItem = original;
			}
		});
	});
});
