/*
 * ChatMessage — renders a single DisplayItem in the chat list.
 *
 * Handles three kinds: user message, server event (KillFeed), system event (join/leave).
 * All content is rendered as React text — never dangerouslySetInnerHTML.
 */

import Username from '../ui/Username';
import type { DisplayItem } from '../../chat/types';

interface ChatMessageProps {
	item: DisplayItem;
	currentUserId: number;
	/** Room tag prefix shown in collapsed mode: "[G]", "[L]", "[@Alice]" */
	roomTag?: string;
	/** Applies text-shadow for readability on the game canvas. */
	onGamePage: boolean;
	/** When true, Username renders with context menu. */
	interactive: boolean;
}

export default function ChatMessage({
	item,
	currentUserId,
	roomTag,
	onGamePage,
	interactive,
}: ChatMessageProps) {
	const shadowClass = onGamePage ? '[text-shadow:_0_1px_2px_rgb(0_0_0_/_90%)]' : '';

	if (item.kind === 'system') {
		return (
			<div className={`text-stone-500 italic text-[11px] leading-tight ${shadowClass}`}>
				{roomTag && <span className="text-stone-500 text-[10px] mr-1">{roomTag}</span>}
				{item.event.text}
			</div>
		);
	}

	if (item.kind === 'server') {
		return (
			<div className={`text-info-light italic text-[11px] leading-tight ${shadowClass}`}>
				{roomTag && <span className="text-stone-500 text-[10px] mr-1">{roomTag}</span>}⚔{' '}
				{item.text}
			</div>
		);
	}

	// kind === 'msg'
	return (
		<div className={`text-xs leading-tight ${shadowClass}`}>
			{roomTag && <span className="text-stone-500 text-[10px] mr-1">{roomTag}</span>}
			<Username
				userId={item.msg.sender_id}
				nickname={item.nickname}
				isSelf={item.isSelf || item.msg.sender_id === currentUserId}
				interactive={interactive}
			/>
			<span className="text-stone-400 mx-0.5">:</span>
			<span className="text-stone-200 break-words">{item.msg.content}</span>
		</div>
	);
}
