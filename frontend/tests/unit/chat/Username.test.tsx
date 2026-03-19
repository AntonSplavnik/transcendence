import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Username from '../../../src/components/ui/Username';
import type { UsernameProps } from '../../../src/components/ui/Username';

// ─── Mock ChatContext ────────────────────────────────────────────────────────

const mockUpdatePreferences = vi.fn();
const mockPreferences = { globalEnabled: true, visible: true, blockedUsers: [] as number[] };

vi.mock('../../../src/contexts/ChatContext', () => ({
	useChat: vi.fn(() => ({
		preferences: mockPreferences,
		updatePreferences: mockUpdatePreferences,
	})),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderUsername(overrides: Partial<UsernameProps> = {}) {
	const defaults: UsernameProps = {
		userId: 1,
		nickname: 'Alice',
		isSelf: false,
		interactive: true,
		...overrides,
	};
	return render(<Username {...defaults} />);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Username', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPreferences.blockedUsers = [];
	});

	// ── Rendering modes ──────────────────────────────────────────────────

	describe('rendering', () => {
		it('renders "You" for self', () => {
			renderUsername({ isSelf: true });
			expect(screen.getByText('You')).toBeInTheDocument();
			expect(screen.queryByRole('button')).not.toBeInTheDocument();
		});

		it('renders plain span when non-interactive', () => {
			renderUsername({ interactive: false });
			expect(screen.getByText('Alice')).toBeInTheDocument();
			expect(screen.queryByRole('button')).not.toBeInTheDocument();
		});

		it('renders button when interactive', () => {
			renderUsername({ interactive: true });
			const btn = screen.getByRole('button', { name: 'Options for Alice' });
			expect(btn).toBeInTheDocument();
			expect(btn).toHaveTextContent('Alice');
		});

		it('applies deterministic color based on userId', () => {
			const { rerender } = render(
				<Username userId={0} nickname="A" isSelf={false} interactive={false} />,
			);
			const spanA = screen.getByText('A');
			expect(spanA.className).toContain('text-gold-300');

			rerender(
				<Username userId={1} nickname="B" isSelf={false} interactive={false} />,
			);
			const spanB = screen.getByText('B');
			expect(spanB.className).toContain('text-info-light');
		});
	});

	// ── Context menu open/close ──────────────────────────────────────────

	describe('context menu', () => {
		it('opens menu on click and closes on Escape', async () => {
			const user = userEvent.setup();
			renderUsername();
			const btn = screen.getByRole('button', { name: 'Options for Alice' });

			await user.click(btn);
			expect(screen.getByRole('menu', { name: 'Options for Alice' })).toBeInTheDocument();

			// Close via Escape (second click is intercepted by outside-click handler).
			fireEvent.keyDown(document, { key: 'Escape' });
			expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		});

		it('closes menu on Escape', async () => {
			const user = userEvent.setup();
			renderUsername();
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));
			expect(screen.getByRole('menu')).toBeInTheDocument();

			fireEvent.keyDown(document, { key: 'Escape' });
			expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		});

		it('closes menu on outside click', async () => {
			const user = userEvent.setup();
			renderUsername();
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));
			expect(screen.getByRole('menu')).toBeInTheDocument();

			fireEvent.mouseDown(document.body);
			expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		});

		it('sets aria-expanded correctly', async () => {
			const user = userEvent.setup();
			renderUsername();
			const btn = screen.getByRole('button', { name: 'Options for Alice' });
			expect(btn).toHaveAttribute('aria-expanded', 'false');

			await user.click(btn);
			expect(btn).toHaveAttribute('aria-expanded', 'true');
		});
	});

	// ── Menu actions ─────────────────────────────────────────────────────

	describe('menu actions', () => {
		it('Copy Username calls clipboard.writeText and closes menu', async () => {
			const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
			const user = userEvent.setup();
			renderUsername();
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));

			const copyBtn = screen.getByRole('menuitem', { name: 'Copy Username' });
			await user.click(copyBtn);

			expect(writeTextSpy).toHaveBeenCalledWith('Alice');
			expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		});

		it('Block adds user to blocked list and closes menu', async () => {
			const user = userEvent.setup();
			renderUsername({ userId: 42 });
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));

			const blockBtn = screen.getByRole('menuitem', { name: 'Block' });
			await user.click(blockBtn);

			expect(mockUpdatePreferences).toHaveBeenCalledWith({ blockedUsers: [42] });
			expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		});

		it('Unblock removes user from blocked list', async () => {
			mockPreferences.blockedUsers = [42];
			const user = userEvent.setup();
			renderUsername({ userId: 42 });
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));

			const unblockBtn = screen.getByRole('menuitem', { name: 'Unblock' });
			await user.click(unblockBtn);

			expect(mockUpdatePreferences).toHaveBeenCalledWith({ blockedUsers: [] });
		});

		it('disabled stubs are not clickable', async () => {
			const user = userEvent.setup();
			renderUsername();
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));

			const profileBtn = screen.getByRole('menuitem', { name: 'Show Profile' });
			expect(profileBtn).toBeDisabled();
			expect(profileBtn).toHaveAttribute('aria-disabled', 'true');
		});
	});

	// ── Focus trap ───────────────────────────────────────────────────────

	describe('focus trap', () => {
		it('auto-focuses the first enabled menu item on open', async () => {
			const user = userEvent.setup();
			renderUsername();
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));

			// First enabled item is "Copy Username" (stubs are disabled).
			await waitFor(() => {
				expect(document.activeElement).toBe(
					screen.getByRole('menuitem', { name: 'Copy Username' }),
				);
			});
		});

		it('Tab from last enabled item wraps to first enabled item', async () => {
			const user = userEvent.setup();
			renderUsername();
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));

			// Focus the last enabled item (Block).
			const blockBtn = screen.getByRole('menuitem', { name: 'Block' });
			blockBtn.focus();
			expect(document.activeElement).toBe(blockBtn);

			// Tab should wrap to the first enabled item.
			fireEvent.keyDown(document, { key: 'Tab' });
			expect(document.activeElement).toBe(
				screen.getByRole('menuitem', { name: 'Copy Username' }),
			);
		});

		it('Shift+Tab from first enabled item wraps to last enabled item', async () => {
			const user = userEvent.setup();
			renderUsername();
			await user.click(screen.getByRole('button', { name: 'Options for Alice' }));

			// First enabled item should be focused via auto-focus.
			const copyBtn = screen.getByRole('menuitem', { name: 'Copy Username' });
			await waitFor(() => {
				expect(document.activeElement).toBe(copyBtn);
			});

			// Shift+Tab should wrap to last enabled item (Block).
			fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
			expect(document.activeElement).toBe(
				screen.getByRole('menuitem', { name: 'Block' }),
			);
		});
	});
});
