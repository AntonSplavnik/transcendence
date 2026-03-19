import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadPreferences, savePreferences, clearPreferences } from '../../../src/chat/storage';

describe('chat storage', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	// ── loadPreferences ──────────────────────────────────────────────────

	describe('loadPreferences', () => {
		it('returns defaults when nothing is stored', () => {
			const prefs = loadPreferences(1);
			expect(prefs).toEqual({
				globalEnabled: true,
				visible: true,
				blockedUsers: [],
			});
		});

		it('loads valid stored preferences', () => {
			localStorage.setItem(
				'chat.preferences.42',
				JSON.stringify({ globalEnabled: false, visible: false, blockedUsers: [10, 20] }),
			);
			const prefs = loadPreferences(42);
			expect(prefs.globalEnabled).toBe(false);
			expect(prefs.visible).toBe(false);
			expect(prefs.blockedUsers).toEqual([10, 20]);
		});

		it('fills missing fields with defaults', () => {
			localStorage.setItem('chat.preferences.1', JSON.stringify({ globalEnabled: false }));
			const prefs = loadPreferences(1);
			expect(prefs.globalEnabled).toBe(false);
			expect(prefs.visible).toBe(true); // default
			expect(prefs.blockedUsers).toEqual([]); // default
		});

		it('returns defaults on corrupted JSON', () => {
			localStorage.setItem('chat.preferences.1', 'not-json{{{');
			const prefs = loadPreferences(1);
			expect(prefs).toEqual({
				globalEnabled: true,
				visible: true,
				blockedUsers: [],
			});
		});

		it('filters non-number entries from blockedUsers', () => {
			localStorage.setItem(
				'chat.preferences.1',
				JSON.stringify({ blockedUsers: [1, 'bad', null, 3, true] }),
			);
			const prefs = loadPreferences(1);
			expect(prefs.blockedUsers).toEqual([1, 3]);
		});

		it('defaults blockedUsers when it is not an array', () => {
			localStorage.setItem(
				'chat.preferences.1',
				JSON.stringify({ blockedUsers: 'not-array' }),
			);
			const prefs = loadPreferences(1);
			expect(prefs.blockedUsers).toEqual([]);
		});

		it('isolates preferences per user ID', () => {
			savePreferences(1, { globalEnabled: false, visible: true, blockedUsers: [] });
			savePreferences(2, { globalEnabled: true, visible: false, blockedUsers: [99] });

			expect(loadPreferences(1).globalEnabled).toBe(false);
			expect(loadPreferences(2).visible).toBe(false);
			expect(loadPreferences(2).blockedUsers).toEqual([99]);
		});
	});

	// ── savePreferences ──────────────────────────────────────────────────

	describe('savePreferences', () => {
		it('persists preferences to localStorage', () => {
			const prefs = { globalEnabled: false, visible: true, blockedUsers: [5] };
			savePreferences(7, prefs);
			const stored = JSON.parse(localStorage.getItem('chat.preferences.7')!);
			expect(stored).toEqual(prefs);
		});

		it('silently ignores quota errors', () => {
			const original = Storage.prototype.setItem;
			Storage.prototype.setItem = vi.fn(() => {
				throw new DOMException('QuotaExceededError');
			});

			// Should not throw
			expect(() =>
				savePreferences(1, { globalEnabled: true, visible: true, blockedUsers: [] }),
			).not.toThrow();

			Storage.prototype.setItem = original;
		});
	});

	// ── clearPreferences ─────────────────────────────────────────────────

	describe('clearPreferences', () => {
		it('removes stored preferences for a user', () => {
			savePreferences(1, { globalEnabled: false, visible: true, blockedUsers: [] });
			expect(localStorage.getItem('chat.preferences.1')).not.toBeNull();

			clearPreferences(1);
			expect(localStorage.getItem('chat.preferences.1')).toBeNull();
		});

		it('does not affect other users', () => {
			savePreferences(1, { globalEnabled: false, visible: true, blockedUsers: [] });
			savePreferences(2, { globalEnabled: true, visible: false, blockedUsers: [] });

			clearPreferences(1);
			expect(localStorage.getItem('chat.preferences.1')).toBeNull();
			expect(localStorage.getItem('chat.preferences.2')).not.toBeNull();
		});
	});
});
