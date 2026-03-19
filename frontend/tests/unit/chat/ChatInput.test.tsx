import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatInput from '../../../src/components/chat/ChatInput';

// ─── Mock ChatContext ────────────────────────────────────────────────────────

const mockSendMessage = vi.fn();
const mockSendTypingIndicator = vi.fn();
const mockSetChatOpen = vi.fn();
const mockUpdatePreferences = vi.fn();

vi.mock('../../../src/contexts/ChatContext', () => ({
	useChat: vi.fn(() => ({
		activeRoomId: 'room-1',
		sendMessage: mockSendMessage,
		sendTypingIndicator: mockSendTypingIndicator,
		chatOpen: true,
		setChatOpen: mockSetChatOpen,
		updatePreferences: mockUpdatePreferences,
	})),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderInput(overrides: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
	const inputRef = { current: null } as React.RefObject<HTMLInputElement | null>;
	const defaults = {
		inputRef,
		onNavigateTab: vi.fn(),
		onScrollMessages: vi.fn(),
		maxLength: 512,
		...overrides,
	};
	return { ...render(<ChatInput {...defaults} />), props: defaults };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ChatInput', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ── Rendering ────────────────────────────────────────────────────────

	describe('rendering', () => {
		it('renders input with placeholder', () => {
			renderInput();
			expect(screen.getByPlaceholderText('_')).toBeInTheDocument();
		});

		it('has correct aria attributes', () => {
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });
			expect(input).toHaveAttribute('aria-autocomplete', 'list');
			expect(input).toHaveAttribute('aria-expanded', 'false');
			expect(input).not.toHaveAttribute('aria-controls');
		});
	});

	// ── Sending messages ─────────────────────────────────────────────────

	describe('sending messages', () => {
		it('sends message on Enter and clears input', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, 'hello world');
			await user.keyboard('{Enter}');

			expect(mockSendMessage).toHaveBeenCalledWith('room-1', 'hello world');
			expect(input).toHaveValue('');
		});

		it('does not send empty messages', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.click(input);
			await user.keyboard('{Enter}');

			expect(mockSendMessage).not.toHaveBeenCalled();
		});

		it('trims whitespace before sending', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '   hi   ');
			await user.keyboard('{Enter}');

			expect(mockSendMessage).toHaveBeenCalledWith('room-1', 'hi');
		});
	});

	// ── Typing indicator ─────────────────────────────────────────────────

	describe('typing indicator', () => {
		it('sends typing indicator for normal text', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, 'h');
			expect(mockSendTypingIndicator).toHaveBeenCalledWith('room-1');
		});

		it('does NOT send typing indicator for command input', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '/global_off');
			expect(mockSendTypingIndicator).not.toHaveBeenCalled();
		});
	});

	// ── Command handling ─────────────────────────────────────────────────

	describe('commands', () => {
		it('consumes /global_off and shows feedback', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			// Type command + trailing space so autocomplete closes (no exact prefix match).
			// handleSend trims whitespace, so the command still parses correctly.
			await user.type(input, '/global_off ');
			await user.keyboard('{Enter}');

			expect(mockSendMessage).not.toHaveBeenCalled();
			expect(mockUpdatePreferences).toHaveBeenCalledWith({ globalEnabled: false });
			expect(screen.getByText('Global chat hidden.')).toBeInTheDocument();
			expect(input).toHaveValue('');
		});

		it('consumes unknown /commands without sending to server', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '/foobar');
			await user.keyboard('{Enter}');

			expect(mockSendMessage).not.toHaveBeenCalled();
			expect(screen.getByText('Unknown command: /foobar')).toBeInTheDocument();
		});
	});

	// ── Keyboard navigation ──────────────────────────────────────────────

	describe('keyboard navigation', () => {
		it('Escape closes chat and blurs input', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });
			await user.click(input);

			fireEvent.keyDown(input, { key: 'Escape' });

			expect(mockSetChatOpen).toHaveBeenCalledWith(false);
		});

		it('ArrowLeft navigates to prev tab when input is empty', async () => {
			const onNavigateTab = vi.fn();
			const user = userEvent.setup();
			renderInput({ onNavigateTab });
			const input = screen.getByRole('textbox', { name: 'Chat message' });
			await user.click(input);

			fireEvent.keyDown(input, { key: 'ArrowLeft' });
			expect(onNavigateTab).toHaveBeenCalledWith('prev');
		});

		it('ArrowRight navigates to next tab when input is empty', async () => {
			const onNavigateTab = vi.fn();
			const user = userEvent.setup();
			renderInput({ onNavigateTab });
			const input = screen.getByRole('textbox', { name: 'Chat message' });
			await user.click(input);

			fireEvent.keyDown(input, { key: 'ArrowRight' });
			expect(onNavigateTab).toHaveBeenCalledWith('next');
		});

		it('ArrowUp scrolls messages when input is empty', async () => {
			const onScrollMessages = vi.fn();
			const user = userEvent.setup();
			renderInput({ onScrollMessages });
			const input = screen.getByRole('textbox', { name: 'Chat message' });
			await user.click(input);

			fireEvent.keyDown(input, { key: 'ArrowUp' });
			expect(onScrollMessages).toHaveBeenCalledWith('up');
		});

		it('does not navigate tabs when input has text', async () => {
			const onNavigateTab = vi.fn();
			const user = userEvent.setup();
			renderInput({ onNavigateTab });
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, 'some text');
			fireEvent.keyDown(input, { key: 'ArrowLeft' });
			fireEvent.keyDown(input, { key: 'ArrowRight' });

			expect(onNavigateTab).not.toHaveBeenCalled();
		});
	});

	// ── Autocomplete ─────────────────────────────────────────────────────

	describe('autocomplete', () => {
		it('shows suggestions when typing / prefix', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '/g');
			expect(screen.getByRole('listbox', { name: 'Command suggestions' })).toBeInTheDocument();
			expect(screen.getByRole('option', { name: /global_off/ })).toBeInTheDocument();
			expect(screen.getByRole('option', { name: /global_on/ })).toBeInTheDocument();
		});

		it('sets aria-controls when autocomplete is open', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '/g');
			expect(input).toHaveAttribute('aria-controls', 'chat-autocomplete-listbox');
			expect(input).toHaveAttribute('aria-expanded', 'true');
		});

		it('removes aria-controls when autocomplete is closed', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '/g');
			expect(input).toHaveAttribute('aria-controls', 'chat-autocomplete-listbox');

			await user.clear(input);
			await user.type(input, 'hello');
			expect(input).not.toHaveAttribute('aria-controls');
			expect(input).toHaveAttribute('aria-expanded', 'false');
		});

		it('selects suggestion on Enter', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '/global_of');
			// "global_off" should be the only suggestion.
			await user.keyboard('{Enter}');

			// Should fill in the command with trailing space.
			expect(input).toHaveValue('/global_off ');
		});

		it('navigates suggestions with arrow keys', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '/g');
			const options = screen.getAllByRole('option');
			expect(options[0]).toHaveAttribute('aria-selected', 'true');

			fireEvent.keyDown(input, { key: 'ArrowDown' });
			expect(options[1]).toHaveAttribute('aria-selected', 'true');
			expect(options[0]).toHaveAttribute('aria-selected', 'false');
		});

		it('Escape clears input when autocomplete is open', async () => {
			const user = userEvent.setup();
			renderInput();
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, '/g');
			expect(screen.getByRole('listbox')).toBeInTheDocument();

			fireEvent.keyDown(input, { key: 'Escape' });
			expect(input).toHaveValue('');
			expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
		});
	});

	// ── Character counter ────────────────────────────────────────────────

	describe('character counter', () => {
		it('shows counter when near limit', async () => {
			const user = userEvent.setup();
			renderInput({ maxLength: 60 });
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			// Type enough to get within 50 chars of limit.
			await user.type(input, 'a'.repeat(15));
			expect(screen.getByText('45')).toBeInTheDocument();
		});

		it('does not show counter when far from limit', async () => {
			const user = userEvent.setup();
			renderInput({ maxLength: 512 });
			const input = screen.getByRole('textbox', { name: 'Chat message' });

			await user.type(input, 'hi');
			expect(screen.queryByLabelText(/characters remaining/)).not.toBeInTheDocument();
		});
	});
});
