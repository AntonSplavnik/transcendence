/**
 * Internal API for resolving user IDs ↔ nicknames.
 *
 * Hides the transport layer (REST today, potentially a WebTransport stream
 * or client-side cache in the future) behind a stable async interface.
 *
 * ## Fallback Behaviour
 *
 * `getNickname()` never throws — on any error it returns `'#<userId>'`
 * (e.g. `'#57'`).  `getUserId()` recognises this fallback format and
 * extracts the numeric ID without a network call.
 *
 * ## Backend Endpoints
 *
 * - `POST /api/users/nickname`     — lightweight batch ID → nickname
 *   (backed by the server-side nickname cache)
 * - `POST /api/users/by-nickname`  — batch nickname → PublicUser
 */

import apiClient from './client';

/** Sentinel prefix for fallback nicknames derived from user IDs. */
const ID_PREFIX = '#';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolve a single user ID to a display nickname.
 *
 * Returns `'#<userId>'` on any error (network, 404, deleted user, etc.)
 * so callers never need to handle failures — the UI always has something
 * to render.
 */
export async function getNickname(userId: number): Promise<string> {
	try {
		const res = await apiClient.post<{ id: number; nickname: string }[]>(
			'users/nickname',
			[userId],
		);
		const entry = res.data.find((u) => u.id === userId);
		return entry?.nickname ?? `${ID_PREFIX}${userId}`;
	} catch {
		return `${ID_PREFIX}${userId}`;
	}
}

/**
 * Resolve a nickname to a user ID.
 *
 * Handles the fallback format `'#<id>'` (e.g. `'#57'`) by extracting the
 * numeric ID directly, without a network call.
 *
 * @throws If the nickname is not found or the request fails.
 */
export async function getUserId(nickname: string): Promise<number> {
	// Handle fallback nicks like '#57'
	if (nickname.startsWith(ID_PREFIX)) {
		const num = Number(nickname.slice(ID_PREFIX.length));
		if (Number.isInteger(num) && num > 0) return num;
	}

	const res = await apiClient.post<{ id: number; nickname: string }[]>(
		'users/by-nickname',
		[nickname],
	);
	const entry = res.data[0];
	if (!entry) throw new Error(`User not found: ${nickname}`);
	return entry.id;
}

/**
 * Batch-resolve multiple user IDs to nicknames.
 *
 * Returns a `Map<userId, nickname>`.  IDs that could not be resolved
 * (network error, deleted user, etc.) are mapped to the fallback format
 * `'#<id>'`.
 *
 * Uses the lightweight `POST /api/users/nickname` endpoint which is
 * backed by the server-side nickname cache.
 */
export async function getNicknames(
	userIds: number[],
): Promise<Map<number, string>> {
	const result = new Map<number, string>();
	if (userIds.length === 0) return result;

	try {
		const res = await apiClient.post<{ id: number; nickname: string }[]>(
			'users/nickname',
			userIds,
		);
		for (const { id, nickname } of res.data) {
			result.set(id, nickname);
		}
	} catch {
		// Fallback for all IDs below
	}

	// Fill in fallbacks for any IDs not returned
	for (const id of userIds) {
		if (!result.has(id)) {
			result.set(id, `${ID_PREFIX}${id}`);
		}
	}

	return result;
}
