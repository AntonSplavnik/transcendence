import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/render';
import Home from '../../../src/components/Home';
import { server } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockAuthResponse } from '../../fixtures/users';

// Mock Avatar components to avoid XHR/ProgressEvent issues in jsdom
vi.mock('../../../src/components/ui/AvatarDisplay', () => ({
	default: () => <div data-testid="avatar-display" />,
}));
vi.mock('../../../src/components/ui/AvatarUpload', () => ({
	default: () => <div data-testid="avatar-upload" />,
}));
// Mock fetchAvatar so Home's useEffect doesn't trigger real XHR requests
vi.mock('../../../src/api/avatar', () => ({
	fetchAvatar: vi.fn().mockResolvedValue('blob:mock-avatar-url'),
	uploadAvatar: vi.fn().mockResolvedValue(undefined),
	deleteAvatar: vi.fn().mockResolvedValue(undefined),
}));

describe('Home', () => {
	const mockOnGame = vi.fn();
	const mockOnLogout = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderHome = (userOverrides = {}, sessionOverrides = {}) => {
		const authResponse = createMockAuthResponse(userOverrides, sessionOverrides);

		server.use(
			http.get('/api/user/me', () => {
				return HttpResponse.json(authResponse);
			})
		);

		return render(<Home onGame={mockOnGame} onLogout={mockOnLogout} />);
	};

	describe('user info display', () => {
		it('shows user nickname in welcome message', async () => {
			renderHome({ nickname: 'TestPlayer' });

			await waitFor(() => {
				expect(screen.getByText(/Welcome back, TestPlayer/)).toBeInTheDocument();
			});
		});

		it('shows user email in stats', async () => {
			renderHome({ email: 'player@test.com' });

			await waitFor(() => {
				expect(screen.getByText('player@test.com')).toBeInTheDocument();
			});
		});

		it('shows 2FA enabled status', async () => {
			renderHome({ totp_enabled: true });

			await waitFor(() => {
				const badge = screen.getByText('Enabled');
				expect(badge).toBeInTheDocument();
				expect(badge.closest('[role="status"]')).toBeInTheDocument();
			});
		});

		it('shows 2FA disabled status', async () => {
			renderHome({ totp_enabled: false });

			await waitFor(() => {
				const badge = screen.getByText('Disabled');
				expect(badge).toBeInTheDocument();
				expect(badge.closest('[role="status"]')).toBeInTheDocument();
			});
		});
	});

	describe('dropdown menu', () => {
		it('toggles menu on click', async () => {
			const user = userEvent.setup();
			renderHome();

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			// Menu should be closed initially
			expect(screen.queryByText('Two-Factor Auth')).not.toBeInTheDocument();

			// Open menu
			await user.click(screen.getByRole('button', { name: /TestUser/i }));

			expect(screen.getByText('Two-Factor Auth')).toBeInTheDocument();
			expect(screen.getByText('Session Details')).toBeInTheDocument();
			expect(screen.getByText('Log Out')).toBeInTheDocument();
		});

		it('closes menu when clicking outside', async () => {
			const user = userEvent.setup();
			renderHome();

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			// Open menu
			await user.click(screen.getByRole('button', { name: /TestUser/i }));
			expect(screen.getByText('Two-Factor Auth')).toBeInTheDocument();

			// Click outside — Dropdown uses document mousedown listener
			await user.click(document.body);

			expect(screen.queryByText('Two-Factor Auth')).not.toBeInTheDocument();
		});
	});

	describe('play game button', () => {
		it('calls onGame when session is valid (>30 min remaining)', async () => {
			const user = userEvent.setup();

			// Session with plenty of time remaining
			const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
			renderHome({}, { access_expiry: futureExpiry });

			await waitFor(() => {
				expect(screen.getByText('Play a Match')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Play a Match'));

			expect(mockOnGame).toHaveBeenCalled();
		});

		it('opens ReauthModal when session near expiry (<30 min)', async () => {
			const user = userEvent.setup();

			// Session expiring soon
			const nearExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
			renderHome({}, { access_expiry: nearExpiry });

			await waitFor(() => {
				expect(screen.getByText('Play a Match')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Play a Match'));

			// Should show reauth modal instead of calling onGame
			expect(mockOnGame).not.toHaveBeenCalled();
			await waitFor(() => {
				expect(screen.getByText('Re-authenticate')).toBeInTheDocument();
			});
		});
	});

	describe('2FA settings modal', () => {
		it('opens 2FA modal from menu', async () => {
			const user = userEvent.setup();
			renderHome();

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			// Open menu
			await user.click(screen.getByRole('button', { name: /TestUser/i }));
			await user.click(screen.getByText('Two-Factor Auth'));

			await waitFor(() => {
				expect(screen.getByText('Current Status')).toBeInTheDocument();
			});
		});

		it('shows active indicator when 2FA enabled', async () => {
			const user = userEvent.setup();
			renderHome({ totp_enabled: true });

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			await user.click(screen.getByRole('button', { name: /TestUser/i }));

			expect(screen.getByText('Active')).toBeInTheDocument();
		});
	});

	describe('session details modal', () => {
		it('opens session details modal from menu', async () => {
			const user = userEvent.setup();
			renderHome();

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			// Open menu
			await user.click(screen.getByRole('button', { name: /TestUser/i }));
			await user.click(screen.getByText('Session Details'));

			await waitFor(() => {
				expect(screen.getByText('Session ID')).toBeInTheDocument();
			});
		});
	});

	describe('logout', () => {
		it('calls onLogout from menu', async () => {
			const user = userEvent.setup();
			renderHome();

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			// Open menu
			await user.click(screen.getByRole('button', { name: /TestUser/i }));
			await user.click(screen.getByText('Log Out'));

			expect(mockOnLogout).toHaveBeenCalled();
		});
	});

	describe('loading state', () => {
		it('shows loading while auth data is being fetched', () => {
			// Delay the auth response
			server.use(
				http.get('/api/user/me', async () => {
					await new Promise(resolve => setTimeout(resolve, 1000));
					return HttpResponse.json(createMockAuthResponse());
				})
			);

			render(<Home onGame={mockOnGame} onLogout={mockOnLogout} />);

			// Should show loading initially
			expect(screen.getByText('Loading...')).toBeInTheDocument();
		});
	});

	describe('reauth modal flow', () => {
		it('calls onGame after successful reauth', async () => {
			const user = userEvent.setup();

			const nearExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			const authResponse = createMockAuthResponse({}, { access_expiry: nearExpiry });

			server.use(
				http.get('/api/user/me', () => {
					return HttpResponse.json(authResponse);
				}),
				http.post('/api/auth/session-management/reauth', () => {
					return HttpResponse.json(createMockAuthResponse());
				})
			);

			render(<Home onGame={mockOnGame} onLogout={mockOnLogout} />);

			await waitFor(() => {
				expect(screen.getByText('Play a Match')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Play a Match'));

			await waitFor(() => {
				expect(screen.getByText('Re-authenticate')).toBeInTheDocument();
			});

			await user.type(screen.getByLabelText('Password'), 'password');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(mockOnGame).toHaveBeenCalled();
			});
		});

		it('closes reauth modal on cancel', async () => {
			const user = userEvent.setup();

			const nearExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			renderHome({}, { access_expiry: nearExpiry });

			await waitFor(() => {
				expect(screen.getByText('Play a Match')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Play a Match'));

			await waitFor(() => {
				expect(screen.getByText('Re-authenticate')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Cancel'));

			await waitFor(() => {
				expect(screen.queryByText('Re-authenticate')).not.toBeInTheDocument();
			});

			expect(mockOnGame).not.toHaveBeenCalled();
		});
	});
});
