/*
 * Username — deterministic colored user handle with optional context menu.
 *
 * In collapsed mode (interactive=false): plain colored span, no interactivity.
 * In expanded mode (interactive=true): cursor-pointer, hover underline, click opens menu.
 * For self (isSelf=true): always shows "You" in stone-400 with no menu.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat } from '../../contexts/ChatContext';

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
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuProps {
	userId: number;
	nickname: string;
	onClose: () => void;
}

function UsernameContextMenu({ userId, nickname, onClose }: ContextMenuProps) {
	const { preferences, updatePreferences } = useChat();
	const menuRef = useRef<HTMLDivElement>(null);
	const isBlocked = preferences.blockedUsers.includes(userId);

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

	function handleBlockToggle() {
		if (isBlocked) {
			updatePreferences({
				blockedUsers: preferences.blockedUsers.filter((id) => id !== userId),
			});
		} else {
			updatePreferences({
				blockedUsers: [...preferences.blockedUsers, userId],
			});
		}
		onClose();
	}

	return (
		<div
			ref={menuRef}
			role="menu"
			aria-label={`Options for ${nickname}`}
			className="absolute bottom-full left-0 mb-1 z-50 min-w-[10rem] bg-stone-800 border border-stone-700 rounded shadow-xl text-sm"
		>
			{/* Show Profile (stub) */}
			<button
				role="menuitem"
				className="w-full text-left px-3 py-1.5 text-stone-400 cursor-not-allowed opacity-60"
				disabled
				aria-disabled="true"
			>
				Show Profile
			</button>
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

			{/* Friend Request (stub) */}
			<button
				role="menuitem"
				className="w-full text-left px-3 py-1.5 text-stone-400 cursor-not-allowed opacity-60"
				disabled
				aria-disabled="true"
			>
				Friend Request
			</button>
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

			{/* Block / Unblock */}
			<button
				role="menuitem"
				onClick={handleBlockToggle}
				className={`w-full text-left px-3 py-1.5 transition-colors ${
					isBlocked
						? 'text-success-light hover:bg-stone-700'
						: 'text-danger-light hover:bg-stone-700'
				}`}
			>
				{isBlocked ? 'Unblock' : 'Block'}
			</button>
		</div>
	);
}

// ─── Username component ────────────────────────────────────────────────────────

export default function Username({ userId, nickname, isSelf, interactive }: UsernameProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const closeMenu = useCallback(() => setMenuOpen(false), []);

	if (isSelf) {
		return <span className="text-stone-400">You</span>;
	}

	const color = getUserColor(userId);

	if (!interactive) {
		return <span className={color}>{nickname}</span>;
	}

	return (
		<span className="relative inline-block">
			<button
				className={`${color} hover:underline cursor-pointer bg-transparent border-0 p-0 font-inherit text-inherit`}
				onClick={() => setMenuOpen((prev) => !prev)}
				aria-label={`Options for ${nickname}`}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
			>
				{nickname}
			</button>
			{menuOpen && (
				<UsernameContextMenu userId={userId} nickname={nickname} onClose={closeMenu} />
			)}
		</span>
	);
}
