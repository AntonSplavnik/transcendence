/*
 * Chat system — wire protocol types and internal state types.
 *
 * Wire types mirror the Rust backend exactly (serde externally-tagged).
 * Internal state types are client-only and not sent over the wire.
 */

// ─── Wire: room metadata ──────────────────────────────────────────────────────

/** Matches backend ChatRoomType enum. */
export type ChatRoomType = 'Global' | 'InviteOnly' | 'Dm' | 'GameLobby';

/** Non-fatal errors the server sends inline on the chat stream. */
export type ChatStreamError =
	| 'RateLimitExceeded'
	| 'MessageTooLong'
	| 'InvalidMessageId'
	| 'CantUnreadText';

// ─── Wire: message types ──────────────────────────────────────────────────────

/** A persisted chat message (appears in MsgLog and NewMsg). */
export interface ChatMessage {
	id: string; // Ulid
	sender_id: number;
	content: string;
	created_at: string; // ISO-8601 UTC
}

/** A chat room member. */
export interface ChatMember {
	user_id: number;
	last_read_message_id: string | null; // Ulid or null
	joined_at: string; // ISO-8601 UTC
}

/** A non-persisted server-generated event message (ephemeral). */
export interface ServerChatMessage {
	id: string; // Ulid
	content: ServerChatMessagePayload;
	created_at: string; // ISO-8601 UTC
}

/** Structured payload for server-generated messages. */
export type ServerChatMessagePayload = {
	KillFeed: { target_id: number; killer_id: number };
};

// ─── Wire: ServerMessage (server → client) ────────────────────────────────────

/**
 * All messages the server can send on a chat room bidi stream.
 * Serde externally-tagged: { "Variant": payload } or "UnitVariant".
 */
export type ServerMessage =
	// Room metadata
	| { ChatName: string }
	| { ChatType: ChatRoomType }
	// Nickname updates
	| { Nicks: Array<[number, string]> }
	| { Nick: { user_id: number; nickname: string } }
	// Message log
	| { MsgLog: ChatMessage[] }
	| { NewMsg: ChatMessage }
	| { NewServerMsg: ServerChatMessage }
	// Typing & read receipts
	| { IsTyping: number } // user_id
	| { ReadText: { user_id: number; message_id: string } }
	// Membership
	| { Members: { members: ChatMember[]; online: number[] } }
	| { MemberConnected: number } // user_id
	| { MemberDisconnected: number } // user_id
	| { MemberAdded: ChatMember }
	| { MemberRemoved: { user_id: number; actor_id: number } }
	// Errors
	| { Error: ChatStreamError };

// ─── Wire: ClientMessage (client → server) ────────────────────────────────────

/**
 * Messages the client can send on a chat room bidi stream.
 * Server silently ignores messages not applicable to the room type.
 */
export type ClientMessage = { SendText: string } | 'IsTyping' | { ReadText: string }; // Ulid of the message being marked as read

// ─── Internal: state types ────────────────────────────────────────────────────

/** Ephemeral join/leave event — not persisted, cleared on reconnect. */
export interface SystemEvent {
	id: string;
	text: string;
	timestamp: string; // ISO-8601
}

/** Per-room state maintained by the chat reducer. */
export interface ChatRoomState {
	roomId: string; // Ulid
	name: string | null;
	chatType: ChatRoomType | null; // null until ChatType message received
	messages: ChatMessage[];
	serverMessages: ServerChatMessage[]; // ephemeral, cleared on reconnect
	systemEvents: SystemEvent[]; // ephemeral, cleared on reconnect
	members: ChatMember[] | null; // null until Members received
	onlineMembers: Set<number>; // user_ids of connected members
	nicks: Map<number, string>; // user_id → nickname cache for this room
	/** Which users are currently showing a typing indicator. */
	typingUsers: Set<number>;
	lastReadByUser: Map<number, string>; // user_id → last read message Ulid
	connected: boolean;
	send: ((msg: ClientMessage) => void) | null;
}

/**
 * A single item in the chat message list.
 * Pre-computed from raw room state for efficient rendering.
 */
export type DisplayItem =
	| { kind: 'msg'; msg: ChatMessage; nickname: string; isSelf: boolean }
	| { kind: 'server'; msg: ServerChatMessage; text: string }
	| { kind: 'system'; event: SystemEvent };

/** Per-user chat preferences, persisted to localStorage. */
export interface ChatPreferences {
	globalEnabled: boolean;
	visible: boolean;
	blockedUsers: number[];
}
