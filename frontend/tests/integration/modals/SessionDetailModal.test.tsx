import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent } from '../../helpers/render';
import SessionDetailsModal from '../../../src/components/modals/SessionDetailModal';
import { createMockSession } from '../../fixtures/users';

describe('SessionDetailsModal', () => {
	const mockOnClose = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderModal = (sessionOverrides = {}) => {
		const session = createMockSession(sessionOverrides);
		return render(
			<SessionDetailsModal session={session} onClose={mockOnClose} />,
			{ withAuth: false }
		);
	};

	it('renders modal with title', () => {
		renderModal();

		expect(screen.getByText('Session Details')).toBeInTheDocument();
	});

	it('displays session ID', () => {
		renderModal({ session_id: 42 });

		expect(screen.getByText('Session ID')).toBeInTheDocument();
		expect(screen.getByText('42')).toBeInTheDocument();
	});

	it('displays created date', () => {
		const createdAt = '2024-01-15T10:30:00Z';
		renderModal({ created_at: createdAt });

		expect(screen.getByText('Created')).toBeInTheDocument();
		// Date formatting depends on locale, so just check the section exists
		const createdSection = screen.getAllByText(/Created/)[0].closest('div');
		expect(createdSection).toBeInTheDocument();
	});

	it('displays last used date', () => {
		renderModal();

		expect(screen.getByText('Last Used')).toBeInTheDocument();
	});

	it('displays JWT expiry', () => {
		renderModal();

		expect(screen.getByText('JWT Expiry (Access Token)')).toBeInTheDocument();
	});

	it('displays session expiry', () => {
		renderModal();

		expect(screen.getByText('Session Expiry (Login Required)')).toBeInTheDocument();
	});

	it('displays device name when available', () => {
		renderModal({ device_name: 'Firefox on Windows' });

		expect(screen.getByText('Device Information')).toBeInTheDocument();
		expect(screen.getByText('Device: Firefox on Windows')).toBeInTheDocument();
	});

	it('displays IP address when available', () => {
		renderModal({ ip_address: '192.168.1.100' });

		expect(screen.getByText('IP: 192.168.1.100')).toBeInTheDocument();
	});

	it('does not show device section when no device info', () => {
		renderModal({ device_name: null, ip_address: null });

		expect(screen.queryByText('Device Information')).not.toBeInTheDocument();
	});

	it('calls onClose when Close button clicked', async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(screen.getByText('Close'));

		expect(mockOnClose).toHaveBeenCalled();
	});

	describe('getTimeRemaining helper', () => {
		it('shows expired for past dates', () => {
			const pastDate = new Date(Date.now() - 60000).toISOString();
			renderModal({ access_expiry: pastDate });

			expect(screen.getByText('Expires in: Expired')).toBeInTheDocument();
		});

		it('shows minutes for short durations', () => {
			const futureDate = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes
			renderModal({ access_expiry: futureDate });

			expect(screen.getByText(/Expires in: \d+m/)).toBeInTheDocument();
		});

		it('shows hours and minutes for medium durations', () => {
			const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours
			renderModal({ access_expiry: futureDate });

			expect(screen.getByText(/Expires in: \d+h \d+m/)).toBeInTheDocument();
		});

		it('shows days and hours for long durations', () => {
			const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days
			renderModal({ login_expiry: futureDate });

			expect(screen.getByText(/Expires in: \d+d \d+h/)).toBeInTheDocument();
		});
	});

	describe('formatDate helper', () => {
		it('formats dates using toLocaleString', () => {
			// Just verify the date appears formatted (locale-dependent)
			const testDate = '2024-06-15T14:30:00Z';
			renderModal({ created_at: testDate });

			// The date should be displayed somewhere
			const createdSection = screen.getByText('Created').closest('div')?.parentElement;
			expect(createdSection?.textContent).toContain('2024');
		});
	});

	it('uses lg max width', () => {
		renderModal();

		// Modal should have lg width class applied via maxWidth prop
		const card = screen.getByText('Session Details').closest('.max-w-lg');
		expect(card).toBeInTheDocument();
	});
});
