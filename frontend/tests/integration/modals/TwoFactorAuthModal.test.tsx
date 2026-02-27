import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/render';
import TwoFactorModal from '../../../src/components/modals/TwoFactorAuthModal';
import { server } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockUser, createMockAuthResponse } from '../../fixtures/users';
import { createMockApiError } from '../../fixtures/errors';
import type { TwoFactorStartResponse, TwoFactorConfirmResponse } from '../../../src/api/types';

describe('TwoFactorAuthModal', () => {
	const mockOnClose = vi.fn();
	const mockOnSuccess = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderModal = (totpEnabled = false) => {
		const user = createMockUser({ totp_enabled: totpEnabled });
		return render(
			<TwoFactorModal
				user={user}
				onClose={mockOnClose}
				onSuccess={mockOnSuccess}
			/>
		);
	};

	describe('initial state (confirm step)', () => {
		it('shows current 2FA status - disabled', () => {
			renderModal(false);

			expect(screen.getByText('Disabled')).toBeInTheDocument();
			expect(screen.getByText('Enable 2FA')).toBeInTheDocument();
		});

		it('shows current 2FA status - enabled', () => {
			renderModal(true);

			expect(screen.getByText('Enabled')).toBeInTheDocument();
			expect(screen.getByText('Disable 2FA')).toBeInTheDocument();
		});

		it('calls onClose when Cancel clicked', async () => {
			const user = userEvent.setup();
			renderModal();

			await user.click(screen.getByText('Cancel'));

			expect(mockOnClose).toHaveBeenCalled();
		});
	});

	describe('enable 2FA flow', () => {
		it('progresses to password step when Enable 2FA clicked', async () => {
			const user = userEvent.setup();
			renderModal(false);

			await user.click(screen.getByText('Enable 2FA'));

			expect(screen.getByText(/Enter your password/)).toBeInTheDocument();
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
		});

		it('shows error when password is empty', async () => {
			const user = userEvent.setup();
			renderModal(false);

			await user.click(screen.getByText('Enable 2FA'));
			await user.click(screen.getByText('Continue'));

			expect(screen.getByText('Password is required.')).toBeInTheDocument();
		});

		it('generates QR code on successful password entry', async () => {
			const startResponse: TwoFactorStartResponse = {
				base32_secret: 'JBSWY3DPEHPK3PXP',
				qr_base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
				url: 'otpauth://totp/Test:test@example.com?secret=JBSWY3DPEHPK3PXP',
			};

			server.use(
				http.post('/api/user/2fa/start', () => {
					return HttpResponse.json(startResponse);
				})
			);

			const user = userEvent.setup();
			renderModal(false);

			await user.click(screen.getByText('Enable 2FA'));
			await user.type(screen.getByLabelText('Password'), 'password123');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByText(/Scan this QR code/)).toBeInTheDocument();
				expect(screen.getByAltText('QR code for two-factor authentication setup')).toBeInTheDocument();
			});
		});

		it('shows error for invalid password on start', async () => {
			server.use(
				http.post('/api/user/2fa/start', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: null }) },
						{ status: 401 }
					);
				})
			);

			const user = userEvent.setup();
			renderModal(false);

			await user.click(screen.getByText('Enable 2FA'));
			await user.type(screen.getByLabelText('Password'), 'wrongpassword');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
			});
		});

		it('shows verification code input after QR generation', async () => {
			server.use(
				http.post('/api/user/2fa/start', () => {
					return HttpResponse.json({
						base32_secret: 'TEST',
						qr_base64: 'TEST',
						url: 'otpauth://test',
					});
				})
			);

			const user = userEvent.setup();
			renderModal(false);

			await user.click(screen.getByText('Enable 2FA'));
			await user.type(screen.getByLabelText('Password'), 'password123');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
			});
		});

		it('shows recovery codes after successful verification', async () => {
			const confirmResponse: TwoFactorConfirmResponse = {
				recovery_codes: ['AAAA-BBBB', 'CCCC-DDDD', 'EEEE-FFFF'],
			};

			server.use(
				http.post('/api/user/2fa/start', () => {
					return HttpResponse.json({
						base32_secret: 'TEST',
						qr_base64: 'TEST',
						url: 'otpauth://test',
					});
				}),
				http.post('/api/user/2fa/confirm', () => {
					return HttpResponse.json(confirmResponse);
				}),
				http.get('/api/user/me', () => {
					return HttpResponse.json(createMockAuthResponse({ totp_enabled: true }));
				})
			);

			const user = userEvent.setup();
			renderModal(false);

			// Navigate to QR step
			await user.click(screen.getByText('Enable 2FA'));
			await user.type(screen.getByLabelText('Password'), 'password123');
			await user.click(screen.getByText('Continue'));

			// Wait for verify step
			await waitFor(() => {
				expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
			});

			// Enter verification code
			await user.type(screen.getByLabelText('Verification Code'), '123456');
			await user.click(screen.getByText('Confirm'));

			// Should show recovery codes
			await waitFor(() => {
				expect(screen.getByText('Save Your Recovery Codes')).toBeInTheDocument();
				expect(screen.getByText('AAAA-BBBB')).toBeInTheDocument();
				expect(screen.getByText('CCCC-DDDD')).toBeInTheDocument();
				expect(screen.getByText('EEEE-FFFF')).toBeInTheDocument();
			});
		});

		it('copies recovery codes to clipboard', async () => {
			server.use(
				http.post('/api/user/2fa/start', () => {
					return HttpResponse.json({
						base32_secret: 'TEST',
						qr_base64: 'TEST',
						url: 'otpauth://test',
					});
				}),
				http.post('/api/user/2fa/confirm', () => {
					return HttpResponse.json({ recovery_codes: ['CODE1', 'CODE2'] });
				}),
				http.get('/api/user/me', () => {
					return HttpResponse.json(createMockAuthResponse({ totp_enabled: true }));
				})
			);

			const user = userEvent.setup();
			renderModal(false);

			// Navigate through steps
			await user.click(screen.getByText('Enable 2FA'));
			await user.type(screen.getByLabelText('Password'), 'password');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
			});

			await user.type(screen.getByLabelText('Verification Code'), '123456');
			await user.click(screen.getByText('Confirm'));

			await waitFor(() => {
				expect(screen.getByText('Copy')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Copy'));

			// After clicking copy, we should see the "Copied!" text
			await waitFor(() => {
				expect(screen.getByText('Copied!')).toBeInTheDocument();
			});
		});

		it('calls onSuccess when Done clicked', async () => {
			server.use(
				http.post('/api/user/2fa/start', () => {
					return HttpResponse.json({
						base32_secret: 'TEST',
						qr_base64: 'TEST',
						url: 'otpauth://test',
					});
				}),
				http.post('/api/user/2fa/confirm', () => {
					return HttpResponse.json({ recovery_codes: ['CODE1'] });
				}),
				http.get('/api/user/me', () => {
					return HttpResponse.json(createMockAuthResponse({ totp_enabled: true }));
				})
			);

			const user = userEvent.setup();
			renderModal(false);

			await user.click(screen.getByText('Enable 2FA'));
			await user.type(screen.getByLabelText('Password'), 'password');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByLabelText('Verification Code')).toBeInTheDocument();
			});

			await user.type(screen.getByLabelText('Verification Code'), '123456');
			await user.click(screen.getByText('Confirm'));

			await waitFor(() => {
				expect(screen.getByText('Done')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Done'));

			expect(mockOnSuccess).toHaveBeenCalled();
		});
	});

	describe('disable 2FA flow', () => {
		it('shows disable step with password and MFA inputs', async () => {
			const user = userEvent.setup();
			renderModal(true);

			await user.click(screen.getByText('Disable 2FA'));

			expect(screen.getByText(/Enter your password and current 2FA code/)).toBeInTheDocument();
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
			expect(screen.getByLabelText('Authentication Code')).toBeInTheDocument();
		});

		it('requires both password and MFA code', async () => {
			const user = userEvent.setup();
			renderModal(true);

			await user.click(screen.getByText('Disable 2FA'));
			await user.click(screen.getByRole('button', { name: 'Disable 2FA' }));

			// Empty password shows field-level error
			expect(screen.getByText('Password is required.')).toBeInTheDocument();
		});

		it('calls onSuccess after successful disable', async () => {
			server.use(
				http.post('/api/user/2fa/disable', () => {
					return new HttpResponse(null, { status: 204 });
				}),
				http.get('/api/user/me', () => {
					return HttpResponse.json(createMockAuthResponse({ totp_enabled: false }));
				})
			);

			const user = userEvent.setup();
			renderModal(true);

			await user.click(screen.getByText('Disable 2FA'));
			await user.type(screen.getByLabelText('Password'), 'password');
			await user.type(screen.getByLabelText('Authentication Code'), '123456');
			await user.click(screen.getByRole('button', { name: 'Disable 2FA' }));

			await waitFor(() => {
				expect(mockOnSuccess).toHaveBeenCalled();
			});
		});

		it('shows error on disable failure', async () => {
			server.use(
				http.post('/api/user/2fa/disable', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: null }) },
						{ status: 401 }
					);
				})
			);

			const user = userEvent.setup();
			renderModal(true);

			await user.click(screen.getByText('Disable 2FA'));
			await user.type(screen.getByLabelText('Password'), 'wrongpass');
			await user.type(screen.getByLabelText('Authentication Code'), '123456');
			await user.click(screen.getByRole('button', { name: 'Disable 2FA' }));

			await waitFor(() => {
				expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
			});
		});

		it('can go back from disable step', async () => {
			const user = userEvent.setup();
			renderModal(true);

			await user.click(screen.getByText('Disable 2FA'));
			await user.click(screen.getByText('Back'));

			expect(screen.getByText('Current Status')).toBeInTheDocument();
		});
	});

	describe('navigation', () => {
		it('can navigate back from password step', async () => {
			const user = userEvent.setup();
			renderModal(false);

			await user.click(screen.getByText('Enable 2FA'));
			expect(screen.getByLabelText('Password')).toBeInTheDocument();

			await user.click(screen.getByText('Back'));

			expect(screen.getByText('Current Status')).toBeInTheDocument();
		});
	});
});
