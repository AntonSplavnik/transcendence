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
});
