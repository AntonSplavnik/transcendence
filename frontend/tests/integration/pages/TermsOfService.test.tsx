import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent } from '../../helpers/render';
import TermsOfService from '../../../src/components/TermsOfService';

const mockOnBack = vi.fn();

describe('TermsOfService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders heading', () => {
		render(<TermsOfService onBack={mockOnBack} />, { withAuth: true });

		expect(screen.getByText('Terms of Service')).toBeInTheDocument();
	});

	it('renders last-updated date', () => {
		render(<TermsOfService onBack={mockOnBack} />, { withAuth: true });

		expect(screen.getByText(/Last updated: \d{2}\.\d{2}\.\d{4}/)).toBeInTheDocument();
	});

	it('renders key sections', () => {
		render(<TermsOfService onBack={mockOnBack} />, { withAuth: true });

		expect(screen.getByText(/Who Can Use This Service/)).toBeInTheDocument();
		expect(screen.getByText(/Rules of the Game/)).toBeInTheDocument();
		expect(screen.getByText(/13\. Contact/)).toBeInTheDocument();
	});

	it('back button calls onBack', async () => {
		render(<TermsOfService onBack={mockOnBack} />, { withAuth: true });
		const user = userEvent.setup();

		await user.click(screen.getByLabelText('Go back'));

		expect(mockOnBack).toHaveBeenCalledOnce();
	});
});
