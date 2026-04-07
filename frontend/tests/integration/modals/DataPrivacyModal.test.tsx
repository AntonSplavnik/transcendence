import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/render';
import DataPrivacyModal from '../../../src/components/modals/DataPrivacyModal';
import { server } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockAuthResponse } from '../../fixtures/users';
import { createMockApiError } from '../../fixtures/errors';
import type { GdprInitiateResponse, DataExport } from '../../../src/api/types';

const mockInitiateResponse: GdprInitiateResponse = {
	token: 'dGVzdC10b2tlbi0xMjM0NTY3ODkwYWJjZGVm',
	email_confirmation_required: false,
	expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
};

const mockInitiateWithEmail: GdprInitiateResponse = {
	...mockInitiateResponse,
	email_confirmation_required: true,
};

const mockDataExport: DataExport = {
	exported_at: new Date().toISOString(),
	user: {
		id: 1,
		email: 'test@example.com',
		nickname: 'TestUser',
		totp_enabled: false,
		totp_confirmed_at: null,
		created_at: '2024-01-01T00:00:00Z',
		description: '',
		tos_accepted_at: '2025-01-01T00:00:00Z',
		email_confirmed_at: null,
		pending_email_change: null,
	},
	sessions: [],
	friend_requests: [],
	notifications: [],
	avatar_large_base64: null,
	avatar_small_base64: null,
};

describe('DataPrivacyModal', () => {
	const mockOnClose = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderModal = (userOverrides = {}) => {
		const authResponse = createMockAuthResponse(userOverrides);

		server.use(
			http.get('/api/user/me', () => {
				return HttpResponse.json(authResponse);
			}),
		);

		return render(<DataPrivacyModal onClose={mockOnClose} />);
	};

	// ── Rendering & initial state ─────────────────────────────

	describe('initial state', () => {
		it('renders modal with title', async () => {
			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});
		});

		it('shows both sections', async () => {
			renderModal();

			await waitFor(() => {
				expect(screen.getByRole('heading', { name: 'Export My Data' })).toBeInTheDocument();
				expect(screen.getByRole('heading', { name: 'Delete My Account' })).toBeInTheDocument();
			});
		});

		it('does not show password inputs initially', async () => {
			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
		});

		it('closes on escape key', async () => {
			const user = userEvent.setup();
			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			await user.keyboard('{Escape}');
			expect(mockOnClose).toHaveBeenCalled();
		});

		it('has correct dialog role and aria-modal', () => {
			renderModal();

			const dialog = screen.getByRole('dialog');
			expect(dialog).toHaveAttribute('aria-modal', 'true');
		});
	});

	// ── Export flow ────────────────────────────────────────────

	describe('export flow', () => {
		it('clicking export button reveals password input', async () => {
			const user = userEvent.setup();
			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			// Click the Export button (in the idle state, it says "Export My Data")
			const exportButtons = screen.getAllByText('Export My Data');
			// The button is the second one (first is the heading text)
			await user.click(exportButtons[exportButtons.length - 1]);

			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		it('shows MFA input when user has 2FA enabled', async () => {
			const user = userEvent.setup();
			renderModal({ totp_enabled: true });

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);

			expect(screen.getByLabelText('Authentication Code')).toBeInTheDocument();
		});

		it('shows validation error on empty password', async () => {
			const user = userEvent.setup();
			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);

			await user.click(screen.getByText('Continue'));

			expect(screen.getByText('Password is required.')).toBeInTheDocument();
		});

		it('shows MFA validation error on invalid format', async () => {
			const user = userEvent.setup();
			renderModal({ totp_enabled: true });

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);

			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.type(screen.getByLabelText('Authentication Code'), 'abc');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByText('Invalid recovery code format.')).toBeInTheDocument();
			});
		});

		it('successful initiation without email shows re-enter credentials', async () => {
			const user = userEvent.setup();

			server.use(
				http.post('/api/user/export-my-data', () => {
					return HttpResponse.json(mockInitiateResponse);
				}),
			);

			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);

			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByText(/Re-enter your credentials/)).toBeInTheDocument();
			});
		});

		it('successful initiation with email shows check email step', async () => {
			const user = userEvent.setup();

			server.use(
				http.post('/api/user/export-my-data', () => {
					return HttpResponse.json(mockInitiateWithEmail);
				}),
			);

			renderModal({ email_confirmed_at: '2024-01-01T00:00:00Z' });

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);

			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByText('Check your email')).toBeInTheDocument();
			});
		});

		it('successful execution shows download button', async () => {
			const user = userEvent.setup();

			server.use(
				http.post('/api/user/export-my-data', ({ request }) => {
					const url = new URL(request.url);
					if (url.searchParams.has('token')) {
						return HttpResponse.json(mockDataExport);
					}
					return HttpResponse.json(mockInitiateResponse);
				}),
			);

			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			// Step 1: Initiate
			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);
			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.click(screen.getByText('Continue'));

			// Step 2: Execute
			await waitFor(() => {
				expect(screen.getByText(/Re-enter your credentials/)).toBeInTheDocument();
			});

			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.click(screen.getByText('Download My Data'));

			await waitFor(() => {
				expect(screen.getByText('Your data export has been downloaded.')).toBeInTheDocument();
				expect(screen.getByText('Download Again')).toBeInTheDocument();
			});
		});
	});

	// ── Delete flow ───────────────────────────────────────────

	describe('delete flow', () => {
		it('clicking delete button reveals password input', async () => {
			const user = userEvent.setup();
			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			const deleteButtons = screen.getAllByText('Delete My Account');
			await user.click(deleteButtons[deleteButtons.length - 1]);

			expect(screen.getAllByLabelText('Password').length).toBeGreaterThan(0);
		});

		it('shows nickname confirmation in execute step', async () => {
			const user = userEvent.setup();

			server.use(
				http.delete('/api/user/delete-my-account', () => {
					return HttpResponse.json(mockInitiateResponse);
				}),
			);

			renderModal({ nickname: 'TestPlayer' });

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			// Initiate
			const deleteButtons = screen.getAllByText('Delete My Account');
			await user.click(deleteButtons[deleteButtons.length - 1]);
			await user.type(screen.getAllByLabelText('Password')[0], 'mypassword123');
			await user.click(screen.getByText('Continue'));

			// Should show nickname confirmation
			await waitFor(() => {
				expect(screen.getByText(/Type your username "TestPlayer" to confirm/)).toBeInTheDocument();
			});
		});

		it('execute button disabled when nickname does not match', async () => {
			const user = userEvent.setup();

			server.use(
				http.delete('/api/user/delete-my-account', () => {
					return HttpResponse.json(mockInitiateResponse);
				}),
			);

			renderModal({ nickname: 'TestPlayer' });

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			// Initiate
			const deleteButtons = screen.getAllByText('Delete My Account');
			await user.click(deleteButtons[deleteButtons.length - 1]);
			await user.type(screen.getAllByLabelText('Password')[0], 'mypassword123');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByText(/Type your username/)).toBeInTheDocument();
			});

			// Type wrong nickname
			await user.type(screen.getByPlaceholderText('TestPlayer'), 'WrongName');

			const permanentDeleteBtn = screen.getByText('Permanently Delete My Account');
			expect(permanentDeleteBtn).toBeDisabled();
		});

		it('successful deletion calls clearAuth', async () => {
			const user = userEvent.setup();

			server.use(
				http.delete('/api/user/delete-my-account', ({ request }) => {
					const url = new URL(request.url);
					if (url.searchParams.has('token')) {
						return new HttpResponse(null, { status: 204 });
					}
					return HttpResponse.json(mockInitiateResponse);
				}),
			);

			renderModal({ nickname: 'TestUser' });

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			// Initiate
			const deleteButtons = screen.getAllByText('Delete My Account');
			await user.click(deleteButtons[deleteButtons.length - 1]);
			await user.type(screen.getAllByLabelText('Password')[0], 'mypassword123');
			await user.click(screen.getByText('Continue'));

			// Execute
			await waitFor(() => {
				expect(screen.getByText(/Type your username/)).toBeInTheDocument();
			});

			await user.type(screen.getByPlaceholderText('TestUser'), 'TestUser');
			await user.type(screen.getAllByLabelText('Password')[0], 'mypassword123');
			await user.click(screen.getByText('Permanently Delete My Account'));

			await waitFor(() => {
				expect(screen.getByText('Account deleted')).toBeInTheDocument();
			});
		});
	});

	// ── Error handling ────────────────────────────────────────

	describe('error handling', () => {
		it('shows server error on wrong password', async () => {
			const user = userEvent.setup();

			server.use(
				http.post('/api/user/export-my-data', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: 'Invalid password' }) },
						{ status: 401 },
					);
				}),
			);

			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);

			await user.type(screen.getByLabelText('Password'), 'wrongpassword');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByText('Invalid password')).toBeInTheDocument();
			});
		});

		it('resets to idle on token expired', async () => {
			const user = userEvent.setup();

			server.use(
				http.post('/api/user/export-my-data', ({ request }) => {
					const url = new URL(request.url);
					if (url.searchParams.has('token')) {
						return HttpResponse.json(
							{ error: createMockApiError({ code: 410, brief: 'TokenExpired' }) },
							{ status: 410 },
						);
					}
					return HttpResponse.json(mockInitiateResponse);
				}),
			);

			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			// Initiate
			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);
			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.click(screen.getByText('Continue'));

			// Execute (will get token expired)
			await waitFor(() => {
				expect(screen.getByText(/Re-enter your credentials/)).toBeInTheDocument();
			});

			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.click(screen.getByText('Download My Data'));

			await waitFor(() => {
				expect(screen.getByText('Your request has expired. Please start over.')).toBeInTheDocument();
			});

			// Should be back to idle — "Export My Data" button visible again
			const exportBtnsAfter = screen.getAllByText('Export My Data');
			expect(exportBtnsAfter.length).toBeGreaterThan(1); // heading + button
		});

		it('routes back to awaiting email on EmailConfirmationPending', async () => {
			const user = userEvent.setup();

			server.use(
				http.post('/api/user/export-my-data', ({ request }) => {
					const url = new URL(request.url);
					if (url.searchParams.has('token')) {
						return HttpResponse.json(
							{ error: createMockApiError({ code: 403, brief: 'EmailConfirmationPending' }) },
							{ status: 403 },
						);
					}
					return HttpResponse.json(mockInitiateResponse);
				}),
			);

			renderModal();

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			// Initiate
			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);
			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.click(screen.getByText('Continue'));

			// Execute (will get email confirmation pending)
			await waitFor(() => {
				expect(screen.getByText(/Re-enter your credentials/)).toBeInTheDocument();
			});

			await user.type(screen.getByLabelText('Password'), 'mypassword123');
			await user.click(screen.getByText('Download My Data'));

			await waitFor(() => {
				expect(screen.getByText('Check your email')).toBeInTheDocument();
			});
		});
	});

	// ── Accessibility ─────────────────────────────────────────

	describe('accessibility', () => {
		it('sections have aria-labelledby', () => {
			renderModal();

			const exportSection = screen.getByLabelText('Export My Data');
			expect(exportSection).toBeInTheDocument();

			const deleteSection = screen.getByLabelText('Delete My Account');
			expect(deleteSection).toBeInTheDocument();
		});

		it('all inputs have associated labels', async () => {
			const user = userEvent.setup();
			renderModal({ totp_enabled: true });

			await waitFor(() => {
				expect(screen.getByText('Privacy & Data')).toBeInTheDocument();
			});

			// Open export credentials
			const exportButtons = screen.getAllByText('Export My Data');
			await user.click(exportButtons[exportButtons.length - 1]);

			expect(screen.getByLabelText('Password')).toBeInTheDocument();
			expect(screen.getByLabelText('Authentication Code')).toBeInTheDocument();
		});
	});
});
