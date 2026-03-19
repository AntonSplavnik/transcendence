import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatErrorToast from '../../../src/components/chat/ChatErrorToast';

// ─── Mock ChatContext ────────────────────────────────────────────────────────

let mockChatError: { roomId: string; error: string } | null = null;

vi.mock('../../../src/contexts/ChatContext', () => ({
	useChat: vi.fn(() => ({
		chatError: mockChatError,
	})),
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ChatErrorToast', () => {
	it('renders nothing when no error', () => {
		mockChatError = null;
		const { container } = render(<ChatErrorToast />);
		expect(container.firstChild).toBeNull();
	});

	it('renders "Slow down!" for RateLimitExceeded', () => {
		mockChatError = { roomId: 'r1', error: 'RateLimitExceeded' };
		render(<ChatErrorToast />);
		expect(screen.getByRole('alert')).toHaveTextContent('Slow down!');
	});

	it('renders "Message too long." for MessageTooLong', () => {
		mockChatError = { roomId: 'r1', error: 'MessageTooLong' };
		render(<ChatErrorToast />);
		expect(screen.getByRole('alert')).toHaveTextContent('Message too long.');
	});

	it('renders nothing for unknown error types', () => {
		mockChatError = { roomId: 'r1', error: 'InvalidMessageId' };
		const { container } = render(<ChatErrorToast />);
		expect(container.firstChild).toBeNull();
	});

	it('has correct ARIA attributes', () => {
		mockChatError = { roomId: 'r1', error: 'RateLimitExceeded' };
		render(<ChatErrorToast />);
		const alert = screen.getByRole('alert');
		expect(alert).toHaveAttribute('aria-live', 'assertive');
	});
});
