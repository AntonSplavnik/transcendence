/*
 * ChatTabBar — room tabs with overflow chevrons and unread indicators.
 *
 * Tab overflow: a visible window of tabs is controlled by visibleStartIndex.
 * < and > chevrons shift the window by one tab per click.
 * The active tab auto-scrolls into the visible window when activeRoomId changes.
 *
 * Unread detection: lastViewedAt ref tracks when each room was last viewed.
 * A room is "unread" if its newest message is newer than the last viewed time.
 */

import { useState } from 'react';
import { useChat } from '../../contexts/ChatContext';

// How many tabs to show at once before overflow kicks in.
const MAX_VISIBLE_TABS = 4;

function truncateLabel(label: string, max = 7): string {
	return label.length > max ? label.slice(0, max) + '…' : label;
}

function getRoomLabel(
	roomId: string,
	room: {
		chatType: string | null;
		name: string | null;
		members: { user_id: number }[] | null;
		nicks: Map<number, string>;
	},
	currentUserId: number,
): string {
	void roomId;
	if (room.chatType === 'Global') return 'Global';
	if (room.chatType === 'GameLobby') return room.name ?? 'Lobby';
	if (room.chatType === 'Dm') {
		const other = room.members?.find((m) => m.user_id !== currentUserId);
		if (other) {
			const nick = room.nicks.get(other.user_id);
			return nick ? `@${nick}` : `@#${other.user_id}`;
		}
		return 'DM';
	}
	return room.name ?? 'Room';
}

interface ChatTabBarProps {
	currentUserId: number;
}

export default function ChatTabBar({ currentUserId }: ChatTabBarProps) {
	const { rooms, orderedRoomIds, activeRoomId, setActiveRoomId } = useChat();
	const [visibleStartIndex, setVisibleStartIndex] = useState(0);

	// Track the last message ID seen per room for unread detection.
	// Updated on tab click — only state, no refs during render.
	const [lastSeenMsgId, setLastSeenMsgId] = useState<Map<string, string>>(() => new Map());

	// Auto-scroll active tab into visible window.
	// Uses React's "setState during render" pattern — one DOM commit, no effect cascade.
	const [prevActiveRoomId, setPrevActiveRoomId] = useState(activeRoomId);
	if (activeRoomId !== prevActiveRoomId) {
		setPrevActiveRoomId(activeRoomId);
		if (activeRoomId !== null) {
			const idx = orderedRoomIds.indexOf(activeRoomId);
			if (idx >= 0 && idx < visibleStartIndex) {
				setVisibleStartIndex(idx);
			} else if (idx >= visibleStartIndex + MAX_VISIBLE_TABS) {
				setVisibleStartIndex(idx - MAX_VISIBLE_TABS + 1);
			}
		}
	}

	const visibleTabs = orderedRoomIds.slice(
		visibleStartIndex,
		visibleStartIndex + MAX_VISIBLE_TABS,
	);
	const showLeft = visibleStartIndex > 0;
	const showRight = visibleStartIndex + MAX_VISIBLE_TABS < orderedRoomIds.length;

	function hasUnread(roomId: string): boolean {
		if (roomId === activeRoomId) return false;
		const room = rooms.get(roomId);
		if (!room) return false;
		const seenId = lastSeenMsgId.get(roomId);
		if (seenId === undefined) return false; // never viewed = no dot
		const lastMsg = room.messages[room.messages.length - 1];
		if (!lastMsg) return false;
		return lastMsg.id !== seenId;
	}

	if (orderedRoomIds.length === 0) return null;

	return (
		<div
			className="flex items-center border-b border-stone-700/60 select-none"
			role="tablist"
			aria-label="Chat rooms"
		>
			{/* Left chevron */}
			{showLeft ? (
				<button
					onClick={() => setVisibleStartIndex((i) => Math.max(0, i - 1))}
					className="px-1.5 py-1 text-stone-400 hover:text-stone-200 transition-colors shrink-0"
					aria-label="Show previous tabs"
				>
					‹
				</button>
			) : (
				<div className="w-5 shrink-0" />
			)}

			{/* Tabs */}
			<div className="flex flex-1 overflow-hidden">
				{visibleTabs.map((roomId) => {
					const room = rooms.get(roomId);
					if (!room) return null;
					const isActive = roomId === activeRoomId;
					const label = truncateLabel(getRoomLabel(roomId, room, currentUserId));
					const unread = hasUnread(roomId);

					return (
						<button
							key={roomId}
							role="tab"
							aria-selected={isActive}
							aria-label={`${label} chat room${unread ? ', unread messages' : ''}`}
							onClick={() => {
								const lastMsg = room.messages[room.messages.length - 1];
								if (lastMsg) {
									setLastSeenMsgId((prev) => {
										const next = new Map(prev);
										next.set(roomId, lastMsg.id);
										return next;
									});
								}
								setActiveRoomId(roomId);
							}}
							className={`relative flex items-center gap-1 px-2.5 py-1 text-xs transition-colors whitespace-nowrap ${
								isActive
									? 'text-gold-300 border-b-2 border-gold-400 -mb-px'
									: 'text-stone-400 hover:text-stone-200 border-b-2 border-transparent'
							}`}
						>
							{label}
							{unread && (
								<span
									aria-hidden="true"
									className="w-1.5 h-1.5 rounded-full bg-gold-400 shrink-0"
								/>
							)}
						</button>
					);
				})}
			</div>

			{/* Right chevron */}
			{showRight ? (
				<button
					onClick={() =>
						setVisibleStartIndex((i) =>
							Math.min(orderedRoomIds.length - MAX_VISIBLE_TABS, i + 1),
						)
					}
					className="px-1.5 py-1 text-stone-400 hover:text-stone-200 transition-colors shrink-0"
					aria-label="Show next tabs"
				>
					›
				</button>
			) : (
				<div className="w-5 shrink-0" />
			)}
		</div>
	);
}
