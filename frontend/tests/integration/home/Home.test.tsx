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
// Mock lobby modals to avoid context/API dependencies
vi.mock('../../../src/components/modals/LobbyListModal', () => ({
	default: ({ onClose }: { onClose: () => void }) => (
		<div data-testid="lobby-list-modal"><button onClick={onClose}>Close</button></div>
	),
}));

describe('Home', () => {
	const mockOnLogout = vi.fn();
	const mockOnSessions = vi.fn();

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

		return render(<Home onLogout={mockOnLogout} onSessions={mockOnSessions} />);
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
			expect(screen.getByText('Manage Sessions')).toBeInTheDocument();
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
		it('opens lobby list when Find Public Game clicked with valid session', async () => {
			const user = userEvent.setup();

			// Session with plenty of time remaining
			const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
			renderHome({}, { access_expiry: futureExpiry });

			await waitFor(() => {
				expect(screen.getByText('Find Public Game')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Find Public Game'));

			await waitFor(() => {
				expect(screen.getByTestId('lobby-list-modal')).toBeInTheDocument();
			});
		});

		it('opens ReauthModal when session near expiry (<60 min)', async () => {
			const user = userEvent.setup();

			// Login session expiring soon (reauth checks login_expiry, threshold is 60 min)
			const nearExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
			renderHome({}, { login_expiry: nearExpiry });

			await waitFor(() => {
				expect(screen.getByText('Find Public Game')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Find Public Game'));

			// Should show reauth modal instead of opening lobby list
			expect(screen.queryByTestId('lobby-list-modal')).not.toBeInTheDocument();
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

	describe('privacy & data modal', () => {
		it('opens DataPrivacyModal from menu', async () => {
			const user = userEvent.setup();
			renderHome();

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			// Open menu
			await user.click(screen.getByRole('button', { name: /TestUser/i }));
			await user.click(screen.getByText('Privacy & Data'));

			await waitFor(() => {
				expect(screen.getByRole('heading', { name: 'Export My Data' })).toBeInTheDocument();
				expect(screen.getByRole('heading', { name: 'Delete My Account' })).toBeInTheDocument();
			});
		});
	});

	describe('manage sessions', () => {
		it('calls onSessions from menu', async () => {
			const user = userEvent.setup();
			renderHome();

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			// Open menu
			await user.click(screen.getByRole('button', { name: /TestUser/i }));
			await user.click(screen.getByText('Manage Sessions'));

			expect(mockOnSessions).toHaveBeenCalled();
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
		it('shows loading while auth data is being fetched', async () => {
			// Delay the auth response
			server.use(
				http.get('/api/user/me', async () => {
					await new Promise(resolve => setTimeout(resolve, 1000));
					return HttpResponse.json(createMockAuthResponse());
				})
			);

			render(<Home onLogout={mockOnLogout} onSessions={mockOnSessions} />);

			// Should show loading initially
			expect(screen.getByText('Loading...')).toBeInTheDocument();

			// Drain the delayed response before test exits
			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			}, { timeout: 2000 });
		});
	});

	describe('reauth modal flow', () => {
		it('opens lobby list after successful reauth', async () => {
			const user = userEvent.setup();

			const nearExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			const authResponse = createMockAuthResponse({}, { login_expiry: nearExpiry });

			server.use(
				http.get('/api/user/me', () => {
					return HttpResponse.json(authResponse);
				}),
				http.post('/api/auth/session-management/reauth', () => {
					return HttpResponse.json(createMockAuthResponse());
				})
			);

			render(<Home onLogout={mockOnLogout} onSessions={mockOnSessions} />);

			await waitFor(() => {
				expect(screen.getByText('Find Public Game')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Find Public Game'));

			await waitFor(() => {
				expect(screen.getByText('Re-authenticate')).toBeInTheDocument();
			});

			await user.type(screen.getByLabelText('Password'), 'password');
			await user.click(screen.getByText('Continue'));

			await waitFor(() => {
				expect(screen.getByTestId('lobby-list-modal')).toBeInTheDocument();
			});
		});

		it('closes reauth modal on cancel', async () => {
			const user = userEvent.setup();

			const nearExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
			renderHome({}, { login_expiry: nearExpiry });

			await waitFor(() => {
				expect(screen.getByText('Find Public Game')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Find Public Game'));

			await waitFor(() => {
				expect(screen.getByText('Re-authenticate')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Cancel'));

			await waitFor(() => {
				expect(screen.queryByText('Re-authenticate')).not.toBeInTheDocument();
			});

			expect(screen.queryByTestId('lobby-list-modal')).not.toBeInTheDocument();
		});
	});
});
