/*
 * ChatInput — text input with command autocomplete.
 *
 * Always visible (placeholder="_"). Clicking or focusing opens chat.
 * stopPropagation on all keydown events prevents Babylon.js from capturing keys.
 *
 * Arrow keys: navigate tabs (Left/Right) or scroll messages (Up/Down)
 * when the input is empty and chat is open.
 * Command autocomplete: shown when value starts with '/'.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { useChat } from '../../contexts/ChatContext';
import { COMMAND_NAMES, handleCommand } from '../../chat/commands';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ChatInputProps {
	inputRef: React.RefObject<HTMLInputElement | null>;
	onNavigateTab: (dir: 'prev' | 'next') => void;
	onScrollMessages: (dir: 'up' | 'down') => void;
	maxLength: number;
}

// ─── Autocomplete popup ───────────────────────────────────────────────────────

interface AutocompleteProps {
	suggestions: string[];
	activeIndex: number;
	onSelect: (name: string) => void;
}

function AutocompletePopup({ suggestions, activeIndex, onSelect }: AutocompleteProps) {
	if (suggestions.length === 0) return null;
	return (
		<div
			id="chat-autocomplete-listbox"
			role="listbox"
			aria-label="Command suggestions"
			className="absolute bottom-full left-0 w-full mb-1 bg-stone-800 border border-stone-700 rounded shadow-xl overflow-hidden animate-chat-enter"
		>
			{suggestions.map((name, idx) => (
				<button
					key={name}
					role="option"
					aria-selected={idx === activeIndex}
					onMouseDown={(e) => {
						e.preventDefault(); // prevent input blur
						onSelect(name);
					}}
					className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
						idx === activeIndex
							? 'bg-gold-400/20 text-gold-300'
							: 'text-stone-300 hover:bg-stone-700'
					}`}
				>
					<span className="text-stone-500">/</span>
					{name}
				</button>
			))}
		</div>
	);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ChatInput({
	inputRef,
	onNavigateTab,
	onScrollMessages,
	maxLength,
}: ChatInputProps) {
	const {
		activeRoomId,
		sendMessage,
		sendTypingIndicator,
		chatOpen,
		setChatOpen,
		updatePreferences,
	} = useChat();
	const [value, setValue] = useState('');
	const [feedback, setFeedback] = useState<string | null>(null);
	const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Command autocomplete — derived, not stateful.
	const [autocompleteIndex, setAutocompleteIndex] = useState(0);

	const suggestions = useMemo(
		() =>
			value.startsWith('/') && chatOpen
				? COMMAND_NAMES.filter((name) => name.startsWith(value.slice(1))).slice(0, 5)
				: [],
		[value, chatOpen],
	);

	const autocompleteOpen = suggestions.length > 0;

	// Cleanup feedback timer on unmount
	useEffect(() => {
		return () => {
			if (feedbackTimerRef.current !== null) {
				clearTimeout(feedbackTimerRef.current);
			}
		};
	}, []);

	function showFeedback(text: string) {
		setFeedback(text);
		if (feedbackTimerRef.current !== null) clearTimeout(feedbackTimerRef.current);
		feedbackTimerRef.current = setTimeout(() => {
			setFeedback(null);
			feedbackTimerRef.current = null;
		}, 3_000);
	}

	function handleSend() {
		const text = value.trim();
		if (!text || !activeRoomId) {
			setValue('');
			return;
		}

		// Try to parse as command first.
		const result = handleCommand(text, { updatePreferences });
		if (result.consumed) {
			if (result.feedback) showFeedback(result.feedback);
			setValue('');
			return;
		}

		// Normal message.
		sendMessage(activeRoomId, text);
		setValue('');
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		// Always stop propagation — prevent Babylon.js from capturing keys.
		e.stopPropagation();

		// Handle autocomplete navigation when popup is open.
		if (autocompleteOpen && suggestions.length > 0) {
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				setAutocompleteIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
				return;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setAutocompleteIndex((i) => (i >= suggestions.length - 1 ? 0 : i + 1));
				return;
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				selectSuggestion(suggestions[autocompleteIndex]);
				return;
			}
			if (e.key === 'Escape') {
				// Clear the `/` prefix to close autocomplete.
				setValue('');
				return;
			}
		}

		// Regular key handling.
		if (e.key === 'Enter') {
			e.preventDefault();
			handleSend();
			return;
		}

		if (e.key === 'Escape') {
			setChatOpen(false);
			(e.target as HTMLInputElement).blur();
			return;
		}

		if (!chatOpen) return;

		if (e.key === 'ArrowLeft' && value === '') {
			onNavigateTab('prev');
			return;
		}
		if (e.key === 'ArrowRight' && value === '') {
			onNavigateTab('next');
			return;
		}
		if (e.key === 'ArrowUp' && value === '') {
			e.preventDefault();
			onScrollMessages('up');
			return;
		}
		if (e.key === 'ArrowDown' && value === '') {
			e.preventDefault();
			onScrollMessages('down');
			return;
		}
	}

	function selectSuggestion(name: string) {
		setValue(`/${name} `);
		setAutocompleteIndex(0);
		inputRef.current?.focus();
	}

	function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
		const text = e.target.value;
		setValue(text);
		setAutocompleteIndex(0);
		// Send typing indicator for normal text only — commands are local-only.
		if (activeRoomId && text.length > 0 && !text.startsWith('/')) {
			sendTypingIndicator(activeRoomId);
		}
	}

	const remaining = maxLength - value.length;
	const showCounter = remaining <= 50;
	const counterRed = remaining < 10;

	return (
		<div className="relative">
			{/* Feedback message */}
			{feedback && (
				<div className="px-2 py-0.5 text-[11px] text-stone-400 italic animate-chat-enter">
					{feedback}
				</div>
			)}

			{/* Autocomplete popup */}
			{autocompleteOpen && (
				<AutocompletePopup
					suggestions={suggestions}
					activeIndex={autocompleteIndex}
					onSelect={selectSuggestion}
				/>
			)}

			{/* Input row */}
			<div className="relative flex items-center">
				<input
					ref={inputRef}
					type="text"
					value={value}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					onFocus={() => {
						if (!chatOpen) setChatOpen(true);
					}}
					placeholder="_"
					maxLength={maxLength}
					aria-label="Chat message"
					aria-autocomplete="list"
					aria-controls={autocompleteOpen ? 'chat-autocomplete-listbox' : undefined}
					aria-expanded={autocompleteOpen}
					className="w-full bg-transparent text-stone-200 placeholder-stone-600 text-xs px-2 py-1.5 outline-none"
				/>
				{showCounter && (
					<span
						aria-live="polite"
						aria-label={`${remaining} characters remaining`}
						className={`text-[10px] pr-2 shrink-0 ${counterRed ? 'text-danger-light' : 'text-stone-500'}`}
					>
						{remaining}
					</span>
				)}
			</div>
		</div>
	);
}
