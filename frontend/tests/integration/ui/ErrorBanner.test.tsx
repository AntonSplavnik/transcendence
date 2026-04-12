import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBanner, { AUTO_DISMISS_MS } from '../../../src/components/ui/ErrorBanner';
import { createMockStoredError } from '../../fixtures/errors';
import { render, screen, userEvent } from '../../helpers/render';

describe('ErrorBanner', () => {
	const mockOnDismiss = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const renderBanner = (error = createMockStoredError()) => {
		return render(<ErrorBanner error={error} onDismiss={mockOnDismiss} />, { withAuth: false });
	};

	it('renders nothing when error is null', () => {
		const { container } = render(<ErrorBanner error={null} onDismiss={mockOnDismiss} />, {
			withAuth: false,
		});

		expect(container.firstChild).toBeNull();
	});

	it('displays error message', () => {
		const error = createMockStoredError({ message: 'Something went wrong' });
		renderBanner(error);

		expect(screen.getByText('Something went wrong')).toBeInTheDocument();
	});

	it('auto-dismisses after AUTO_DISMISS_MS', async () => {
		renderBanner();

		expect(mockOnDismiss).not.toHaveBeenCalled();

		vi.advanceTimersByTime(AUTO_DISMISS_MS);

		expect(mockOnDismiss).toHaveBeenCalledTimes(1);
	});

	it('calls onDismiss when dismiss button clicked', async () => {
		vi.useRealTimers(); // Need real timers for userEvent
		const user = userEvent.setup();

		render(<ErrorBanner error={createMockStoredError()} onDismiss={mockOnDismiss} />, {
			withAuth: false,
		});

		await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));

		expect(mockOnDismiss).toHaveBeenCalledTimes(1);
	});

	it('has dismiss button with aria-label', () => {
		renderBanner();

		expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
	});

	it('clears timeout on unmount', () => {
		const { unmount } = renderBanner();

		unmount();

		vi.advanceTimersByTime(AUTO_DISMISS_MS);

		// onDismiss should not be called after unmount
		expect(mockOnDismiss).not.toHaveBeenCalled();
	});

	it('resets timeout when error changes', () => {
		const error1 = createMockStoredError({ message: 'Error 1' });
		const error2 = createMockStoredError({ message: 'Error 2' });

		const { rerender } = render(<ErrorBanner error={error1} onDismiss={mockOnDismiss} />, {
			withAuth: false,
		});

		const half = AUTO_DISMISS_MS / 2;

		// Advance halfway
		vi.advanceTimersByTime(half);
		expect(mockOnDismiss).not.toHaveBeenCalled();

		// Change error - should reset timer
		rerender(<ErrorBanner error={error2} onDismiss={mockOnDismiss} />);

		// Advance another half (would be full duration from first error)
		vi.advanceTimersByTime(half);
		expect(mockOnDismiss).not.toHaveBeenCalled();

		// Advance remaining time for new error
		vi.advanceTimersByTime(half);
		expect(mockOnDismiss).toHaveBeenCalledTimes(1);
	});

	it('applies fixed positioning at top center', () => {
		const error = createMockStoredError();
		renderBanner(error);

		const banner = screen.getByText(error.message).closest('.fixed');
		expect(banner).toHaveClass('top-4');
		expect(banner).toHaveClass('left-1/2');
		expect(banner).toHaveClass('-translate-x-1/2');
	});

	it('has error styling', () => {
		const error = createMockStoredError();
		renderBanner(error);

		const banner = screen.getByText(error.message).closest('.fixed');
		expect(banner).toHaveClass('bg-danger/90');
		expect(banner).toHaveClass('border');
		expect(banner).toHaveClass('border-danger-light');
		expect(banner).toHaveClass('text-white');
	});

	it('has high z-index', () => {
		renderBanner();

		const banner = screen.getByText('An error occurred').closest('.fixed');
		expect(banner).toHaveClass('z-[60]');
	});

	it('includes error icon', () => {
		renderBanner();

		// SVG icon should be present
		const svg = document.querySelector('svg');
		expect(svg).toBeInTheDocument();
	});

	it('does not start timer when error is null', () => {
		render(<ErrorBanner error={null} onDismiss={mockOnDismiss} />, { withAuth: false });

		vi.advanceTimersByTime(AUTO_DISMISS_MS);

		expect(mockOnDismiss).not.toHaveBeenCalled();
	});
});
