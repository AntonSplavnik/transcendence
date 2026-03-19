import { describe, it, expect, vi } from 'vitest';
import { chatReducer } from '../../../src/chat/chatReducer';
import type { ChatState } from '../../../src/chat/chatReducer';
import type { ChatMessage, ChatMember, ChatRoomState, ServerChatMessage } from '../../../src/chat/types';

// ─── Factories ───────────────────────────────────────────────────────────────

const send = vi.fn();

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: crypto.randomUUID(),
		sender_id: 1,
		content: 'hello',
		created_at: new Date().toISOString(),
		...overrides,
	};
}

function makeMember(overrides: Partial<ChatMember> = {}): ChatMember {
	return {
		user_id: 1,
		last_read_message_id: null,
		joined_at: new Date().toISOString(),
		...overrides,
	};
}

function makeRoom(roomId: string, overrides: Partial<ChatRoomState> = {}): ChatRoomState {
	return {
		roomId,
		name: null,
		chatType: null,
		messages: [],
		serverMessages: [],
		systemEvents: [],
		members: null,
		onlineMembers: new Set(),
		nicks: new Map(),
		typingUsers: new Set(),
		lastReadByUser: new Map(),
		connected: true,
		send,
		...overrides,
	};
}

function stateWith(...rooms: ChatRoomState[]): ChatState {
	const map = new Map<string, ChatRoomState>();
	for (const room of rooms) map.set(room.roomId, room);
	return map;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('chatReducer', () => {
	const empty: ChatState = new Map();

	// ── ROOM_OPENED ──────────────────────────────────────────────────────

	describe('ROOM_OPENED', () => {
		it('creates a new room with defaults', () => {
			const next = chatReducer(empty, { type: 'ROOM_OPENED', roomId: 'r1', send });
			const room = next.get('r1')!;
			expect(room).toBeDefined();
			expect(room.roomId).toBe('r1');
			expect(room.connected).toBe(true);
			expect(room.send).toBe(send);
			expect(room.messages).toEqual([]);
			expect(room.chatType).toBeNull();
			expect(room.name).toBeNull();
			expect(room.members).toBeNull();
		});

		it('preserves persistent fields from existing room (reconnect)', () => {
			const msg = makeMsg();
			const member = makeMember();
			const nicks = new Map([[1, 'Alice']]);
			const lastRead = new Map([[1, 'msg-1']]);
			const existing = makeRoom('r1', {
				name: 'Old Name',
				chatType: 'Dm',
				messages: [msg],
				serverMessages: [{ id: 'srv1', content: { KillFeed: { target_id: 1, killer_id: 2 } }, created_at: '' }],
				systemEvents: [{ id: 'ev1', text: 'test', timestamp: '' }],
				members: [member],
				nicks,
				lastReadByUser: lastRead,
				connected: false,
				send: null,
			});

			const state = stateWith(existing);
			const newSend = vi.fn();
			const next = chatReducer(state, { type: 'ROOM_OPENED', roomId: 'r1', send: newSend });
			const room = next.get('r1')!;

			// Preserved
			expect(room.name).toBe('Old Name');
			expect(room.chatType).toBe('Dm');
			expect(room.messages).toEqual([msg]);
			expect(room.members).toEqual([member]);
			expect(room.nicks.get(1)).toBe('Alice');
			expect(room.lastReadByUser.get(1)).toBe('msg-1');

			// Reset on reconnect
			expect(room.connected).toBe(true);
			expect(room.send).toBe(newSend);
			expect(room.serverMessages).toEqual([]);
			expect(room.systemEvents).toEqual([]);
			expect(room.typingUsers.size).toBe(0);
			expect(room.onlineMembers.size).toBe(0);
		});

		it('returns a new Map reference', () => {
			const next = chatReducer(empty, { type: 'ROOM_OPENED', roomId: 'r1', send });
			expect(next).not.toBe(empty);
		});
	});

	// ── ROOM_CLOSED ──────────────────────────────────────────────────────

	describe('ROOM_CLOSED', () => {
		it('deletes GameLobby rooms entirely', () => {
			const state = stateWith(makeRoom('lobby', { chatType: 'GameLobby' }));
			const next = chatReducer(state, { type: 'ROOM_CLOSED', roomId: 'lobby' });
			expect(next.has('lobby')).toBe(false);
		});

		it('marks non-GameLobby rooms as disconnected', () => {
			const state = stateWith(makeRoom('r1', { chatType: 'Global', typingUsers: new Set([5]) }));
			const next = chatReducer(state, { type: 'ROOM_CLOSED', roomId: 'r1' });
			const room = next.get('r1')!;
			expect(room.connected).toBe(false);
			expect(room.send).toBeNull();
			expect(room.typingUsers.size).toBe(0);
		});

		it('returns same state for unknown room', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'ROOM_CLOSED', roomId: 'unknown' });
			expect(next).toBe(state);
		});
	});

	// ── RESET ────────────────────────────────────────────────────────────

	describe('RESET', () => {
		it('marks all rooms disconnected and clears typing', () => {
			const state = stateWith(
				makeRoom('r1', { chatType: 'Global', typingUsers: new Set([1, 2]) }),
				makeRoom('r2', { chatType: 'GameLobby', typingUsers: new Set([3]) }),
			);
			const next = chatReducer(state, { type: 'RESET' });

			expect(next.size).toBe(2);
			for (const room of next.values()) {
				expect(room.connected).toBe(false);
				expect(room.send).toBeNull();
				expect(room.typingUsers.size).toBe(0);
			}
		});

		it('preserves GameLobby rooms (server closes them individually)', () => {
			const state = stateWith(makeRoom('lobby', { chatType: 'GameLobby' }));
			const next = chatReducer(state, { type: 'RESET' });
			expect(next.has('lobby')).toBe(true);
		});

		it('returns a new Map reference', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'RESET' });
			expect(next).not.toBe(state);
		});
	});

	// ── MSG_LOG ──────────────────────────────────────────────────────────

	describe('MSG_LOG', () => {
		it('replaces the message list entirely', () => {
			const oldMsg = makeMsg({ id: 'old' });
			const newMsgs = [makeMsg({ id: 'new1' }), makeMsg({ id: 'new2' })];
			const state = stateWith(makeRoom('r1', { messages: [oldMsg] }));

			const next = chatReducer(state, { type: 'MSG_LOG', roomId: 'r1', messages: newMsgs });
			expect(next.get('r1')!.messages).toEqual(newMsgs);
			expect(next.get('r1')!.messages).not.toContain(oldMsg);
		});
	});

	// ── NEW_MSG ──────────────────────────────────────────────────────────

	describe('NEW_MSG', () => {
		it('appends message to the list', () => {
			const existing = makeMsg({ id: 'first' });
			const incoming = makeMsg({ id: 'second' });
			const state = stateWith(makeRoom('r1', { messages: [existing] }));

			const next = chatReducer(state, { type: 'NEW_MSG', roomId: 'r1', msg: incoming });
			expect(next.get('r1')!.messages).toHaveLength(2);
			expect(next.get('r1')!.messages[1]).toEqual(incoming);
		});

		it('clears typing indicator for the sender', () => {
			const state = stateWith(makeRoom('r1', { typingUsers: new Set([5, 10]) }));
			const msg = makeMsg({ sender_id: 5 });

			const next = chatReducer(state, { type: 'NEW_MSG', roomId: 'r1', msg });
			expect(next.get('r1')!.typingUsers.has(5)).toBe(false);
			expect(next.get('r1')!.typingUsers.has(10)).toBe(true);
		});
	});

	// ── IS_TYPING / CLEAR_TYPING ─────────────────────────────────────────

	describe('IS_TYPING', () => {
		it('adds user to typingUsers set', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'IS_TYPING', roomId: 'r1', userId: 7 });
			expect(next.get('r1')!.typingUsers.has(7)).toBe(true);
		});
	});

	describe('CLEAR_TYPING', () => {
		it('removes user from typingUsers set', () => {
			const state = stateWith(makeRoom('r1', { typingUsers: new Set([7]) }));
			const next = chatReducer(state, { type: 'CLEAR_TYPING', roomId: 'r1', userId: 7 });
			expect(next.get('r1')!.typingUsers.has(7)).toBe(false);
		});
	});

	// ── NICKS / NICK ─────────────────────────────────────────────────────

	describe('NICKS', () => {
		it('populates nick map from batch', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, {
				type: 'NICKS',
				roomId: 'r1',
				nicks: [[1, 'Alice'], [2, 'Bob']],
			});
			expect(next.get('r1')!.nicks.get(1)).toBe('Alice');
			expect(next.get('r1')!.nicks.get(2)).toBe('Bob');
		});

		it('merges with existing nicks (does not replace)', () => {
			const nicks = new Map([[1, 'Alice']]);
			const state = stateWith(makeRoom('r1', { nicks }));
			const next = chatReducer(state, {
				type: 'NICKS',
				roomId: 'r1',
				nicks: [[2, 'Bob']],
			});
			expect(next.get('r1')!.nicks.get(1)).toBe('Alice');
			expect(next.get('r1')!.nicks.get(2)).toBe('Bob');
		});
	});

	describe('NICK', () => {
		it('upserts a single nickname', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'NICK', roomId: 'r1', userId: 3, nickname: 'Charlie' });
			expect(next.get('r1')!.nicks.get(3)).toBe('Charlie');
		});
	});

	// ── MEMBERS ──────────────────────────────────────────────────────────

	describe('MEMBERS', () => {
		it('replaces member list and online set', () => {
			const members = [makeMember({ user_id: 1 }), makeMember({ user_id: 2 })];
			const state = stateWith(makeRoom('r1'));

			const next = chatReducer(state, {
				type: 'MEMBERS',
				roomId: 'r1',
				members,
				online: [1],
			});
			expect(next.get('r1')!.members).toEqual(members);
			expect(next.get('r1')!.onlineMembers.has(1)).toBe(true);
			expect(next.get('r1')!.onlineMembers.has(2)).toBe(false);
		});
	});

	// ── MEMBER_ADDED / MEMBER_REMOVED ────────────────────────────────────

	describe('MEMBER_ADDED', () => {
		it('appends member and creates system event', () => {
			const nicks = new Map([[5, 'Eve']]);
			const state = stateWith(makeRoom('r1', { members: [], nicks }));
			const member = makeMember({ user_id: 5 });

			const next = chatReducer(state, { type: 'MEMBER_ADDED', roomId: 'r1', member });
			expect(next.get('r1')!.members).toHaveLength(1);
			expect(next.get('r1')!.members![0].user_id).toBe(5);
			expect(next.get('r1')!.systemEvents).toHaveLength(1);
			expect(next.get('r1')!.systemEvents[0].text).toBe('Eve joined');
		});

		it('uses fallback nick when nickname is unknown', () => {
			const state = stateWith(makeRoom('r1', { members: [] }));
			const member = makeMember({ user_id: 99 });

			const next = chatReducer(state, { type: 'MEMBER_ADDED', roomId: 'r1', member });
			expect(next.get('r1')!.systemEvents[0].text).toBe('#99 joined');
		});
	});

	describe('MEMBER_REMOVED', () => {
		it('removes member and shows "left" for voluntary leave', () => {
			const members = [makeMember({ user_id: 5 })];
			const nicks = new Map([[5, 'Eve']]);
			const state = stateWith(makeRoom('r1', { members, nicks }));

			const next = chatReducer(state, {
				type: 'MEMBER_REMOVED',
				roomId: 'r1',
				userId: 5,
				actorId: 5,
			});
			expect(next.get('r1')!.members).toHaveLength(0);
			expect(next.get('r1')!.systemEvents[0].text).toBe('Eve left');
		});

		it('shows "was removed" when actor differs', () => {
			const members = [makeMember({ user_id: 5 })];
			const nicks = new Map([[5, 'Eve']]);
			const state = stateWith(makeRoom('r1', { members, nicks }));

			const next = chatReducer(state, {
				type: 'MEMBER_REMOVED',
				roomId: 'r1',
				userId: 5,
				actorId: 1,
			});
			expect(next.get('r1')!.systemEvents[0].text).toBe('Eve was removed');
		});
	});

	// ── MEMBER_CONNECTED / MEMBER_DISCONNECTED ───────────────────────────

	describe('MEMBER_CONNECTED', () => {
		it('adds user to onlineMembers set', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'MEMBER_CONNECTED', roomId: 'r1', userId: 3 });
			expect(next.get('r1')!.onlineMembers.has(3)).toBe(true);
		});
	});

	describe('MEMBER_DISCONNECTED', () => {
		it('removes user from onlineMembers set', () => {
			const state = stateWith(makeRoom('r1', { onlineMembers: new Set([3]) }));
			const next = chatReducer(state, { type: 'MEMBER_DISCONNECTED', roomId: 'r1', userId: 3 });
			expect(next.get('r1')!.onlineMembers.has(3)).toBe(false);
		});
	});

	// ── CHAT_TYPE / CHAT_NAME ────────────────────────────────────────────

	describe('CHAT_TYPE', () => {
		it('sets the room type', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'CHAT_TYPE', roomId: 'r1', chatType: 'Global' });
			expect(next.get('r1')!.chatType).toBe('Global');
		});
	});

	describe('CHAT_NAME', () => {
		it('sets the room name', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'CHAT_NAME', roomId: 'r1', name: 'Study Group' });
			expect(next.get('r1')!.name).toBe('Study Group');
		});
	});

	// ── NEW_SERVER_MSG ───────────────────────────────────────────────────

	describe('NEW_SERVER_MSG', () => {
		it('appends to serverMessages', () => {
			const state = stateWith(makeRoom('r1'));
			const serverMsg: ServerChatMessage = {
				id: 'srv1',
				content: { KillFeed: { target_id: 2, killer_id: 1 } },
				created_at: new Date().toISOString(),
			};
			const next = chatReducer(state, { type: 'NEW_SERVER_MSG', roomId: 'r1', msg: serverMsg });
			expect(next.get('r1')!.serverMessages).toHaveLength(1);
			expect(next.get('r1')!.serverMessages[0]).toEqual(serverMsg);
		});
	});

	// ── READ_TEXT ─────────────────────────────────────────────────────────

	describe('READ_TEXT', () => {
		it('updates lastReadByUser map', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, {
				type: 'READ_TEXT',
				roomId: 'r1',
				userId: 2,
				messageId: 'msg-42',
			});
			expect(next.get('r1')!.lastReadByUser.get(2)).toBe('msg-42');
		});

		it('overwrites previous read position', () => {
			const lastRead = new Map([[2, 'msg-10']]);
			const state = stateWith(makeRoom('r1', { lastReadByUser: lastRead }));
			const next = chatReducer(state, {
				type: 'READ_TEXT',
				roomId: 'r1',
				userId: 2,
				messageId: 'msg-20',
			});
			expect(next.get('r1')!.lastReadByUser.get(2)).toBe('msg-20');
		});
	});

	// ── Unknown room / unknown action ────────────────────────────────────

	describe('edge cases', () => {
		it('returns same state for actions on unknown rooms', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'NEW_MSG', roomId: 'unknown', msg: makeMsg() });
			expect(next).toBe(state);
		});

		it('returns same state for unknown action type', () => {
			const state = stateWith(makeRoom('r1'));
			// @ts-expect-error — testing unknown action passthrough
			const next = chatReducer(state, { type: 'BOGUS_ACTION' });
			expect(next).toBe(state);
		});
	});

	// ── Immutability ─────────────────────────────────────────────────────

	describe('immutability', () => {
		it('returns a new Map reference on mutation', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'CHAT_NAME', roomId: 'r1', name: 'X' });
			expect(next).not.toBe(state);
		});

		it('returns a new room object on mutation', () => {
			const state = stateWith(makeRoom('r1'));
			const next = chatReducer(state, { type: 'CHAT_NAME', roomId: 'r1', name: 'X' });
			expect(next.get('r1')).not.toBe(state.get('r1'));
		});

		it('does not mutate the original typingUsers set', () => {
			const original = new Set([1]);
			const state = stateWith(makeRoom('r1', { typingUsers: original }));
			chatReducer(state, { type: 'IS_TYPING', roomId: 'r1', userId: 2 });
			expect(original.size).toBe(1); // unchanged
		});

		it('does not mutate the original nicks map', () => {
			const original = new Map([[1, 'Alice']]);
			const state = stateWith(makeRoom('r1', { nicks: original }));
			chatReducer(state, { type: 'NICK', roomId: 'r1', userId: 2, nickname: 'Bob' });
			expect(original.size).toBe(1); // unchanged
		});
	});
});
