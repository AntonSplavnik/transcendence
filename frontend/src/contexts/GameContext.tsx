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
	GameEvent,
	GameServerMessage,
	GameStateSnapshot,
	PlayerMatchStats,
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
			/** Non-null when the match has ended — contains the final leaderboard. */
			matchEndData: PlayerMatchStats[] | null;
			/** Keyed by player_id */
			players: ReadonlyMap<number, { name: string }>;
	  };

// ─── Reducer ─────────────────────────────────────────────────────────────────

type GameAction =
	| { type: 'OPEN' }
	| { type: 'CLOSE' }
	| { type: 'MATCH_ENDED'; stats: PlayerMatchStats[] }
	| { type: 'PLAYER_JOINED'; player_id: number; name: string }
	| { type: 'PLAYER_LEFT'; player_id: number };

function gameReducer(state: GameState, action: GameAction): GameState {
	switch (action.type) {
		case 'OPEN':
			return { status: 'active', matchEndData: null, players: new Map() };
		case 'CLOSE':
			return { status: 'idle' };
		case 'MATCH_ENDED':
			if (state.status !== 'active') return state;
			return { ...state, matchEndData: action.stats };
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
	 * Populated when the first `Spawn` arrives for a player; cleared when the game stream closes.
	 * Read by the Babylon render loop to pick the correct remote character model.
	 */
	characterClassesRef: RefObject<Map<number, string>>;
	/**
	 * Ref containing a queue of game events (Death, Damage, Spawn, etc.).
	 * Pushed by GameContext on message arrival; drained by the Babylon render
	 * loop each frame via `splice(0)`.
	 */
	eventsRef: RefObject<GameEvent[]>;
	/**
	 * Clean up game state and navigate to lobby/home.
	 * Used by GameEndModal after match end (button click or timer expiry).
	 */
	leaveGame(): void;
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
		ability1: boolean,
		ability2: boolean,
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

	// Character class map — keyed by player_id, populated from Spawn events.
	const characterClassesRef = useRef<Map<number, string>>(new Map());

	// Event queue — drained by the Babylon render loop each frame.
	const eventsRef = useRef<GameEvent[]>([]);

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

	// Mirror matchEndData into a ref so the onClose closure can read it
	// without being a stale closure.  The ref is the synchronization primitive
	// between onMessage(MatchEnd) and onClose — both sequential, same handler.
	const matchEndedRef = useRef(false);
	useEffect(() => {
		matchEndedRef.current = gameState.status === 'active' && gameState.matchEndData !== null;
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
					if (msg.type === 'Spawn') {
						if (!characterClassesRef.current.has(msg.player_id)) {
							console.debug(
								'[Game] Spawn (initial) player_id=%d name=%s class=%s',
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
						}
						eventsRef.current.push(msg);
						return;
					}
					if (msg.type === 'MatchEnd') {
						eventsRef.current.push(msg);
						// Set the ref synchronously BEFORE dispatch so the onClose
						// callback (which fires next in the same handler chain) sees it.
						matchEndedRef.current = true;
						dispatch({ type: 'MATCH_ENDED', stats: msg.players });
						return;
					}
					if (
						msg.type === 'Death' ||
						msg.type === 'Damage' ||
						msg.type === 'StateChange' ||
						msg.type === 'AttackStarted' ||
						msg.type === 'SkillUsed'
					) {
						eventsRef.current.push(msg);
						return;
					}
					if (msg.type === 'Error') {
						console.warn('[Game] server error:', msg.message);
					}
				},

				onClose() {
					console.debug('[Game] stream closed');

					// Already cleaned up (e.g. leaveGame() ran before the stream closed).
					if (gameStateRef.current.status === 'idle') return;

					sendRef.current = null;
					snapshotRef.current = null;
					characterClassesRef.current.clear();
					eventsRef.current.length = 0;

					if (matchEndedRef.current) {
						// Match ended normally — GameEndModal handles navigation.
						// Keep gameState 'active' so GameBoard stays mounted with the modal.
						console.debug('[Game] match ended, suppressing onClose navigation');
						matchEndedRef.current = false;
						return;
					}

					dispatch({ type: 'CLOSE' });
					// Navigate back to lobby if still in one, otherwise home.
					if (lobbyStateRef.current.status === 'active') {
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

	// ─── leaveGame (used by GameEndModal after match ends) ───────────
	const leaveGame = useCallback(() => {
		dispatch({ type: 'CLOSE' });
		if (lobbyStateRef.current.status === 'active') {
			navigateRef.current('/lobby');
		} else {
			navigateRef.current('/home');
		}
	}, []);

	// ─── sendInput (stable, reads from refs) ─────────────────────────
	const sendInput = useCallback(
		(
			movement: Vector3D,
			lookDirection: Vector3D,
			attacking: boolean,
			jumping: boolean,
			sprinting: boolean,
			ability1: boolean,
			ability2: boolean,
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
				ability1,
				ability2,
			});
		},
		[], // stable — all state accessed via refs
	);

	return (
		<GameContext.Provider
			value={{ gameState, snapshotRef, characterClassesRef, eventsRef, sendInput, leaveGame }}
		>
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
