/*
 * ChatMessageList — renders the message area in both collapsed and expanded modes.
 *
 * Collapsed: merged feed of recent messages from all rooms. Each item has a
 * room tag prefix and fades out after 8s via CSS animation. New messages are
 * tracked via seenIdsRef so they only appear once. onAnimationEnd removes
 * them from the feed state.
 *
 * Expanded: scrollable list of the active room's messages + system events.
 * Auto-scrolls to bottom when near the bottom. Shows a top-fade gradient
 * when the user has scrolled up. Typing indicator shown below the list.
 */

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '../../contexts/ChatContext';
import type { DisplayItem } from '../../chat/types';
import ChatMessage from './ChatMessage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatKillFeed(killerId: number, targetId: number, nicks: Map<number, string>): string {
	const killer = nicks.get(killerId) ?? `#${killerId}`;
	const target = nicks.get(targetId) ?? `#${targetId}`;
	return `${killer} eliminated ${target}`;
}

function getDisplayTimestamp(item: DisplayItem): string {
	if (item.kind === 'msg') return item.msg.created_at;
	if (item.kind === 'server') return item.msg.created_at;
	return item.event.timestamp;
}

function getDisplayKey(item: DisplayItem): string {
	if (item.kind === 'msg') return item.msg.id;
	if (item.kind === 'server') return item.msg.id;
	return item.event.id;
}

function getRoomTag(chatType: string | null, name: string | null): string {
	if (chatType === 'Global') return '[G]';
	if (chatType === 'GameLobby') return '[L]';
	if (chatType === 'Dm') return name ? `[@${name}]` : '[DM]';
	return name ? `[${name.slice(0, 4)}]` : '[R]';
}

interface FeedItem {
	id: string;
	roomTag: string;
	item: DisplayItem;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ChatMessageListProps {
	collapsed: boolean;
	currentUserId: number;
	onGamePage: boolean;
}

const ChatMessageList = forwardRef<HTMLDivElement, ChatMessageListProps>(function ChatMessageList(
	{ collapsed, currentUserId, onGamePage },
	scrollRef,
) {
	const { rooms, orderedRoomIds, activeRoomId, preferences } = useChat();
	const [scrolledUp, setScrolledUp] = useState(false);

	// ── Collapsed feed state ──────────────────────────────────────────────
	const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
	const seenIdsRef = useRef<Set<string>>(new Set());

	// On mount, pre-populate seenIds so existing messages don't appear as "new".
	useEffect(() => {
		for (const room of rooms.values()) {
			for (const msg of room.messages) seenIdsRef.current.add(msg.id);
			for (const msg of room.serverMessages) seenIdsRef.current.add(msg.id);
			for (const ev of room.systemEvents) seenIdsRef.current.add(ev.id);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // Only on mount

	// Detect new items as rooms state updates.
	useEffect(() => {
		if (!collapsed) return;
		const newFeedItems: FeedItem[] = [];

		for (const roomId of orderedRoomIds) {
			const room = rooms.get(roomId);
			if (!room) continue;

			// Skip global if hidden.
			if (room.chatType === 'Global' && !preferences.globalEnabled) continue;

			const roomTag = getRoomTag(room.chatType, room.name);

			for (const msg of room.messages) {
				if (seenIdsRef.current.has(msg.id)) continue;
				if (preferences.blockedUsers.includes(msg.sender_id)) {
					seenIdsRef.current.add(msg.id);
					continue;
				}
				seenIdsRef.current.add(msg.id);
				const nickname = room.nicks.get(msg.sender_id) ?? `#${msg.sender_id}`;
				newFeedItems.push({
					id: msg.id,
					roomTag,
					item: {
						kind: 'msg',
						msg,
						nickname,
						isSelf: msg.sender_id === currentUserId,
					},
				});
			}

			for (const msg of room.serverMessages) {
				if (seenIdsRef.current.has(msg.id)) continue;
				seenIdsRef.current.add(msg.id);
				let text = '(server event)';
				if ('KillFeed' in msg.content) {
					text = formatKillFeed(
						msg.content.KillFeed.killer_id,
						msg.content.KillFeed.target_id,
						room.nicks,
					);
				}
				newFeedItems.push({
					id: msg.id,
					roomTag,
					item: { kind: 'server', msg, text },
				});
			}

			for (const ev of room.systemEvents) {
				if (seenIdsRef.current.has(ev.id)) continue;
				seenIdsRef.current.add(ev.id);
				newFeedItems.push({
					id: ev.id,
					roomTag,
					item: { kind: 'system', event: ev },
				});
			}
		}

		if (newFeedItems.length > 0) {
			setFeedItems((prev) => {
				const combined = [...prev, ...newFeedItems];
				// Keep last 7 visible at once.
				return combined.slice(-7);
			});
		}
	}, [rooms, orderedRoomIds, preferences, collapsed, currentUserId]);

	// ── Expanded: auto-scroll ────────────────────────────────────────────
	// No dependency array — runs after every render intentionally.
	// New messages, typing indicators, or layout shifts can all change scrollHeight.
	// The isNearBottom guard ensures we only scroll when the user is already at the bottom.
	const innerRef = scrollRef as React.RefObject<HTMLDivElement | null>;

	useEffect(() => {
		if (collapsed || !innerRef?.current) return;
		const el = innerRef.current;
		const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
		if (isNearBottom) {
			el.scrollTop = el.scrollHeight;
		}
	});

	// Track scroll position for top-fade.
	function handleScroll() {
		if (innerRef?.current) {
			setScrolledUp(innerRef.current.scrollTop > 0);
		}
	}

	// ── Compute expanded display items (memoized) ───────────────────────
	const activeRoom = activeRoomId ? rooms.get(activeRoomId) : null;

	const expandedItems = useMemo((): DisplayItem[] => {
		if (!activeRoom) return [];
		return [
			...activeRoom.messages
				.filter((msg) => !preferences.blockedUsers.includes(msg.sender_id))
				.map(
					(msg): DisplayItem => ({
						kind: 'msg',
						msg,
						nickname: activeRoom.nicks.get(msg.sender_id) ?? `#${msg.sender_id}`,
						isSelf: msg.sender_id === currentUserId,
					}),
				),
			...activeRoom.serverMessages.map((msg): DisplayItem => {
				let text = '(server event)';
				if ('KillFeed' in msg.content) {
					text = formatKillFeed(
						msg.content.KillFeed.killer_id,
						msg.content.KillFeed.target_id,
						activeRoom.nicks,
					);
				}
				return { kind: 'server', msg, text };
			}),
			...activeRoom.systemEvents.map((ev): DisplayItem => ({ kind: 'system', event: ev })),
		].sort((a, b) => getDisplayTimestamp(a).localeCompare(getDisplayTimestamp(b)));
	}, [activeRoom, preferences.blockedUsers, currentUserId]);

	// Typing indicator text.
	const typingNicks: string[] = activeRoom
		? [...activeRoom.typingUsers]
				.filter((id) => id !== currentUserId)
				.map((id) => activeRoom.nicks.get(id) ?? `#${id}`)
		: [];

	const typingText =
		typingNicks.length === 0
			? null
			: typingNicks.length === 1
				? `${typingNicks[0]} is typing…`
				: typingNicks.length <= 3
					? `${typingNicks.join(', ')} are typing…`
					: 'Several people are typing…';

	// ── Collapsed mode ────────────────────────────────────────────────────
	if (collapsed) {
		if (feedItems.length === 0) return null;
		return (
			<div className="pointer-events-none flex flex-col gap-0.5 px-2 pb-1">
				{feedItems.map((fi) => (
					<div
						key={fi.id}
						className="animate-chat-fade"
						onAnimationEnd={() => {
							setFeedItems((prev) => prev.filter((x) => x.id !== fi.id));
						}}
					>
						<ChatMessage
							item={fi.item}
							currentUserId={currentUserId}
							roomTag={fi.roomTag}
							onGamePage={onGamePage}
							interactive={false}
						/>
					</div>
				))}
			</div>
		);
	}

	// ── Expanded mode ─────────────────────────────────────────────────────
	return (
		<div className="relative flex flex-col">
			{/* Top fade gradient — signals scrollable history above */}
			{scrolledUp && (
				<div
					aria-hidden="true"
					className="absolute top-0 left-0 right-0 h-6 z-10 pointer-events-none"
					style={{
						background: 'linear-gradient(to bottom, rgba(14,14,16,0.6), transparent)',
					}}
				/>
			)}

			{/* Scrollable message area */}
			<div
				ref={innerRef as React.RefObject<HTMLDivElement>}
				onScroll={handleScroll}
				className="overflow-y-auto max-h-[50vh] flex flex-col gap-0.5 px-2 py-1 scrollbar-none"
			>
				{expandedItems.map((item) => (
					<ChatMessage
						key={getDisplayKey(item)}
						item={item}
						currentUserId={currentUserId}
						onGamePage={onGamePage}
						interactive={true}
					/>
				))}
			</div>

			{/* Typing indicator */}
			{typingText && (
				<div className="px-2 pb-0.5 text-stone-500 text-[11px] italic animate-chat-enter">
					{typingText}
				</div>
			)}
		</div>
	);
});

export default ChatMessageList;
