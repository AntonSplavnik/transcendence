import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent } from '../../helpers/render';
import PrivacyPolicy from '../../../src/components/PrivacyPolicy';

const mockOnBack = vi.fn();

describe('PrivacyPolicy', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders heading', () => {
		render(<PrivacyPolicy onBack={mockOnBack} />, { withAuth: false });

		expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
	});

	it('renders last-updated date', () => {
		render(<PrivacyPolicy onBack={mockOnBack} />, { withAuth: false });

		expect(screen.getByText(/Last updated: \d{2}\.\d{2}\.\d{4}/)).toBeInTheDocument();
	});

	it('renders key sections', () => {
		render(<PrivacyPolicy onBack={mockOnBack} />, { withAuth: false });

		expect(screen.getByText(/What Data We Collect/)).toBeInTheDocument();
		expect(screen.getByText(/Your Rights/)).toBeInTheDocument();
		expect(screen.getByText(/Contact, Complaints/)).toBeInTheDocument();
	});

	it('back button calls onBack', async () => {
		render(<PrivacyPolicy onBack={mockOnBack} />, { withAuth: false });
		const user = userEvent.setup();

		await user.click(screen.getByLabelText('Go back'));

		expect(mockOnBack).toHaveBeenCalledOnce();
	});
});
