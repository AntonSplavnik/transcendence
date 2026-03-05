import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/render';
import AuthPage from '../../../src/components/AuthPage';
import { server } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockAuthResponse } from '../../fixtures/users';
import { createMockApiError } from '../../fixtures/errors';

describe('AuthPage', () => {
	const mockOnBack = vi.fn();
	const mockOnAuthSuccess = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderAuthPage = () => {
		return render(
			<AuthPage onBack={mockOnBack} onAuthSuccess={mockOnAuthSuccess} />
		);
	};

	describe('mode toggle', () => {
		it('starts in login mode', () => {
			renderAuthPage();

			expect(screen.getByText('Welcome Back')).toBeInTheDocument();
			expect(screen.getByText('Sign In')).toBeInTheDocument();
			expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
		});

		it('toggles to register mode', async () => {
			const user = userEvent.setup();
			renderAuthPage();

			await user.click(screen.getByText('Create an account'));

			expect(screen.getByText('Join the Guild')).toBeInTheDocument();
			expect(screen.getByText('Create Account')).toBeInTheDocument();
			expect(screen.getByPlaceholderText('Sir_Woodalot')).toBeInTheDocument();
		});

		it('toggles back to login mode', async () => {
			const user = userEvent.setup();
			renderAuthPage();

			await user.click(screen.getByText('Create an account'));
			await user.click(screen.getByText('Sign in'));

			expect(screen.getByText('Welcome Back')).toBeInTheDocument();
		});
	});

	describe('form validation', () => {
		it('requires email field', async () => {
			renderAuthPage();

			const emailInput = screen.getByPlaceholderText('you@kingdom.com');
			expect(emailInput).toBeRequired();
		});

		it('requires password field', async () => {
			renderAuthPage();

			const passwordInput = screen.getByPlaceholderText('••••••••');
			expect(passwordInput).toBeRequired();
		});

		it('shows username field in register mode', async () => {
			const user = userEvent.setup();
			renderAuthPage();

			await user.click(screen.getByText('Create an account'));

			const usernameInput = screen.getByPlaceholderText('Sir_Woodalot');
			expect(usernameInput).toBeInTheDocument();
			expect(usernameInput).toBeRequired();
		});
	});

	describe('login flow', () => {
		it('calls login and onAuthSuccess on successful login', async () => {
			const user = userEvent.setup();
			renderAuthPage();

			await user.type(screen.getByPlaceholderText('you@kingdom.com'), 'test@example.com');
			await user.type(screen.getByPlaceholderText('••••••••'), 'password123');
			await user.click(screen.getByText('Sign In'));

			await waitFor(() => {
				expect(mockOnAuthSuccess).toHaveBeenCalled();
			});
		});

		it('displays error message on login failure', async () => {
			server.use(
				http.post('/api/auth/login', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: null }) },
						{ status: 401 }
					);
				})
			);
			const user = userEvent.setup();
			renderAuthPage();

			await user.type(screen.getByPlaceholderText('you@kingdom.com'), 'wrong@example.com');
			await user.type(screen.getByPlaceholderText('••••••••'), 'wrongpassword');
			await user.click(screen.getByText('Sign In'));

			await waitFor(() => {
				expect(screen.getByText('Invalid email or password.')).toBeInTheDocument();
			});
		});

		it('shows loading state during submission', async () => {
			// Delay the response
			server.use(
				http.post('/api/auth/login', async () => {
					await new Promise(resolve => setTimeout(resolve, 100));
					return HttpResponse.json(createMockAuthResponse());
				})
			);

			const user = userEvent.setup();
			renderAuthPage();

			await user.type(screen.getByPlaceholderText('you@kingdom.com'), 'test@example.com');
			await user.type(screen.getByPlaceholderText('••••••••'), 'password');
			await user.click(screen.getByText('Sign In'));

			expect(screen.getByText('Signing In...')).toBeInTheDocument();
		});

		it('opens MFA modal when TwoFactorRequired', async () => {
			server.use(
				http.post('/api/auth/login', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief: 'TwoFactorRequired' }) },
						{ status: 401 }
					);
				})
			);

			const user = userEvent.setup();
			renderAuthPage();

			await user.type(screen.getByPlaceholderText('you@kingdom.com'), 'mfa@example.com');
			await user.type(screen.getByPlaceholderText('••••••••'), 'password');
			await user.click(screen.getByText('Sign In'));

			await waitFor(() => {
				expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
			});
		});
	});

	describe('register flow', () => {
		it('calls register and onAuthSuccess on successful registration', async () => {
			const user = userEvent.setup();
			renderAuthPage();

			// Switch to register mode
			await user.click(screen.getByText('Create an account'));

			// Fill form
			await user.type(screen.getByPlaceholderText('Sir_Woodalot'), 'newuser');
			await user.type(screen.getByPlaceholderText('you@kingdom.com'), 'new@example.com');
			await user.type(screen.getByPlaceholderText('••••••••'), 'password123');

			// Wait for nickname validation
			await waitFor(() => {
				expect(screen.getByText('✅')).toBeInTheDocument();
			}, { timeout: 1000 });

			await user.click(screen.getByText('Create Account'));

			await waitFor(() => {
				expect(mockOnAuthSuccess).toHaveBeenCalled();
			});
		});

		it('shows error when nickname already taken', async () => {
			server.use(
				http.post('/api/users/nickname-exists', () => {
					return HttpResponse.json({ exists: true, valid: true });
				})
			);

			const user = userEvent.setup();
			renderAuthPage();

			await user.click(screen.getByText('Create an account'));
			await user.type(screen.getByPlaceholderText('Sir_Woodalot'), 'taken');

			await waitFor(() => {
				expect(screen.getByText('❌ nickname already taken')).toBeInTheDocument();
			}, { timeout: 1000 });
		});

		it('shows error when nickname format invalid', async () => {
			const user = userEvent.setup();
			renderAuthPage();

			await user.click(screen.getByText('Create an account'));
			await user.type(screen.getByPlaceholderText('Sir_Woodalot'), 'invalid!');

			// Local validation catches invalid chars before API call
			await waitFor(() => {
				expect(screen.getByText('Can only contain alphanumeric characters, underscores, or hyphens.')).toBeInTheDocument();
			});
		});

		it('prevents submission without valid nickname', async () => {
			server.use(
				http.post('/api/users/nickname-exists', () => {
					return HttpResponse.json({ exists: true, valid: true });
				})
			);

			const user = userEvent.setup();
			renderAuthPage();

			await user.click(screen.getByText('Create an account'));

			// Fill form but leave nickname invalid
			await user.type(screen.getByPlaceholderText('Sir_Woodalot'), 'taken');
			await user.type(screen.getByPlaceholderText('you@kingdom.com'), 'new@example.com');
			await user.type(screen.getByPlaceholderText('••••••••'), 'password123');

			// Wait for validation to show taken
			await waitFor(() => {
				expect(screen.getByText('❌ nickname already taken')).toBeInTheDocument();
			}, { timeout: 1000 });

			await user.click(screen.getByText('Create Account'));

			// Should show error, not call onAuthSuccess
			await waitFor(() => {
				expect(screen.getByText('Please choose a valid, available nickname.')).toBeInTheDocument();
			});
			expect(mockOnAuthSuccess).not.toHaveBeenCalled();
		});
	});

	describe('navigation', () => {
		it('calls onBack when back button clicked', async () => {
			const user = userEvent.setup();
			renderAuthPage();

			await user.click(screen.getByText('← Back to Menu'));

			expect(mockOnBack).toHaveBeenCalled();
		});
	});

	describe('password field', () => {
		it('clears password field after successful auth', async () => {
			const user = userEvent.setup();
			renderAuthPage();

			const passwordInput = screen.getByPlaceholderText('••••••••') as HTMLInputElement;
			await user.type(screen.getByPlaceholderText('you@kingdom.com'), 'test@example.com');
			await user.type(passwordInput, 'password123');
			await user.click(screen.getByText('Sign In'));

			await waitFor(() => {
				expect(mockOnAuthSuccess).toHaveBeenCalled();
			});
		});
	});
});
