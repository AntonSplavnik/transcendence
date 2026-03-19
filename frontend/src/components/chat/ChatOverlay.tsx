/*
 * ChatOverlay — the fixed bottom-left chat UI container.
 *
 * Manages the T-key toggle, page-aware background, and the overall
 * collapsed/expanded layout.
 *
 * pointer-events-none on the outer container; each interactive child
 * restores pointer-events-auto individually.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useChat } from '../../contexts/ChatContext';
import ChatTabBar from './ChatTabBar';
import ChatMessageList from './ChatMessageList';
import ChatInput from './ChatInput';
import ChatErrorToast from './ChatErrorToast';

export default function ChatOverlay() {
	const {
		preferences,
		chatOpen,
		setChatOpen,
		orderedRoomIds,
		activeRoomId,
		setActiveRoomId,
		rooms,
	} = useChat();
	const { user } = useAuth();
	const location = useLocation();

	const isGamePage = location.pathname === '/game';
	const inputRef = useRef<HTMLInputElement | null>(null);
	const messageListRef = useRef<HTMLDivElement | null>(null);

	// ── T-key toggle ──────────────────────────────────────────────────────────
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key !== 't' && e.key !== 'T') return;
			const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
			if (tag === 'input' || tag === 'textarea') return;
			e.preventDefault();
			setChatOpen(true);
			setTimeout(() => inputRef.current?.focus(), 0);
		}
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [setChatOpen]);

	// ── Tab navigation ────────────────────────────────────────────────────────
	const handleNavigateTab = useCallback(
		(dir: 'prev' | 'next') => {
			if (orderedRoomIds.length === 0) return;
			const currentIdx = activeRoomId ? orderedRoomIds.indexOf(activeRoomId) : -1;
			let nextIdx: number;
			if (dir === 'prev') {
				nextIdx = currentIdx <= 0 ? orderedRoomIds.length - 1 : currentIdx - 1;
			} else {
				nextIdx = currentIdx >= orderedRoomIds.length - 1 ? 0 : currentIdx + 1;
			}
			setActiveRoomId(orderedRoomIds[nextIdx]);
		},
		[orderedRoomIds, activeRoomId, setActiveRoomId],
	);

	// ── Message list scroll ───────────────────────────────────────────────────
	const handleScrollMessages = useCallback((dir: 'up' | 'down') => {
		const el = messageListRef.current;
		if (!el) return;
		el.scrollTop += dir === 'up' ? -48 : 48;
	}, []);

	// ── Active room max length ────────────────────────────────────────────────
	const activeRoom = activeRoomId ? rooms.get(activeRoomId) : null;
	const maxLength = activeRoom?.chatType === 'Global' ? 512 : 4096;

	// ── Background logic ──────────────────────────────────────────────────────
	const containerBg = isGamePage
		? chatOpen
			? 'bg-stone-950/60 border border-stone-700/40 rounded-tr-lg'
			: ''
		: 'bg-stone-900';

	// Render nothing when chat is globally hidden.
	// NOTE: All hooks are called above this line — do not add hooks below.
	if (!preferences.visible || !user) return null;

	return (
		<div
			className={`fixed bottom-0 left-0 z-40 w-[26rem] flex flex-col justify-end pointer-events-none ${containerBg}`}
			aria-label="Chat overlay"
			role="region"
		>
			{/* Tab bar — only when expanded and multiple rooms exist */}
			{chatOpen && orderedRoomIds.length > 1 && (
				<div className="pointer-events-auto">
					<ChatTabBar currentUserId={user.id} />
				</div>
			)}

			{/* Message list */}
			<ChatMessageList
				ref={messageListRef}
				collapsed={!chatOpen}
				currentUserId={user.id}
				onGamePage={isGamePage}
			/>

			{/* Error toast (above input) */}
			<div className="pointer-events-none px-1">
				<ChatErrorToast />
			</div>

			{/* Input — always visible, always interactive */}
			<div className="pointer-events-auto bg-stone-950/60 border border-stone-700/40 rounded mx-0 mb-0">
				<ChatInput
					inputRef={inputRef}
					onNavigateTab={handleNavigateTab}
					onScrollMessages={handleScrollMessages}
					maxLength={maxLength}
				/>
			</div>
		</div>
	);
}
