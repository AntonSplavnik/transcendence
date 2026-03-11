/*
 * Chat reducer — pure state transitions for the chat system.
 *
 * State is a Map<roomId, ChatRoomState>. Every action returns a new Map
 * reference so React detects the change and re-renders.
 *
 * The reducer is intentionally free of side effects:
 *   - No setTimeout / clearTimeout calls (managed by ChatContext refs).
 *   - No localStorage access (managed by ChatContext).
 *   - typingUsers is a Set<number> — context owns the actual timeout handles.
 */

import type {
	ChatMessage,
	ChatMember,
	ChatRoomState,
	ChatRoomType,
	ClientMessage,
	ServerChatMessage,
	SystemEvent,
} from './types';

// ─── Action union ─────────────────────────────────────────────────────────────

export type ChatAction =
	| { type: 'ROOM_OPENED'; roomId: string; send: (msg: ClientMessage) => void }
	| { type: 'ROOM_CLOSED'; roomId: string }
	| { type: 'RESET' }
	| { type: 'MSG_LOG'; roomId: string; messages: ChatMessage[] }
	| { type: 'NEW_MSG'; roomId: string; msg: ChatMessage }
	| { type: 'IS_TYPING'; roomId: string; userId: number }
	| { type: 'CLEAR_TYPING'; roomId: string; userId: number }
	| { type: 'MEMBER_ADDED'; roomId: string; member: ChatMember }
	| { type: 'MEMBER_REMOVED'; roomId: string; userId: number; actorId: number }
	| { type: 'CHAT_TYPE'; roomId: string; chatType: ChatRoomType }
	| { type: 'CHAT_NAME'; roomId: string; name: string }
	| { type: 'NICKS'; roomId: string; nicks: Array<[number, string]> }
	| { type: 'NICK'; roomId: string; userId: number; nickname: string }
	| { type: 'NEW_SERVER_MSG'; roomId: string; msg: ServerChatMessage }
	| { type: 'MEMBERS'; roomId: string; members: ChatMember[]; online: number[] }
	| { type: 'MEMBER_CONNECTED'; roomId: string; userId: number }
	| { type: 'MEMBER_DISCONNECTED'; roomId: string; userId: number }
	| { type: 'READ_TEXT'; roomId: string; userId: number; messageId: string };

// ─── State type ───────────────────────────────────────────────────────────────

export type ChatState = Map<string, ChatRoomState>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSystemEvent(text: string): SystemEvent {
	return {
		id: crypto.randomUUID(),
		text,
		timestamp: new Date().toISOString(),
	};
}

/**
 * Build a fresh ChatRoomState for an opening stream.
 * Preserves messages/nicks/members from a previous session if the room
 * already existed (reconnect scenario). Ephemeral fields are always reset.
 */
function openRoom(
	roomId: string,
	send: (msg: ClientMessage) => void,
	existing?: ChatRoomState,
): ChatRoomState {
	return {
		roomId,
		name: existing?.name ?? null,
		chatType: existing?.chatType ?? null,
		messages: existing?.messages ?? [],
		serverMessages: [], // always cleared — ephemeral
		systemEvents: [], // always cleared — ephemeral
		members: existing?.members ?? null,
		onlineMembers: new Set<number>(),
		nicks: existing?.nicks ?? new Map<number, string>(),
		typingUsers: new Set<number>(),
		lastReadByUser: existing?.lastReadByUser ?? new Map<number, string>(),
		connected: true,
		send,
	};
}

/** Apply an updater to a single room, returning a new Map. */
function updateRoom(
	state: ChatState,
	roomId: string,
	updater: (room: ChatRoomState) => ChatRoomState,
): ChatState {
	const room = state.get(roomId);
	if (!room) return state;
	const next = new Map(state);
	next.set(roomId, updater(room));
	return next;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
	switch (action.type) {
		case 'ROOM_OPENED': {
			const existing = state.get(action.roomId);
			const next = new Map(state);
			next.set(action.roomId, openRoom(action.roomId, action.send, existing));
			return next;
		}

		case 'ROOM_CLOSED': {
			const room = state.get(action.roomId);
			if (!room) return state;
			// GameLobby rooms are ephemeral — delete entirely when their stream closes.
			if (room.chatType === 'GameLobby') {
				const next = new Map(state);
				next.delete(action.roomId);
				return next;
			}
			// Other rooms: mark disconnected but keep state for display.
			return updateRoom(state, action.roomId, (r) => ({
				...r,
				connected: false,
				send: null,
				typingUsers: new Set<number>(),
			}));
		}

		case 'RESET': {
			// Mark all rooms disconnected (connection dropped).
			// GameLobby rooms are NOT deleted here — the server will close their
			// streams individually, triggering ROOM_CLOSED which deletes them.
			const next = new Map<string, ChatRoomState>();
			for (const [id, room] of state) {
				next.set(id, {
					...room,
					connected: false,
					send: null,
					typingUsers: new Set<number>(),
				});
			}
			return next;
		}

		case 'MSG_LOG':
			// Replace message list entirely (initial state delivery).
			return updateRoom(state, action.roomId, (r) => ({
				...r,
				messages: action.messages,
			}));

		case 'NEW_MSG':
			// Append message + clear typing indicator for sender.
			return updateRoom(state, action.roomId, (r) => {
				const typingUsers = new Set(r.typingUsers);
				typingUsers.delete(action.msg.sender_id);
				return {
					...r,
					messages: [...r.messages, action.msg],
					typingUsers,
				};
			});

		case 'IS_TYPING':
			return updateRoom(state, action.roomId, (r) => {
				const typingUsers = new Set(r.typingUsers);
				typingUsers.add(action.userId);
				return { ...r, typingUsers };
			});

		case 'CLEAR_TYPING':
			return updateRoom(state, action.roomId, (r) => {
				const typingUsers = new Set(r.typingUsers);
				typingUsers.delete(action.userId);
				return { ...r, typingUsers };
			});

		case 'MEMBER_ADDED': {
			return updateRoom(state, action.roomId, (r) => {
				const nick = r.nicks.get(action.member.user_id) ?? `#${action.member.user_id}`;
				return {
					...r,
					members: [...(r.members ?? []), action.member],
					systemEvents: [...r.systemEvents, makeSystemEvent(`${nick} joined`)],
				};
			});
		}

		case 'MEMBER_REMOVED': {
			return updateRoom(state, action.roomId, (r) => {
				const nick = r.nicks.get(action.userId) ?? `#${action.userId}`;
				const verb = action.userId === action.actorId ? 'left' : 'was removed';
				return {
					...r,
					members: (r.members ?? []).filter((m) => m.user_id !== action.userId),
					systemEvents: [...r.systemEvents, makeSystemEvent(`${nick} ${verb}`)],
				};
			});
		}

		case 'CHAT_TYPE':
			return updateRoom(state, action.roomId, (r) => ({
				...r,
				chatType: action.chatType,
			}));

		case 'CHAT_NAME':
			return updateRoom(state, action.roomId, (r) => ({
				...r,
				name: action.name,
			}));

		case 'NICKS':
			return updateRoom(state, action.roomId, (r) => {
				const nicks = new Map(r.nicks);
				for (const [userId, nickname] of action.nicks) {
					nicks.set(userId, nickname);
				}
				return { ...r, nicks };
			});

		case 'NICK':
			return updateRoom(state, action.roomId, (r) => {
				const nicks = new Map(r.nicks);
				nicks.set(action.userId, action.nickname);
				return { ...r, nicks };
			});

		case 'NEW_SERVER_MSG':
			return updateRoom(state, action.roomId, (r) => ({
				...r,
				serverMessages: [...r.serverMessages, action.msg],
			}));

		case 'MEMBERS':
			return updateRoom(state, action.roomId, (r) => ({
				...r,
				members: action.members,
				onlineMembers: new Set<number>(action.online),
			}));

		case 'MEMBER_CONNECTED':
			return updateRoom(state, action.roomId, (r) => {
				const onlineMembers = new Set(r.onlineMembers);
				onlineMembers.add(action.userId);
				return { ...r, onlineMembers };
			});

		case 'MEMBER_DISCONNECTED':
			return updateRoom(state, action.roomId, (r) => {
				const onlineMembers = new Set(r.onlineMembers);
				onlineMembers.delete(action.userId);
				return { ...r, onlineMembers };
			});

		case 'READ_TEXT':
			return updateRoom(state, action.roomId, (r) => {
				const lastReadByUser = new Map(r.lastReadByUser);
				lastReadByUser.set(action.userId, action.messageId);
				return { ...r, lastReadByUser };
			});

		default:
			return state;
	}
}
