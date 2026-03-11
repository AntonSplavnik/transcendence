/*
 * ChatContext — reactive chat state on top of WebTransport bidi streams.
 *
 * Registers a bidi handler factory for the "ChatRoom" StreamType.
 * Each incoming chat stream gets its own handler that dispatches actions
 * to the shared chat reducer.
 *
 * Must be nested inside StreamProvider and NotificationProvider.
 */

import type { Dispatch, ReactNode } from 'react';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from 'react';

import { useAuth } from './AuthContext';
import { useStream } from './StreamContext';
import { chatReducer } from '../chat/chatReducer';
import type { ChatAction, ChatState } from '../chat/chatReducer';
import { loadPreferences, savePreferences } from '../chat/storage';
import type {
	ChatPreferences,
	ChatRoomState,
	ChatStreamError,
	ClientMessage,
	ServerMessage,
} from '../chat/types';
import type { BidiHandlerFactory, BidiStreamHandler } from '../stream/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPING_DISPLAY_MS = 3_000;
const TYPING_SEND_COOLDOWN_MS = 3_000;
const ERROR_CLEAR_MS = 4_000;
const SEND_COOLDOWN_MS = 200;

// ─── Context shape ────────────────────────────────────────────────────────────

interface ChatContextType {
	rooms: ChatState;
	orderedRoomIds: string[];
	activeRoomId: string | null;
	setActiveRoomId: (id: string | null) => void;
	sendMessage: (roomId: string, text: string) => void;
	sendTypingIndicator: (roomId: string) => void;
	sendReadReceipt: (roomId: string, messageId: string) => void;
	chatOpen: boolean;
	setChatOpen: (open: boolean) => void;
	preferences: ChatPreferences;
	updatePreferences: (patch: Partial<ChatPreferences>) => void;
	chatError: { roomId: string; error: ChatStreamError } | null;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

// ─── Handler factory ──────────────────────────────────────────────────────────

/**
 * Build a BidiStreamHandler for a single chat room stream.
 * Called once per incoming stream by the factory registered with ConnectionManager.
 * All parameters are stable references (dispatch, refs) — no stale closure issues.
 */
function createChatRoomHandler(
	roomId: string,
	send: (msg: ClientMessage) => void,
	dispatch: Dispatch<ChatAction>,
	typingTimeoutsRef: React.MutableRefObject<Map<string, ReturnType<typeof setTimeout>>>,
	setChatError: (err: { roomId: string; error: ChatStreamError } | null) => void,
	errorClearRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
): BidiStreamHandler<ServerMessage> {
	function clearTypingTimeout(userId: number): void {
		const key = `${roomId}:${userId}`;
		const handle = typingTimeoutsRef.current.get(key);
		if (handle !== undefined) {
			clearTimeout(handle);
			typingTimeoutsRef.current.delete(key);
		}
	}

	function clearRoomTypingTimeouts(): void {
		const prefix = `${roomId}:`;
		for (const key of [...typingTimeoutsRef.current.keys()]) {
			if (key.startsWith(prefix)) {
				clearTimeout(typingTimeoutsRef.current.get(key)!);
				typingTimeoutsRef.current.delete(key);
			}
		}
	}

	return {
		onOpen() {
			console.info(`[Chat] room opened: ${roomId}`);
			dispatch({ type: 'ROOM_OPENED', roomId, send });
		},

		onMessage(msg: ServerMessage) {
			if ('ChatName' in msg) {
				dispatch({ type: 'CHAT_NAME', roomId, name: msg.ChatName });
			} else if ('ChatType' in msg) {
				dispatch({ type: 'CHAT_TYPE', roomId, chatType: msg.ChatType });
			} else if ('Nicks' in msg) {
				dispatch({ type: 'NICKS', roomId, nicks: msg.Nicks });
			} else if ('Nick' in msg) {
				dispatch({
					type: 'NICK',
					roomId,
					userId: msg.Nick.user_id,
					nickname: msg.Nick.nickname,
				});
			} else if ('MsgLog' in msg) {
				dispatch({ type: 'MSG_LOG', roomId, messages: msg.MsgLog });
			} else if ('NewMsg' in msg) {
				clearTypingTimeout(msg.NewMsg.sender_id);
				dispatch({ type: 'CLEAR_TYPING', roomId, userId: msg.NewMsg.sender_id });
				dispatch({ type: 'NEW_MSG', roomId, msg: msg.NewMsg });
			} else if ('NewServerMsg' in msg) {
				dispatch({ type: 'NEW_SERVER_MSG', roomId, msg: msg.NewServerMsg });
			} else if ('IsTyping' in msg) {
				const userId = msg.IsTyping;
				clearTypingTimeout(userId);
				const handle = setTimeout(() => {
					typingTimeoutsRef.current.delete(`${roomId}:${userId}`);
					dispatch({ type: 'CLEAR_TYPING', roomId, userId });
				}, TYPING_DISPLAY_MS);
				typingTimeoutsRef.current.set(`${roomId}:${userId}`, handle);
				dispatch({ type: 'IS_TYPING', roomId, userId });
			} else if ('ReadText' in msg) {
				dispatch({
					type: 'READ_TEXT',
					roomId,
					userId: msg.ReadText.user_id,
					messageId: msg.ReadText.message_id,
				});
			} else if ('Members' in msg) {
				dispatch({
					type: 'MEMBERS',
					roomId,
					members: msg.Members.members,
					online: msg.Members.online,
				});
			} else if ('MemberConnected' in msg) {
				dispatch({ type: 'MEMBER_CONNECTED', roomId, userId: msg.MemberConnected });
			} else if ('MemberDisconnected' in msg) {
				dispatch({ type: 'MEMBER_DISCONNECTED', roomId, userId: msg.MemberDisconnected });
			} else if ('MemberAdded' in msg) {
				dispatch({ type: 'MEMBER_ADDED', roomId, member: msg.MemberAdded });
			} else if ('MemberRemoved' in msg) {
				dispatch({
					type: 'MEMBER_REMOVED',
					roomId,
					userId: msg.MemberRemoved.user_id,
					actorId: msg.MemberRemoved.actor_id,
				});
			} else if ('Error' in msg) {
				const error = msg.Error;
				// These are client logic bugs — log silently, don't surface to user.
				if (error === 'InvalidMessageId' || error === 'CantUnreadText') {
					console.warn(`[Chat] ${roomId}: server error ${error} (client logic issue)`);
					return;
				}
				// Clear any previous error auto-dismiss.
				if (errorClearRef.current !== null) {
					clearTimeout(errorClearRef.current);
				}
				setChatError({ roomId, error });
				errorClearRef.current = setTimeout(() => {
					setChatError(null);
					errorClearRef.current = null;
				}, ERROR_CLEAR_MS);
			}
		},

		onClose() {
			console.info(`[Chat] room closed: ${roomId}`);
			clearRoomTypingTimeouts();
			dispatch({ type: 'ROOM_CLOSED', roomId });
		},

		onError(err) {
			console.warn(`[Chat] room error on ${roomId}:`, err);
			clearRoomTypingTimeouts();
			dispatch({ type: 'ROOM_CLOSED', roomId });
		},
	};
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ChatProvider({ children }: { children: ReactNode }) {
	const { connectionManager, connectionState } = useStream();
	const { user } = useAuth();

	const [rooms, dispatch] = useReducer(chatReducer, new Map<string, ChatRoomState>());
	const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
	const [chatOpen, setChatOpen] = useState(false);
	const [chatError, setChatError] = useState<{
		roomId: string;
		error: ChatStreamError;
	} | null>(null);

	const [preferences, setPreferences] = useState<ChatPreferences>(() =>
		user ? loadPreferences(user.id) : { globalEnabled: true, visible: true, blockedUsers: [] },
	);

	// Stable refs for timeout management — avoids recreating callbacks on every render.
	const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
	const typingSendCooldownsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
	const errorClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const sendDisabledRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	// Use a ref to access latest rooms without stale closures in send callbacks.
	const roomsRef = useRef(rooms);
	useEffect(() => {
		roomsRef.current = rooms;
	}, [rooms]);

	// Load preferences when the authenticated user changes.
	useEffect(() => {
		if (user) {
			setPreferences(loadPreferences(user.id));
		}
	}, [user]);

	const updatePreferences = useCallback(
		(patch: Partial<ChatPreferences>) => {
			setPreferences((prev) => {
				const next = { ...prev, ...patch };
				if (user) savePreferences(user.id, next);
				return next;
			});
		},
		[user],
	);

	// Watch connection state: on any non-connected state, clear typing timeouts and RESET.
	useEffect(() => {
		if (connectionState.status !== 'connected') {
			for (const handle of typingTimeoutsRef.current.values()) {
				clearTimeout(handle);
			}
			typingTimeoutsRef.current.clear();
			dispatch({ type: 'RESET' });
		}
	}, [connectionState.status]);

	// Register the bidi handler factory with ConnectionManager.
	useEffect(() => {
		const factory: BidiHandlerFactory<ServerMessage> = (data, send) => {
			const roomId = data as string;
			return createChatRoomHandler(
				roomId,
				send as (msg: ClientMessage) => void,
				dispatch,
				typingTimeoutsRef,
				setChatError,
				errorClearRef,
			);
		};
		connectionManager.registerBidiHandler('ChatRoom', factory);
		return () => {
			connectionManager.unregisterHandler('ChatRoom');
		};
	}, [connectionManager]);

	// Clean up all timeouts on unmount.
	useEffect(() => {
		return () => {
			for (const h of typingTimeoutsRef.current.values()) clearTimeout(h);
			for (const h of typingSendCooldownsRef.current.values()) clearTimeout(h);
			for (const h of sendDisabledRef.current.values()) clearTimeout(h);
			if (errorClearRef.current !== null) clearTimeout(errorClearRef.current);
		};
	}, []);

	// Ordered room IDs: Global → GameLobby → others by last message timestamp.
	const orderedRoomIds = useMemo(() => {
		return [...rooms.keys()].sort((a, b) => {
			const ra = rooms.get(a)!;
			const rb = rooms.get(b)!;
			if (ra.chatType === 'Global') return -1;
			if (rb.chatType === 'Global') return 1;
			if (ra.chatType === 'GameLobby') return -1;
			if (rb.chatType === 'GameLobby') return 1;
			const aLast = ra.messages[ra.messages.length - 1]?.created_at ?? '';
			const bLast = rb.messages[rb.messages.length - 1]?.created_at ?? '';
			return bLast.localeCompare(aLast);
		});
	}, [rooms]);

	// Auto-select the first room when rooms become available.
	useEffect(() => {
		if (activeRoomId === null && orderedRoomIds.length > 0) {
			setActiveRoomId(orderedRoomIds[0]);
		}
	}, [orderedRoomIds, activeRoomId]);

	// If the active room was deleted (GameLobby ended), fall back to first available.
	useEffect(() => {
		if (activeRoomId !== null && !rooms.has(activeRoomId)) {
			setActiveRoomId(orderedRoomIds[0] ?? null);
		}
	}, [rooms, activeRoomId, orderedRoomIds]);

	const sendMessage = useCallback((roomId: string, text: string) => {
		if (sendDisabledRef.current.has(roomId)) return;
		const room = roomsRef.current.get(roomId);
		if (!room?.send) return;
		room.send({ SendText: text });
		const handle = setTimeout(() => {
			sendDisabledRef.current.delete(roomId);
		}, SEND_COOLDOWN_MS);
		sendDisabledRef.current.set(roomId, handle);
	}, []);

	const sendTypingIndicator = useCallback((roomId: string) => {
		if (typingSendCooldownsRef.current.has(roomId)) return;
		const room = roomsRef.current.get(roomId);
		if (!room?.send) return;
		room.send('IsTyping');
		const handle = setTimeout(() => {
			typingSendCooldownsRef.current.delete(roomId);
		}, TYPING_SEND_COOLDOWN_MS);
		typingSendCooldownsRef.current.set(roomId, handle);
	}, []);

	const sendReadReceipt = useCallback((roomId: string, messageId: string) => {
		const room = roomsRef.current.get(roomId);
		room?.send?.({ ReadText: messageId });
	}, []);

	return (
		<ChatContext.Provider
			value={{
				rooms,
				orderedRoomIds,
				activeRoomId,
				setActiveRoomId,
				sendMessage,
				sendTypingIndicator,
				sendReadReceipt,
				chatOpen,
				setChatOpen,
				preferences,
				updatePreferences,
				chatError,
			}}
		>
			{children}
		</ChatContext.Provider>
	);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChat(): ChatContextType {
	const ctx = useContext(ChatContext);
	if (!ctx) throw new Error('useChat must be used within a ChatProvider');
	return ctx;
}
