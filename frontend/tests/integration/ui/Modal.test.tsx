import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, fireEvent } from '../../helpers/render';
import Modal from '../../../src/components/ui/Modal';

describe('Modal', () => {
	const mockOnClose = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderModal = (props = {}) => {
		return render(
			<Modal onClose={mockOnClose} title="Test Modal" {...props}>
				<p>Modal content</p>
			</Modal>,
			{ withAuth: false }
		);
	};

	it('renders title', () => {
		renderModal();

		expect(screen.getByText('Test Modal')).toBeInTheDocument();
	});

	it('renders children', () => {
		renderModal();

		expect(screen.getByText('Modal content')).toBeInTheDocument();
	});

	it('renders close button', () => {
		renderModal();

		expect(screen.getByText('×')).toBeInTheDocument();
	});

	it('calls onClose when close button clicked', async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(screen.getByText('×'));

		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it('calls onClose when Escape key pressed', () => {
		renderModal();

		fireEvent.keyDown(document, { key: 'Escape' });

		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it('does not call onClose for other keys', () => {
		renderModal();

		fireEvent.keyDown(document, { key: 'Enter' });

		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it('renders icon when provided', () => {
		renderModal({
			icon: <span data-testid="test-icon">Icon</span>,
		});

		expect(screen.getByTestId('test-icon')).toBeInTheDocument();
	});

	it('does not render icon placeholder when not provided', () => {
		renderModal();

		const title = screen.getByText('Test Modal');
		expect(title.children.length).toBe(0);
	});

	it('uses md max width by default', () => {
		renderModal();

		const card = screen.getByText('Test Modal').closest('.max-w-md');
		expect(card).toBeInTheDocument();
	});

	it('uses lg max width when specified', () => {
		renderModal({ maxWidth: 'lg' });

		const card = screen.getByText('Test Modal').closest('.max-w-lg');
		expect(card).toBeInTheDocument();
	});

	it('has fixed positioning for overlay', () => {
		renderModal();

		const overlay = screen.getByText('Test Modal').closest('.fixed');
		expect(overlay).toBeInTheDocument();
		expect(overlay).toHaveClass('inset-0');
		expect(overlay).toHaveClass('bg-black/60');
	});

	it('centers content', () => {
		renderModal();

		const overlay = screen.getByText('Test Modal').closest('.fixed');
		expect(overlay).toHaveClass('flex');
		expect(overlay).toHaveClass('items-center');
		expect(overlay).toHaveClass('justify-center');
	});

	it('has high z-index', () => {
		renderModal();

		const overlay = screen.getByText('Test Modal').closest('.fixed');
		expect(overlay).toHaveClass('z-50');
	});

	it('cleans up keydown listener on unmount', () => {
		const { unmount } = renderModal();

		unmount();

		fireEvent.keyDown(document, { key: 'Escape' });

		// Should only have been called 0 times since we unmounted
		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it('has scrollable content area', () => {
		renderModal();

		const card = screen.getByText('Test Modal').closest('.max-h-\\[90vh\\]');
		expect(card).toHaveClass('overflow-y-auto');
	});

	describe('focus management', () => {
		it('moves focus to the first focusable element on open', () => {
			renderModal();

			expect(screen.getByLabelText('Close dialog')).toHaveFocus();
		});

		it('respects autoFocus — does not steal focus from an element already focused inside', () => {
			render(
				<Modal onClose={mockOnClose} title="Test Modal">
					<input data-testid="auto-input" autoFocus />
				</Modal>,
				{ withAuth: false },
			);

			expect(screen.getByTestId('auto-input')).toHaveFocus();
		});

		it('wraps Tab forward from the last focusable element to the first', async () => {
			const user = userEvent.setup();
			render(
				<Modal onClose={mockOnClose} title="Test Modal">
					<button>Alpha</button>
					<button>Beta</button>
				</Modal>,
				{ withAuth: false },
			);
			// Focusable order: [close-button, Alpha, Beta]
			expect(screen.getByLabelText('Close dialog')).toHaveFocus();

			await user.tab(); // → Alpha
			await user.tab(); // → Beta (last)
			expect(screen.getByText('Beta')).toHaveFocus();

			await user.tab(); // wraps → close-button (first)
			expect(screen.getByLabelText('Close dialog')).toHaveFocus();
		});

		it('wraps Shift+Tab backward from the first focusable element to the last', async () => {
			const user = userEvent.setup();
			render(
				<Modal onClose={mockOnClose} title="Test Modal">
					<button>Alpha</button>
					<button>Beta</button>
				</Modal>,
				{ withAuth: false },
			);
			// Initial focus: close-button (first)
			expect(screen.getByLabelText('Close dialog')).toHaveFocus();

			await user.tab({ shift: true }); // wraps → Beta (last)
			expect(screen.getByText('Beta')).toHaveFocus();
		});

		it('restores focus to the previously focused element when the modal unmounts', async () => {
			const user = userEvent.setup();

			function Host() {
				const [open, setOpen] = useState(false);
				return (
					<>
						<button data-testid="trigger" onClick={() => setOpen(true)}>
							Open
						</button>
						{open && (
							<Modal onClose={() => setOpen(false)} title="Test Modal">
								<p>content</p>
							</Modal>
						)}
					</>
				);
			}

			render(<Host />, { withAuth: false });

			await user.click(screen.getByTestId('trigger'));
			expect(screen.getByLabelText('Close dialog')).toHaveFocus();

			await user.click(screen.getByLabelText('Close dialog'));
			expect(screen.getByTestId('trigger')).toHaveFocus();
		});

		it('does not call onClose on Escape when closable is false', () => {
			renderModal({ closable: false });

			fireEvent.keyDown(document, { key: 'Escape' });

			expect(mockOnClose).not.toHaveBeenCalled();
		});

		it('still traps Tab when closable is false', async () => {
			const user = userEvent.setup();
			render(
				<Modal onClose={mockOnClose} title="Test Modal" closable={false}>
					<button>Only</button>
				</Modal>,
				{ withAuth: false },
			);
			// Focusable order: [Only] (no close button when closable=false)
			expect(screen.getByText('Only')).toHaveFocus();

			await user.tab(); // single element — wraps back to itself
			expect(screen.getByText('Only')).toHaveFocus();
		});
	});
});
