import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/render';
import TwoFactorLoginModal from '../../../src/components/modals/TwoFactorLoginModal';
import { server } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockAuthResponse } from '../../fixtures/users';
import { createMockApiError } from '../../fixtures/errors';

describe('TwoFactorLoginModal', () => {
	const mockGetPassword = vi.fn(() => 'testpassword');
	const mockOnSuccess = vi.fn();
	const mockOnCancel = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderModal = (email = 'test@example.com') => {
		return render(
			<TwoFactorLoginModal
				email={email}
				getPassword={mockGetPassword}
				onSuccess={mockOnSuccess}
				onCancel={mockOnCancel}
			/>
		);
	};

	it('renders modal with title', () => {
		renderModal();

		expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
	});

	it('shows instruction text for entering code', () => {
		renderModal();

		expect(
			screen.getByText(/Enter the 6-digit code from your authenticator app/)
		).toBeInTheDocument();
	});

	it('has authentication code input field', () => {
		renderModal();

		const input = screen.getByLabelText('Authentication Code');
		expect(input).toBeInTheDocument();
		expect(input.tagName).toBe('INPUT');
		expect(input).toHaveAttribute('autocomplete', 'one-time-code');
	});

	it('calls getPassword on submit', async () => {
		const user = userEvent.setup();
		renderModal();

		const input = screen.getByLabelText('Authentication Code');
		await user.type(input, '123456');
		await user.click(screen.getByText('Continue'));

		expect(mockGetPassword).toHaveBeenCalled();
	});

	it('calls onSuccess on successful login with MFA', async () => {
		server.use(
			http.post('/api/auth/login', () => {
				return HttpResponse.json(createMockAuthResponse());
			})
		);

		const user = userEvent.setup();
		renderModal();

		const input = screen.getByLabelText('Authentication Code');
		await user.type(input, '123456');
		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(mockOnSuccess).toHaveBeenCalled();
		});
	});

	it('shows specific error for invalid code (TwoFactorInvalid)', async () => {
		server.use(
			http.post('/api/auth/login', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 401, brief: 'TwoFactorInvalid' }) },
					{ status: 401 }
				);
			})
		);

		const user = userEvent.setup();
		renderModal();

		const input = screen.getByLabelText('Authentication Code');
		await user.type(input, 'invalid');
		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(
				screen.getByText('Invalid authentication code. Please try again.')
			).toBeInTheDocument();
		});
	});

	it('shows generic error for other failures', async () => {
		server.use(
			http.post('/api/auth/login', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 500, brief: 'InternalError', detail: 'Server error' }) },
					{ status: 500 }
				);
			})
		);

		const user = userEvent.setup();
		renderModal();

		const input = screen.getByLabelText('Authentication Code');
		await user.type(input, '123456');
		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(screen.getByText('Server error')).toBeInTheDocument();
		});
	});

	it('shows error when code is empty', async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(screen.getByText('Authentication code is required')).toBeInTheDocument();
		});
	});

	it('calls onCancel when Cancel button clicked', async () => {
		const user = userEvent.setup();
		renderModal();

		await user.click(screen.getByText('Cancel'));

		expect(mockOnCancel).toHaveBeenCalled();
	});

	it('shows loading state during submission', async () => {
		server.use(
			http.post('/api/auth/login', async () => {
				await new Promise(resolve => setTimeout(resolve, 100));
				return HttpResponse.json(createMockAuthResponse());
			})
		);

		const user = userEvent.setup();
		renderModal();

		const input = screen.getByLabelText('Authentication Code');
		await user.type(input, '123456');
		await user.click(screen.getByText('Continue'));

		expect(screen.getByText('Verifying...')).toBeInTheDocument();
	});

	it('disables input during loading', async () => {
		server.use(
			http.post('/api/auth/login', async () => {
				await new Promise(resolve => setTimeout(resolve, 100));
				return HttpResponse.json(createMockAuthResponse());
			})
		);

		const user = userEvent.setup();
		renderModal();

		const input = screen.getByLabelText('Authentication Code');
		await user.type(input, '123456');
		await user.click(screen.getByText('Continue'));

		expect(input).toBeDisabled();
	});

	it('auto-focuses the code input', () => {
		renderModal();

		const input = screen.getByLabelText('Authentication Code');
		expect(input).toHaveFocus();
	});
});
