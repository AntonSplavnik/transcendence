/*
 * Chat preferences — localStorage persistence.
 *
 * Preferences are stored per user so switching accounts on the same
 * browser does not bleed settings across users.
 *
 * All reads are wrapped in try/catch so corrupted or tampered data
 * always falls back to safe defaults rather than crashing.
 */

import type { ChatPreferences } from './types';

const DEFAULT_PREFERENCES: ChatPreferences = {
	globalEnabled: true,
	visible: true,
	blockedUsers: [],
};

function storageKey(userId: number): string {
	return `chat.preferences.${userId}`;
}

/**
 * Load preferences for a user from localStorage.
 * Falls back to defaults on any parse error or missing data.
 */
export function loadPreferences(userId: number): ChatPreferences {
	try {
		const raw = localStorage.getItem(storageKey(userId));
		if (!raw) return { ...DEFAULT_PREFERENCES };
		const parsed = JSON.parse(raw) as Partial<ChatPreferences>;
		return {
			globalEnabled: parsed.globalEnabled ?? DEFAULT_PREFERENCES.globalEnabled,
			visible: parsed.visible ?? DEFAULT_PREFERENCES.visible,
			blockedUsers: Array.isArray(parsed.blockedUsers)
				? (parsed.blockedUsers as number[]).filter((v) => typeof v === 'number')
				: [],
		};
	} catch {
		return { ...DEFAULT_PREFERENCES };
	}
}

/**
 * Persist preferences for a user to localStorage.
 * Silently ignores quota errors.
 */
export function savePreferences(userId: number, prefs: ChatPreferences): void {
	try {
		localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
	} catch {
		// Silently ignore QuotaExceededError and similar.
	}
}

/** Remove stored preferences for a user (called on logout). */
export function clearPreferences(userId: number): void {
	try {
		localStorage.removeItem(storageKey(userId));
	} catch {
		// Silently ignore.
	}
}
