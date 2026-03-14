/*
 * Lobby REST API wrappers.
 *
 * All functions use the shared `apiClient` (Axios instance with JWT refresh
 * interceptor).  Types mirror the backend structs in:
 *   - backend/src/game/lobby.rs   (LobbyInfo, LobbyPlayerInfo)
 *   - backend/src/game/router.rs  (request / response shapes)
 *
 * `LobbySettings` is re-exported from `stream/types.ts` where it is also
 * used by `LobbyServerMessage.SettingsChanged`, avoiding duplication.
 */

import apiClient from './client';
import type { LobbySettings } from '../stream/types';

export type { LobbySettings };

// ─── Response types ───────────────────────────────────────────────────────────

export interface LobbyPlayerInfo {
	user_id: number;
	nickname: string;
	ready: boolean;
}

export interface LobbyInfo {
	/** ULID string, e.g. "01J..." */
	id: string;
	/** User ID of the lobby host. */
	host_id: number;
	settings: LobbySettings;
	player_count: number;
	spectator_count: number;
	players: LobbyPlayerInfo[];
	game_active: boolean;
	/** ISO-8601 UTC datetime string, or null when no countdown is running. */
	countdown_start_at: string | null;
}

// ─── API functions ────────────────────────────────────────────────────────────

/** Create a new lobby and join it as host. Returns the new lobby's ULID. */
export async function createLobby(settings: LobbySettings): Promise<{ id: string }> {
	// Backend uses #[serde(flatten)] so settings fields are top-level in the body.
	const res = await apiClient.post<{ id: string }>('/game/lobby', settings);
	return res.data;
}

/** List all public lobbies. */
export async function listLobbies(): Promise<LobbyInfo[]> {
	const res = await apiClient.get<LobbyInfo[]>('/game/lobby');
	return res.data;
}

/** Get full details of a specific lobby by ULID string. */
export async function getLobby(id: string): Promise<LobbyInfo> {
	const res = await apiClient.get<LobbyInfo>(`/game/lobby/${id}`);
	return res.data;
}

/** Join a lobby as a player. The server opens the lobby uni-stream after this. */
export async function joinLobby(id: string): Promise<void> {
	await apiClient.post(`/game/lobby/${id}/join`);
}

/** Join a lobby as a spectator. */
export async function spectateLobby(id: string): Promise<void> {
	await apiClient.post(`/game/lobby/${id}/spectate`);
}

/** Leave the current lobby (works for both players and spectators). */
export async function leaveLobby(): Promise<void> {
	await apiClient.post('/game/lobby/leave');
}

/** Set ready state for the current player. */
export async function setReadyApi(ready: boolean): Promise<void> {
	await apiClient.post('/game/lobby/ready', { ready });
}

/** Partially update lobby settings (host only, private lobbies only). */
export async function updateLobbySettings(patch: Partial<LobbySettings>): Promise<void> {
	await apiClient.patch('/game/lobby/settings', patch);
}
