/*
 * LobbyContext — single source of truth for lobby state, driven exclusively
 * by the Lobby uni-stream.
 *
 * State transitions
 * ─────────────────
 * idle   → active  :  LobbySnapshot received on stream → dispatch OPEN
 * active → idle    :  stream closes / LobbyClosed message / leave()
 *
 * Navigation
 * ──────────
 * idle → active    :  effect watching lobbyState.status → navigate('/lobby')
 * LobbyClosed msg  :  dispatch CLOSE + navigate('/home') immediately
 * leave()          :  dispatch CLOSE + navigate('/home') + bump streamCounter
 * unexpected close :  dispatch CLOSE + navigate('/home')
 *
 * Snapshot delivery
 * ────────────────────────────────────────────────
 * The server sends a targeted `LobbySnapshot` message as the first frame on
 * every newly opened lobby stream (after join/spectate/create).  The client
 * waits for this message before initialising state.  Any delta messages that
 * arrive before the snapshot (a small race window during Phase 2 of the
 * server-side join flow) are buffered and replayed in order after OPEN.
 *
 * Stale-close guard
 * ─────────────────
 * `streamCounterRef` is incremented each time a new stream opens.  Each
 * factory instance captures its own counter value (`myStreamId`).  onClose
 * and leave() both check/bump this counter to prevent a stale close (or a
 * voluntary leave's deferred close) from clobbering a newer lobby's state or
 * triggering a duplicate navigation.
 *
 * Must be nested inside StreamProvider.
 */

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { leaveLobby, setCharacterApi, setReadyApi, updateLobbySettings } from '../api/lobby';
import type {
	LobbyInfo,
	LobbyServerMessage,
	LobbySettings,
	UniHandlerFactory,
} from '../stream/types';
import { parseLobbyMessage } from '../stream/types';
import { useStream } from './StreamContext';

export type { LobbySettings };

// ─── State machine ────────────────────────────────────────────────────────────

export type LobbyState =
	| { status: 'idle' }
	| {
			status: 'active';
			lobbyId: string;
			hostId: number;
			settings: LobbySettings;
			/** Keyed by user_id */
			players: ReadonlyMap<number, { nickname: string; ready: boolean }>;
			/** Keyed by user_id */
			spectators: ReadonlySet<number>;
			/** Present when a countdown is running. */
			countdown: { startAt: Date } | null;
			/** True while the game is running (between GameStarting and GameEnded). */
			gameActive: boolean;
	  };

// ─── Reducer ─────────────────────────────────────────────────────────────────

type LobbyAction =
	| { type: 'OPEN'; info: LobbyInfo }
	| { type: 'CLOSE' }
	| { type: 'MESSAGE'; msg: LobbyServerMessage };

function lobbyReducer(state: LobbyState, action: LobbyAction): LobbyState {
	switch (action.type) {
		case 'OPEN': {
			const { info } = action;
			const players = new Map<number, { nickname: string; ready: boolean }>(
				info.players.map((p) => [p.user_id, { nickname: p.nickname, ready: p.ready }]),
			);
			const countdown = info.countdown_start_at
				? { startAt: new Date(info.countdown_start_at) }
				: null;
			return {
				status: 'active',
				lobbyId: info.id,
				hostId: info.host_id,
				settings: info.settings,
				players,
				spectators: new Set(),
				countdown,
				gameActive: info.game_active,
			};
		}

		case 'CLOSE':
			return { status: 'idle' };

		case 'MESSAGE': {
			if (state.status !== 'active') return state;
			const { msg } = action;

			if (msg === 'CountdownCancelled') {
				return { ...state, countdown: null };
			}
			if (msg === 'GameStarting') {
				return { ...state, gameActive: true };
			}
			if (msg === 'GameEnded') {
				const players = new Map(
					[...state.players.entries()].map(([id, p]) => [id, { ...p, ready: false }]),
				);
				return { ...state, gameActive: false, countdown: null, players };
			}
			if ('LobbySnapshot' in msg) {
				// A snapshot arriving after initialization is a no-op in the reducer
				// (the stream handler re-dispatches OPEN when it sees this).
				return state;
			}
			if ('PlayerJoined' in msg) {
				const { user_id, nickname } = msg.PlayerJoined;
				const players = new Map(state.players);
				players.set(user_id, { nickname, ready: false });
				return { ...state, players };
			}
			if ('PlayerLeft' in msg) {
				const players = new Map(state.players);
				players.delete(msg.PlayerLeft.user_id);
				return { ...state, players };
			}
			if ('SpectatorJoined' in msg) {
				const spectators = new Set(state.spectators);
				spectators.add(msg.SpectatorJoined.user_id);
				return { ...state, spectators };
			}
			if ('SpectatorLeft' in msg) {
				const spectators = new Set(state.spectators);
				spectators.delete(msg.SpectatorLeft.user_id);
				return { ...state, spectators };
			}
			if ('ReadyChanged' in msg) {
				const { user_id, ready } = msg.ReadyChanged;
				const existing = state.players.get(user_id);
				if (!existing) return state;
				const players = new Map(state.players);
				players.set(user_id, { ...existing, ready });
				return { ...state, players };
			}
			if ('CountdownUpdate' in msg) {
				const startAt = new Date(msg.CountdownUpdate.start_timestamp);
				return { ...state, countdown: { startAt } };
			}
			if ('SettingsChanged' in msg) {
				return { ...state, settings: msg.SettingsChanged };
			}
			if ('LobbyClosed' in msg) {
				// Handled in onMessage before dispatch; fall through gracefully.
				return { status: 'idle' };
			}
			return state;
		}

		default:
			return state;
	}
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface LobbyContextType {
	lobbyState: LobbyState;
	/** Toggle the local player's ready state. */
	setReady(ready: boolean): Promise<void>;
	/** Set character class for the current player. */
	setCharacter(characterClass: string): Promise<void>;
	/** Partially update lobby settings (host only, private lobbies only). */
	updateSettings(patch: Partial<LobbySettings>): Promise<void>;
	/**
	 * Leave the current lobby.
	 *
	 * Optimistically dispatches CLOSE and navigates to /home immediately, then
	 * fires the API call in the background.  Does not wait for the stream to
	 * close — the backend's stream-cleanup task reconciles server state.
	 */
	leave(): Promise<void>;
}

const LobbyContext = createContext<LobbyContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function LobbyProvider({ children }: { children: ReactNode }) {
	const { connectionManager } = useStream();
	const navigate = useNavigate();

	const [lobbyState, dispatch] = useReducer(lobbyReducer, { status: 'idle' });

	// Stable refs to avoid stale closures inside stream handlers.
	const navigateRef = useRef(navigate);
	useEffect(() => {
		navigateRef.current = navigate;
	}, [navigate]);

	const lobbyStateRef = useRef<LobbyState>(lobbyState);
	useEffect(() => {
		lobbyStateRef.current = lobbyState;
	}, [lobbyState]);

	// Monotonically incremented counter used as a stream identity token.
	//
	// Serves two purposes:
	//  1. Guards stale onClose events from clobbering a newer lobby's state.
	//  2. Prevents double navigation when leave() or LobbyClosed already handled it.
	//
	// Bumped in three places:
	//  - factory invocation (new stream opened)
	//  - leave() (voluntary leave — invalidates the pending onClose)
	//  - LobbyClosed message handler (server close — invalidates the pending onClose)
	const streamCounterRef = useRef(0);

	// ─── Navigation: idle → active ────────────────────────────────────
	// The ONLY place navigation to /lobby happens.  Driven by state change.
	const prevStatusRef = useRef<'idle' | 'active'>(lobbyState.status);
	useEffect(() => {
		const prev = prevStatusRef.current;
		prevStatusRef.current = lobbyState.status;
		if (prev === 'idle' && lobbyState.status === 'active') {
			console.debug('[Lobby] state idle→active, navigating to /lobby');
			navigateRef.current('/lobby');
		}
	}, [lobbyState.status]);

	// ─── Stream handler factory ───────────────────────────────────────
	useEffect(() => {
		const factory: UniHandlerFactory<unknown> = (data) => {
			const lobbyId = String(data);
			// Capture this stream's identity at creation time.
			const myStreamId = ++streamCounterRef.current;

			console.debug('[Lobby:%s] factory invoked (streamId=%d)', lobbyId, myStreamId);

			// Pre-snapshot message buffer: holds delta events that arrive before
			// the server sends LobbySnapshot (a small race window in Phase 2).
			let initialized = false;
			const pendingMessages: unknown[] = [];

			const processMessage = (rawMsg: unknown) => {
				let msg: LobbyServerMessage;
				try {
					msg = parseLobbyMessage(rawMsg);
				} catch (err) {
					console.warn(
						'[Lobby:%s] unrecognised message, discarding:',
						lobbyId,
						rawMsg,
						err,
					);
					return;
				}

				const key = typeof msg === 'string' ? msg : Object.keys(msg as object)[0];
				console.debug('[Lobby:%s] message: %s', lobbyId, key);

				// LobbySnapshot initialises state — replay any buffered deltas after.
				if (typeof msg === 'object' && 'LobbySnapshot' in msg) {
					initialized = true;
					dispatch({ type: 'OPEN', info: msg.LobbySnapshot });
					for (const buffered of pendingMessages) {
						processMessage(buffered);
					}
					pendingMessages.length = 0;
					return;
				}

				// Delta messages before the snapshot is received are buffered and
				// replayed in order once LobbySnapshot arrives.
				if (!initialized) {
					console.debug('[Lobby:%s] buffering pre-snapshot message', lobbyId);
					pendingMessages.push(rawMsg);
					return;
				}

				// LobbyClosed: go idle, navigate, and invalidate future onClose.
				if (typeof msg === 'object' && 'LobbyClosed' in msg) {
					console.debug('[Lobby:%s] LobbyClosed received', lobbyId);
					streamCounterRef.current++; // invalidate this stream's onClose
					dispatch({ type: 'CLOSE' });
					navigateRef.current('/home');
					return;
				}

				dispatch({ type: 'MESSAGE', msg });
			};

			return {
				onOpen() {
					console.debug('[Lobby:%s] stream opened (streamId=%d)', lobbyId, myStreamId);
				},

				onMessage(rawMsg: unknown) {
					processMessage(rawMsg);
				},

				onClose() {
					console.debug(
						'[Lobby:%s] stream closed (myStreamId=%d, currentStreamId=%d)',
						lobbyId,
						myStreamId,
						streamCounterRef.current,
					);

					// Stale-close guard: leave() or LobbyClosed already bumped the counter.
					if (streamCounterRef.current !== myStreamId) {
						console.debug('[Lobby:%s] stale onClose ignored', lobbyId);
						return;
					}

					// Unexpected close (network drop, session expired, etc.).
					console.debug('[Lobby:%s] unexpected close → navigating to /home', lobbyId);
					dispatch({ type: 'CLOSE' });
					navigateRef.current('/home');
				},

				onError(err: unknown) {
					console.warn('[Lobby:%s] stream error:', lobbyId, err);
				},
			};
		};

		console.debug('[Lobby] registering uni handler');
		connectionManager.registerUniHandler('Lobby', factory);
		return () => {
			console.debug('[Lobby] unregistering uni handler');
			connectionManager.unregisterHandler('Lobby');
		};
	}, [connectionManager]);

	// ─── Public actions ───────────────────────────────────────────────

	const setReady = useCallback(async (ready: boolean) => {
		const state = lobbyStateRef.current;
		if (state.status !== 'active') return;
		console.debug('[Lobby] setReady(%s)', ready);
		await setReadyApi(state.lobbyId, ready);
	}, []);

	const setCharacter = useCallback(async (characterClass: string) => {
		const state = lobbyStateRef.current;
		if (state.status !== 'active') return;
		console.debug('[Lobby] setCharacter(%s)', characterClass);
		await setCharacterApi(state.lobbyId, characterClass);
	}, []);

	const updateSettings = useCallback(async (patch: Partial<LobbySettings>) => {
		const state = lobbyStateRef.current;
		if (state.status !== 'active') return;
		console.debug('[Lobby] updateSettings', patch);
		await updateLobbySettings(state.lobbyId, patch);
	}, []);

	const leave = useCallback(async () => {
		const state = lobbyStateRef.current;
		if (state.status !== 'active') {
			console.debug('[Lobby] leave() called with no active lobby, ignoring');
			return;
		}
		const { lobbyId } = state;

		// Bump counter to suppress the deferred onClose navigation.
		streamCounterRef.current++;
		// Optimistically transition to idle and navigate immediately for snappy UX.
		dispatch({ type: 'CLOSE' });
		console.debug('[Lobby] leave() navigating to /home');
		navigateRef.current('/home');

		// Fire-and-forget: server's stream-cleanup task reconciles backend state
		// if this call fails, so we never block the UI on the API response.
		try {
			await leaveLobby(lobbyId);
		} catch (err: unknown) {
			console.error('[Lobby] leave() API failed (already navigated):', err);
		}
	}, []);

	return (
		<LobbyContext.Provider value={{ lobbyState, setReady, setCharacter, updateSettings, leave }}>
			{children}
		</LobbyContext.Provider>
	);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function useLobby(): LobbyContextType {
	const ctx = useContext(LobbyContext);
	if (!ctx) {
		throw new Error('useLobby must be used within a LobbyProvider');
	}
	return ctx;
}
