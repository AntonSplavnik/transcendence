/*
 * Lobby REST API wrappers.
 *
 * All functions use the shared `apiClient` (Axios instance with JWT refresh
 * interceptor).  Types mirror the backend structs in:
 *   - backend/src/game/lobby.rs   (LobbyInfo, LobbyPlayerInfo, LobbySettings)
 *   - backend/src/game/router.rs  (request / response shapes)
 *
 * `LobbySettings`, `LobbyPlayerInfo`, and `LobbyInfo` live in `stream/types.ts`
 * because `LobbyServerMessage.LobbySnapshot` also carries `LobbyInfo`, and we
 * must avoid a circular import between this file and the stream layer.
 */

import type { LobbyInfo, LobbySettings } from '../stream/types';
import apiClient from './client';

export type { LobbyPlayerInfo } from '../stream/types';
export type { LobbyInfo, LobbySettings };

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

/** Leave the specified lobby (works for both players and spectators). */
export async function leaveLobby(id: string): Promise<void> {
	await apiClient.post(`/game/lobby/${id}/leave`);
}

/** Set ready state for the current player in the specified lobby. */
export async function setReadyApi(id: string, ready: boolean): Promise<void> {
	await apiClient.post(`/game/lobby/${id}/ready`, { ready });
}

/** Partially update lobby settings (host only, private lobbies only). */
export async function updateLobbySettings(
	id: string,
	patch: Partial<LobbySettings>,
): Promise<void> {
	await apiClient.patch(`/game/lobby/${id}/settings`, patch);
}
