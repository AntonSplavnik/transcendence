import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, userEvent, waitFor } from '../../helpers/render';
import ErrorBanner from '../../../src/components/ui/ErrorBanner';
import { createMockStoredError } from '../../fixtures/errors';

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
		return render(
			<ErrorBanner error={error} onDismiss={mockOnDismiss} />,
			{ withAuth: false }
		);
	};

	it('renders nothing when error is null', () => {
		const { container } = render(
			<ErrorBanner error={null} onDismiss={mockOnDismiss} />,
			{ withAuth: false }
		);

		expect(container.firstChild).toBeNull();
	});

	it('displays error message', () => {
		const error = createMockStoredError({ message: 'Something went wrong' });
		renderBanner(error);

		expect(screen.getByText('Something went wrong')).toBeInTheDocument();
	});

	it('auto-dismisses after 5 seconds', async () => {
		renderBanner();

		expect(mockOnDismiss).not.toHaveBeenCalled();

		vi.advanceTimersByTime(5000);

		expect(mockOnDismiss).toHaveBeenCalledTimes(1);
	});

	it('calls onDismiss when dismiss button clicked', async () => {
		vi.useRealTimers(); // Need real timers for userEvent
		const user = userEvent.setup();

		const { container } = render(
			<ErrorBanner error={createMockStoredError()} onDismiss={mockOnDismiss} />,
			{ withAuth: false }
		);

		await user.click(screen.getByRole('button', { name: 'Dismiss error' }));

		expect(mockOnDismiss).toHaveBeenCalledTimes(1);
	});

	it('has dismiss button with aria-label', () => {
		renderBanner();

		expect(screen.getByRole('button', { name: 'Dismiss error' })).toBeInTheDocument();
	});

	it('clears timeout on unmount', () => {
		const { unmount } = renderBanner();

		unmount();

		vi.advanceTimersByTime(5000);

		// onDismiss should not be called after unmount
		expect(mockOnDismiss).not.toHaveBeenCalled();
	});

	it('resets timeout when error changes', () => {
		const error1 = createMockStoredError({ message: 'Error 1' });
		const error2 = createMockStoredError({ message: 'Error 2' });

		const { rerender } = render(
			<ErrorBanner error={error1} onDismiss={mockOnDismiss} />,
			{ withAuth: false }
		);

		// Advance halfway
		vi.advanceTimersByTime(2500);
		expect(mockOnDismiss).not.toHaveBeenCalled();

		// Change error - should reset timer
		rerender(<ErrorBanner error={error2} onDismiss={mockOnDismiss} />);

		// Advance another 2500ms (would be 5000ms total from first error)
		vi.advanceTimersByTime(2500);
		expect(mockOnDismiss).not.toHaveBeenCalled();

		// Advance remaining time for new error
		vi.advanceTimersByTime(2500);
		expect(mockOnDismiss).toHaveBeenCalledTimes(1);
	});

	it('applies fixed positioning at top center', () => {
		const error = createMockStoredError();
		renderBanner(error);

		const banner = screen.getByText(error.message).closest('.fixed');
		expect(banner).toHaveClass('top-4');
		expect(banner).toHaveClass('left-1/2');
		expect(banner).toHaveClass('transform');
		expect(banner).toHaveClass('-translate-x-1/2');
	});

	it('has error styling', () => {
		const error = createMockStoredError();
		renderBanner(error);

		const banner = screen.getByText(error.message).closest('.fixed');
		expect(banner).toHaveClass('bg-red-900/90');
		expect(banner).toHaveClass('border');
		expect(banner).toHaveClass('border-red-500');
		expect(banner).toHaveClass('text-red-100');
	});

	it('has high z-index', () => {
		renderBanner();

		const banner = screen.getByText('An error occurred').closest('.fixed');
		expect(banner).toHaveClass('z-50');
	});

	it('includes error icon', () => {
		renderBanner();

		// SVG icon should be present
		const svg = document.querySelector('svg');
		expect(svg).toBeInTheDocument();
	});

	it('does not start timer when error is null', () => {
		render(
			<ErrorBanner error={null} onDismiss={mockOnDismiss} />,
			{ withAuth: false }
		);

		vi.advanceTimersByTime(5000);

		expect(mockOnDismiss).not.toHaveBeenCalled();
	});
});
