import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/render';
import ReauthModal from '../../../src/components/modals/ReauthModal';
import { server } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockAuthResponse } from '../../fixtures/users';
import { createMockApiError } from '../../fixtures/errors';

describe('ReauthModal', () => {
	const mockOnSuccess = vi.fn();
	const mockOnCancel = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderModal = (totpEnabled = false) => {
		const authResponse = createMockAuthResponse({ totp_enabled: totpEnabled });

		server.use(
			http.get('/api/user/me', () => {
				return HttpResponse.json(authResponse);
			})
		);

		return render(
			<ReauthModal onSuccess={mockOnSuccess} onCancel={mockOnCancel} />
		);
	};

	it('renders modal with title', async () => {
		renderModal();

		await waitFor(() => {
			expect(screen.getByText('Re-authenticate')).toBeInTheDocument();
		});
	});

	it('shows session expiring message', async () => {
		renderModal();

		await waitFor(() => {
			expect(
				screen.getByText(/Your session is expiring soon/)
			).toBeInTheDocument();
		});
	});

	it('shows password input', async () => {
		renderModal();

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});
	});

	it('does not show 2FA input when user has 2FA disabled', async () => {
		renderModal(false);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		expect(screen.queryByLabelText('2FA Code')).not.toBeInTheDocument();
	});

	it('shows 2FA input when user has 2FA enabled', async () => {
		renderModal(true);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
			expect(screen.getByLabelText('2FA Code')).toBeInTheDocument();
		});
	});

	it('shows error when password is empty', async () => {
		const user = userEvent.setup();
		renderModal();

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(screen.getByText('Password is required')).toBeInTheDocument();
		});
	});

	it('shows error when 2FA required but not provided', async () => {
		const user = userEvent.setup();
		renderModal(true);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		await user.type(screen.getByLabelText('Password'), 'password');
		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(screen.getByText('2FA code is required')).toBeInTheDocument();
		});
	});

	it('calls reauth with password only when 2FA disabled', async () => {
		let receivedPayload: Record<string, unknown>;
		server.use(
			http.post('/api/auth/session-management/reauth', async ({ request }) => {
				receivedPayload = await request.json();
				return HttpResponse.json(createMockAuthResponse());
			})
		);

		const user = userEvent.setup();
		renderModal(false);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		await user.type(screen.getByLabelText('Password'), 'mypassword');
		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(mockOnSuccess).toHaveBeenCalled();
		});

		expect(receivedPayload.password).toBe('mypassword');
		expect(receivedPayload.mfa_code).toBeUndefined();
	});

	it('calls reauth with password and MFA code when 2FA enabled', async () => {
		let receivedPayload: Record<string, unknown>;
		server.use(
			http.post('/api/auth/session-management/reauth', async ({ request }) => {
				receivedPayload = await request.json();
				return HttpResponse.json(createMockAuthResponse());
			})
		);

		const user = userEvent.setup();
		renderModal(true);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		await user.type(screen.getByLabelText('Password'), 'mypassword');
		await user.type(screen.getByLabelText('2FA Code'), '123456');
		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(mockOnSuccess).toHaveBeenCalled();
		});

		expect(receivedPayload.password).toBe('mypassword');
		expect(receivedPayload.mfa_code).toBe('123456');
	});

	it('calls onSuccess after successful reauth', async () => {
		server.use(
			http.post('/api/auth/session-management/reauth', () => {
				return HttpResponse.json(createMockAuthResponse());
			})
		);

		const user = userEvent.setup();
		renderModal(false);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		await user.type(screen.getByLabelText('Password'), 'password');
		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(mockOnSuccess).toHaveBeenCalled();
		});
	});

	it('calls onCancel when Cancel button clicked', async () => {
		const user = userEvent.setup();
		renderModal();

		await waitFor(() => {
			expect(screen.getByText('Cancel')).toBeInTheDocument();
		});

		await user.click(screen.getByText('Cancel'));

		expect(mockOnCancel).toHaveBeenCalled();
	});

	it('shows error message on reauth failure', async () => {
		server.use(
			http.post('/api/auth/session-management/reauth', () => {
				return HttpResponse.json(
					{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: 'Invalid password' }) },
					{ status: 401 }
				);
			})
		);

		const user = userEvent.setup();
		renderModal(false);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		await user.type(screen.getByLabelText('Password'), 'wrongpassword');
		await user.click(screen.getByText('Continue'));

		await waitFor(() => {
			expect(screen.getByText('Invalid password')).toBeInTheDocument();
		});
	});

	it('shows loading state during submission', async () => {
		server.use(
			http.post('/api/auth/session-management/reauth', async () => {
				await new Promise(resolve => setTimeout(resolve, 100));
				return HttpResponse.json(createMockAuthResponse());
			})
		);

		const user = userEvent.setup();
		renderModal(false);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		await user.type(screen.getByLabelText('Password'), 'password');
		await user.click(screen.getByText('Continue'));

		expect(screen.getByText('Verifying...')).toBeInTheDocument();
	});

	it('disables inputs during loading', async () => {
		server.use(
			http.post('/api/auth/session-management/reauth', async () => {
				await new Promise(resolve => setTimeout(resolve, 100));
				return HttpResponse.json(createMockAuthResponse());
			})
		);

		const user = userEvent.setup();
		renderModal(false);

		await waitFor(() => {
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		await user.type(screen.getByLabelText('Password'), 'password');
		await user.click(screen.getByText('Continue'));

		expect(screen.getByLabelText('Password')).toBeDisabled();
	});

	it('auto-focuses password input', async () => {
		renderModal();

		await waitFor(() => {
			const passwordInput = screen.getByLabelText('Password');
			expect(passwordInput).toHaveFocus();
		});
	});
});
