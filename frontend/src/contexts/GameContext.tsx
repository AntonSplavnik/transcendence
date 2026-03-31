/*
 * GameContext — reactive game state on top of the bidi Game stream.
 *
 * Registers a bidi-stream handler for the `"Game"` StreamType.  The server
 * opens this stream for players when the lobby countdown fires.
 *
 * High-frequency data
 * ───────────────────
 * `GameStateSnapshot` (60 Hz) is stored in `snapshotRef` — a plain ref, NOT
 * React state — so Babylon.js can read it directly from the render loop
 * without causing React re-renders.
 *
 * Navigation strategy
 * ───────────────────
 * - idle → active : navigate to /game  (effect watching gameState.status)
 * - onClose (game ends / player leaves) : navigate to /lobby if the lobby is
 *   still active, otherwise /home.  The LobbyContext's `lobbyState` is read
 *   via `useLobby()` — `LobbyProvider` must be an ancestor.
 *
 * Must be nested inside `LobbyProvider` and `StreamProvider`.
 */

import type { ReactNode, RefObject } from 'react';
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import type {
	GameClientMessage,
	GameServerMessage,
	GameStateSnapshot,
	Vector3D,
} from '../game/types';
import type { BidiHandlerFactory } from '../stream/types';
import { useAuth } from './AuthContext';
import { useLobby } from './LobbyContext';
import { useStream } from './StreamContext';

// ─── State machine ────────────────────────────────────────────────────────────

export type GameState =
	| { status: 'idle' }
	| {
			status: 'active';
			/** Keyed by player_id */
			players: ReadonlyMap<number, { name: string }>;
	  };

// ─── Reducer ─────────────────────────────────────────────────────────────────

type GameAction =
	| { type: 'OPEN' }
	| { type: 'CLOSE' }
	| { type: 'PLAYER_JOINED'; player_id: number; name: string }
	| { type: 'PLAYER_LEFT'; player_id: number };

function gameReducer(state: GameState, action: GameAction): GameState {
	switch (action.type) {
		case 'OPEN':
			return { status: 'active', players: new Map() };
		case 'CLOSE':
			return { status: 'idle' };
		case 'PLAYER_JOINED': {
			if (state.status !== 'active') return state;
			const players = new Map(state.players);
			players.set(action.player_id, { name: action.name });
			return { ...state, players };
		}
		case 'PLAYER_LEFT': {
			if (state.status !== 'active') return state;
			const players = new Map(state.players);
			players.delete(action.player_id);
			return { ...state, players };
		}
		default:
			return state;
	}
}

// ─── Wire message parser ──────────────────────────────────────────────────────

/**
 * Light structural check on a raw CBOR-decoded value.
 *
 * `GameServerMessage` uses serde's internally-tagged format (`#[serde(tag = "type")]`),
 * so all variants have a top-level `"type"` string field.
 */
function parseGameMessage(raw: unknown): GameServerMessage | null {
	if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
		const obj = raw as Record<string, unknown>;
		if (typeof obj.type === 'string') {
			return raw as GameServerMessage;
		}
	}
	console.warn('[Game] unrecognised message shape:', raw);
	return null;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface GameContextType {
	gameState: GameState;
	/**
	 * Ref containing the latest `GameStateSnapshot` received from the server.
	 * Updated at up to 60 Hz.  Read by the Babylon render loop directly —
	 * never stored in React state to avoid 60 Hz re-renders.
	 */
	snapshotRef: RefObject<GameStateSnapshot | null>;
	/**
	 * Ref mapping player_id → character_class string (e.g. "Knight", "Rogue").
	 * Populated when `PlayerJoined` arrives; cleared when the game stream closes.
	 * Read by the Babylon render loop to pick the correct remote character model.
	 */
	characterClassesRef: RefObject<Map<number, string>>;
	/**
	 * Send a player input frame to the server.
	 * No-op when the game is not active or the send callback is not set.
	 */
	sendInput(
		movement: Vector3D,
		lookDirection: Vector3D,
		attacking: boolean,
		jumping: boolean,
		sprinting: boolean,
	): void;
}

const GameContext = createContext<GameContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function GameProvider({ children }: { children: ReactNode }) {
	const { connectionManager } = useStream();
	const { lobbyState } = useLobby();
	const { user } = useAuth();
	const navigate = useNavigate();

	const [gameState, dispatch] = useReducer(gameReducer, { status: 'idle' });

	// High-frequency snapshot — stored as a ref, NOT in React state.
	const snapshotRef = useRef<GameStateSnapshot | null>(null);

	// Character class map — keyed by player_id, populated from PlayerJoined messages.
	const characterClassesRef = useRef<Map<number, string>>(new Map());

	// Send callback captured from the bidi factory.  Cleared in onClose.
	const sendRef = useRef<((msg: GameClientMessage) => void) | null>(null);

	// Stable navigate ref.
	const navigateRef = useRef(navigate);
	useEffect(() => {
		navigateRef.current = navigate;
	}, [navigate]);

	// Mirror lobby state into a ref so onClose can read it without being a
	// stale closure (the factory is only created once on mount).
	const lobbyStateRef = useRef(lobbyState);
	useEffect(() => {
		lobbyStateRef.current = lobbyState;
	}, [lobbyState]);

	// Stable gameState ref for sendInput callback.
	const gameStateRef = useRef(gameState);
	useEffect(() => {
		gameStateRef.current = gameState;
	}, [gameState]);

	// Track spectator status — spectators must not send input to the server.
	// A user is a spectator when they are in the lobby but NOT in the players map.
	const isSpectatorRef = useRef(false);
	useEffect(() => {
		if (!user || lobbyState.status !== 'active') {
			isSpectatorRef.current = false;
			return;
		}
		isSpectatorRef.current = !lobbyState.players.has(user.id);
	}, [lobbyState, user]);

	// ─── Navigation: idle → active ────────────────────────────────────
	const prevGameStatusRef = useRef<'idle' | 'active'>(gameState.status);
	useEffect(() => {
		const prev = prevGameStatusRef.current;
		prevGameStatusRef.current = gameState.status;
		if (prev === 'idle' && gameState.status === 'active') {
			console.debug('[Game] state idle→active, navigating to /game');
			navigateRef.current('/game');
		}
	}, [gameState.status]);

	// ─── Stream handler ───────────────────────────────────────────────
	useEffect(() => {
		const factory: BidiHandlerFactory<unknown, unknown> = (_data, send) => {
			console.debug('[Game] factory invoked (bidi stream opening)');
			// Capture the send callback immediately when the factory runs.
			sendRef.current = send as (msg: GameClientMessage) => void;

			return {
				onOpen() {
					console.debug('[Game] stream opened');
					dispatch({ type: 'OPEN' });
				},

				onMessage(rawMsg: unknown) {
					const msg = parseGameMessage(rawMsg);
					if (!msg) return;

					if (msg.type === 'Snapshot') {
						// High-frequency: stored in ref, never triggers a re-render.
						snapshotRef.current = msg as unknown as GameStateSnapshot;
						return;
					}
					if (msg.type === 'PlayerJoined') {
						console.debug(
							'[Game] PlayerJoined player_id=%d name=%s class=%s',
							msg.player_id,
							msg.name,
							msg.character_class,
						);
						characterClassesRef.current.set(msg.player_id, msg.character_class);
						dispatch({
							type: 'PLAYER_JOINED',
							player_id: msg.player_id,
							name: msg.name,
						});
						return;
					}
					if (msg.type === 'PlayerLeft') {
						console.debug('[Game] PlayerLeft player_id=%d', msg.player_id);
						dispatch({ type: 'PLAYER_LEFT', player_id: msg.player_id });
						return;
					}
					if (msg.type === 'Error') {
						console.warn('[Game] server error:', msg.message);
					}
				},

				onClose() {
					console.debug('[Game] stream closed, dispatching CLOSE');
					sendRef.current = null;
					snapshotRef.current = null;
					characterClassesRef.current.clear();
					dispatch({ type: 'CLOSE' });

					const ls = lobbyStateRef.current;
					const hasGameEndResult = ls.status === 'active' && ls.gameEndResult != null;

					if (hasGameEndResult) {
						// GameEndModal is showing on /game — it handles navigation on dismiss.
						console.debug('[Game] game-end result pending, skipping navigation');
						return;
					}

					// Navigate back to lobby if still in one, otherwise home.
					if (ls.status === 'active') {
						console.debug('[Game] returning to /lobby');
						navigateRef.current('/lobby');
					} else {
						console.debug('[Game] returning to /home');
						navigateRef.current('/home');
					}
				},

				onError(err) {
					console.warn('[Game] stream error:', err);
				},
			};
		};

		console.debug('[Game] registering bidi handler');
		connectionManager.registerBidiHandler('Game', factory);
		return () => {
			console.debug('[Game] unregistering bidi handler');
			connectionManager.unregisterHandler('Game');
		};
	}, [connectionManager]);

	// ─── sendInput (stable, reads from refs) ─────────────────────────
	const sendInput = useCallback(
		(
			movement: Vector3D,
			lookDirection: Vector3D,
			attacking: boolean,
			jumping: boolean,
			sprinting: boolean,
		) => {
			if (
				gameStateRef.current.status !== 'active' ||
				!sendRef.current ||
				isSpectatorRef.current
			)
				return;
			sendRef.current({
				type: 'Input',
				movement,
				look_direction: lookDirection,
				attacking,
				jumping,
				sprinting,
			});
		},
		[], // stable — all state accessed via refs
	);

	return (
		<GameContext.Provider value={{ gameState, snapshotRef, characterClassesRef, sendInput }}>
			{children}
		</GameContext.Provider>
	);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function useGame(): GameContextType {
	const ctx = useContext(GameContext);
	if (!ctx) {
		throw new Error('useGame must be used within a GameProvider');
	}
	return ctx;
}
