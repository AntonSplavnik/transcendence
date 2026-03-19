import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatMessage from '../../../src/components/chat/ChatMessage';
import type { DisplayItem } from '../../../src/chat/types';

// Mock Username to isolate ChatMessage logic.
vi.mock('../../../src/components/ui/Username', () => ({
	default: ({ nickname, isSelf }: { nickname: string; isSelf: boolean }) => (
		<span data-testid="username">{isSelf ? 'You' : nickname}</span>
	),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMsg(content = 'hello', senderId = 1): DisplayItem {
	return {
		kind: 'msg',
		msg: { id: 'msg-1', sender_id: senderId, content, created_at: '2026-01-01T00:00:00Z' },
		nickname: 'Alice',
		isSelf: false,
	};
}

function makeServerItem(): DisplayItem {
	return {
		kind: 'server',
		msg: {
			id: 'srv-1',
			content: { KillFeed: { killer_id: 1, target_id: 2 } },
			created_at: '2026-01-01T00:00:00Z',
		},
		text: 'Alice eliminated Bob',
	};
}

function makeSystemItem(): DisplayItem {
	return {
		kind: 'system',
		event: { id: 'ev-1', text: 'Alice joined', timestamp: '2026-01-01T00:00:00Z' },
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ChatMessage', () => {
	// ── User messages ────────────────────────────────────────────────────

	describe('user messages', () => {
		it('renders nickname and content', () => {
			render(
				<ChatMessage item={makeMsg('hi')} currentUserId={99} onGamePage={false} interactive={true} />,
			);
			expect(screen.getByTestId('username')).toHaveTextContent('Alice');
			expect(screen.getByText('hi')).toBeInTheDocument();
		});

		it('renders room tag when provided', () => {
			render(
				<ChatMessage
					item={makeMsg('hi')}
					currentUserId={99}
					roomTag="[G]"
					onGamePage={false}
					interactive={true}
				/>,
			);
			expect(screen.getByText('[G]')).toBeInTheDocument();
		});

		it('truncates content at MAX_RENDER_LENGTH', () => {
			const longContent = 'a'.repeat(5000);
			render(
				<ChatMessage
					item={makeMsg(longContent)}
					currentUserId={99}
					onGamePage={false}
					interactive={true}
				/>,
			);
			// 4096 chars + ellipsis
			const textEl = screen.getByText(/^a+…$/);
			expect(textEl.textContent!.length).toBe(4097); // 4096 + '…'
		});

		it('does not truncate content under the limit', () => {
			const content = 'a'.repeat(4096);
			render(
				<ChatMessage
					item={makeMsg(content)}
					currentUserId={99}
					onGamePage={false}
					interactive={true}
				/>,
			);
			expect(screen.getByText(content)).toBeInTheDocument();
		});

		it('applies text-shadow on game page', () => {
			const { container } = render(
				<ChatMessage item={makeMsg('hi')} currentUserId={99} onGamePage={true} interactive={true} />,
			);
			const wrapper = container.firstChild as HTMLElement;
			expect(wrapper.className).toContain('text-shadow');
		});
	});

	// ── Server messages ──────────────────────────────────────────────────

	describe('server messages', () => {
		it('renders kill feed text with sword icon', () => {
			render(
				<ChatMessage
					item={makeServerItem()}
					currentUserId={99}
					onGamePage={false}
					interactive={true}
				/>,
			);
			expect(screen.getByText(/Alice eliminated Bob/)).toBeInTheDocument();
		});
	});

	// ── System events ────────────────────────────────────────────────────

	describe('system events', () => {
		it('renders system event text in italic', () => {
			const { container } = render(
				<ChatMessage
					item={makeSystemItem()}
					currentUserId={99}
					onGamePage={false}
					interactive={true}
				/>,
			);
			expect(screen.getByText('Alice joined')).toBeInTheDocument();
			expect(container.firstChild).toHaveClass('italic');
		});

		it('renders room tag for system events', () => {
			render(
				<ChatMessage
					item={makeSystemItem()}
					currentUserId={99}
					roomTag="[L]"
					onGamePage={false}
					interactive={true}
				/>,
			);
			expect(screen.getByText('[L]')).toBeInTheDocument();
		});
	});
});
