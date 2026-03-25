/*
 * Username — deterministic colored user handle with optional context menu.
 *
 * In collapsed mode (interactive=false): plain colored span, no interactivity.
 * In expanded mode (interactive=true): cursor-pointer, hover underline, click opens menu.
 * For self (isSelf=true): always shows "You" in stone-400 with no menu.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ─── Color palette ────────────────────────────────────────────────────────────

const USER_COLORS = [
	'text-gold-300',
	'text-info-light',
	'text-accent-coral',
	'text-warning-light',
	'text-success-light',
	'text-accent-teal',
] as const;

function getUserColor(userId: number): string {
	return USER_COLORS[userId % USER_COLORS.length];
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface UsernameProps {
	userId: number;
	nickname: string;
	isSelf: boolean;
	interactive: boolean;
	/** Whether to apply deterministic color. Defaults to true. Pass false for neutral lists like the friends drawer. */
	colored?: boolean;
	/** Whether this user is already a friend. Hides the Friend Request option. Defaults to false. */
	isFriend?: boolean;
	/** Called when the user clicks "Show Profile". If omitted, the button stays disabled. */
	onShowProfile?: () => void;
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
	userId: number;
	nickname: string;
	anchorRect: DOMRect;
	isFriend: boolean;
	onShowProfile?: () => void;
	onClose: () => void;
}

function UsernameContextMenu({
	userId: _userId,
	nickname,
	anchorRect,
	isFriend,
	onShowProfile,
	onClose,
}: ContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	// Position the menu above the anchor by default, flip below if not enough space
	const spaceAbove = anchorRect.top;
	const menuHeight = 220; // approximate
	const top = spaceAbove > menuHeight ? anchorRect.top - menuHeight : anchorRect.bottom + 4;
	const left = anchorRect.left;

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		function handleEscape(e: KeyboardEvent) {
			if (e.key === 'Escape') onClose();
		}
		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape);
		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape);
		};
	}, [onClose]);

	function handleCopyUsername() {
		navigator.clipboard.writeText(nickname).catch(() => {
			/* silently ignore clipboard errors */
		});
		onClose();
	}

	return createPortal(
		<div
			ref={menuRef}
			role="menu"
			aria-label={`Options for ${nickname}`}
			style={{ position: 'fixed', top, left }}
			className="z-[9999] min-w-[10rem] bg-stone-800 border border-stone-700 rounded shadow-xl text-sm"
		>
			{/* Show Profile */}
			{onShowProfile ? (
				<button
					role="menuitem"
					onClick={() => {
						onShowProfile();
						onClose();
					}}
					className="w-full text-left px-3 py-1.5 text-stone-200 hover:bg-stone-700 transition-colors"
				>
					Show Profile
				</button>
			) : (
				<button
					role="menuitem"
					disabled
					aria-disabled="true"
					className="w-full text-left px-3 py-1.5 text-stone-400 cursor-not-allowed opacity-60"
				>
					Show Profile
				</button>
			)}
			{/* Message (stub P2) */}
			<button
				role="menuitem"
				className="w-full text-left px-3 py-1.5 text-stone-400 cursor-not-allowed opacity-60"
				disabled
				aria-disabled="true"
			>
				Message
			</button>

			<div role="separator" className="border-t border-stone-700 my-0.5" />

			{/* Copy Username */}
			<button
				role="menuitem"
				onClick={handleCopyUsername}
				className="w-full text-left px-3 py-1.5 text-stone-200 hover:bg-stone-700 transition-colors"
			>
				Copy Username
			</button>

			<div role="separator" className="border-t border-stone-700 my-0.5" />

			{/* Friend Request (stub) — hidden if already friends */}
			{!isFriend && (
				<button
					role="menuitem"
					className="w-full text-left px-3 py-1.5 text-stone-400 cursor-not-allowed opacity-60"
					disabled
					aria-disabled="true"
				>
					Friend Request
				</button>
			)}
			{/* Invite to Game (stub) */}
			<button
				role="menuitem"
				className="w-full text-left px-3 py-1.5 text-stone-400 cursor-not-allowed opacity-60"
				disabled
				aria-disabled="true"
			>
				Invite to Game
			</button>

			<div role="separator" className="border-t border-stone-700 my-0.5" />

			{/* Block / Unblock (requires ChatContext — available once chat feature is merged) */}
			<button
				role="menuitem"
				disabled
				aria-disabled="true"
				className="w-full text-left px-3 py-1.5 text-stone-400 cursor-not-allowed opacity-60"
			>
				Block
			</button>
		</div>,
		document.body,
	);
}

// ─── Username component ────────────────────────────────────────────────────────

export default function Username({
	userId,
	nickname,
	isSelf,
	interactive,
	colored = true,
	isFriend = false,
	onShowProfile,
}: UsernameProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	if (isSelf) {
		return <span className="text-stone-400">You</span>;
	}

	const color = colored ? getUserColor(userId) : 'text-stone-100';

	if (!interactive) {
		return <span className={color}>{nickname}</span>;
	}

	function handleClick() {
		if (!menuOpen && buttonRef.current) {
			setAnchorRect(buttonRef.current.getBoundingClientRect());
		}
		setMenuOpen((prev) => !prev);
	}

	return (
		<span className="relative inline-block">
			<button
				ref={buttonRef}
				type="button"
				className={`${color} hover:underline cursor-pointer bg-transparent border-0 p-0 font-inherit text-inherit`}
				onClick={handleClick}
				aria-label={`Options for ${nickname}`}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
			>
				{nickname}
			</button>
			{menuOpen && anchorRect && (
				<UsernameContextMenu
					userId={userId}
					nickname={nickname}
					anchorRect={anchorRect}
					isFriend={isFriend}
					onShowProfile={onShowProfile}
					onClose={() => setMenuOpen(false)}
				/>
			)}
		</span>
	);
}
