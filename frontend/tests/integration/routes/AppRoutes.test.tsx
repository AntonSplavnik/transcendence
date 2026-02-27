import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../../src/contexts/AuthContext';
import AppRoutes from '../../../src/AppRoutes';
import { server, mockUnauthenticatedUser } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockAuthResponse } from '../../fixtures/users';
import { createMockStoredError } from '../../fixtures/errors';

// Mock the GameBoard component to avoid Babylon.js issues
vi.mock('../../../src/components/GameBoard', () => ({
	default: ({ onLeave }: { onLeave: () => void }) => (
		<div data-testid="game-board">
			<button onClick={onLeave}>Leave Game</button>
		</div>
	),
}));

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

// Mock LandingPage
vi.mock('../../../src/components/LandingPage', () => ({
	default: ({ onLogin }: { onLogin: () => void }) => (
		<div data-testid="landing-page">
			<button onClick={onLogin}>Login</button>
		</div>
	),
}));

describe('AppRoutes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	const renderRoutes = (initialRoute = '/landing') => {
		return render(
			<MemoryRouter initialEntries={[initialRoute]}>
				<AuthProvider>
					<AppRoutes />
				</AuthProvider>
			</MemoryRouter>
		);
	};

	describe('ProtectedRoute', () => {
		it('redirects to /auth when unauthenticated', async () => {
			mockUnauthenticatedUser();
			renderRoutes('/home');

			await waitFor(() => {
				// Should redirect to auth page
				expect(screen.getByText('Welcome Back')).toBeInTheDocument();
			});
		});

		it('renders children when authenticated', async () => {
			server.use(
				http.get('/api/user/me', () => {
					return HttpResponse.json(createMockAuthResponse());
				})
			);
			renderRoutes('/home');

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});
		});
	});

	describe('PublicRoute', () => {
		it('redirects to /home when authenticated', async () => {
			server.use(
				http.get('/api/user/me', () => {
					return HttpResponse.json(createMockAuthResponse());
				})
			);
			renderRoutes('/landing');

			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});
		});

		it('renders children when unauthenticated', async () => {
			mockUnauthenticatedUser();
			renderRoutes('/landing');

			await waitFor(() => {
				expect(screen.getByTestId('landing-page')).toBeInTheDocument();
			});
		});

		it('shows auth page when unauthenticated at /auth', async () => {
			mockUnauthenticatedUser();
			renderRoutes('/auth');

			await waitFor(() => {
				expect(screen.getByText('Welcome Back')).toBeInTheDocument();
			});
		});
	});

	describe('authChecked gate', () => {
		it('shows nothing while auth is being checked', () => {
			// Set up a delayed response
			server.use(
				http.get('/api/user/me', async () => {
					await new Promise(resolve => setTimeout(resolve, 1000));
					return HttpResponse.json(createMockAuthResponse());
				})
			);

			renderRoutes('/home');

			// During auth check, should not show protected content
			expect(screen.queryByText('Player Dashboard')).not.toBeInTheDocument();
			// Also should not show auth page redirect yet
			expect(screen.queryByText('Welcome Back')).not.toBeInTheDocument();
		});
	});

	describe('ErrorBanner', () => {
		it('displays stored errors on mount', async () => {
			const storedError = createMockStoredError({
				type: 'test_error',
				message: 'Test error message',
			});
			localStorage.setItem('auth_error', JSON.stringify(storedError));

			mockUnauthenticatedUser();
			renderRoutes('/landing');

			await waitFor(() => {
				expect(screen.getByText('Test error message')).toBeInTheDocument();
			});
		});

		it('does not display expired errors', async () => {
			const oldError = createMockStoredError({
				type: 'old_error',
				message: 'Old error message',
				timestamp: Date.now() - 2 * 60 * 1000, // 2 minutes ago
			});
			localStorage.setItem('auth_error', JSON.stringify(oldError));

			mockUnauthenticatedUser();
			renderRoutes('/landing');

			await waitFor(() => {
				expect(screen.getByTestId('landing-page')).toBeInTheDocument();
			});

			expect(screen.queryByText('Old error message')).not.toBeInTheDocument();
		});
	});

	describe('sessions route', () => {
		it('renders SessionManagement at /sessions when authenticated', async () => {
			server.use(
				http.get('/api/user/me', () => {
					return HttpResponse.json(createMockAuthResponse());
				})
			);
			renderRoutes('/sessions');

			await waitFor(() => {
				expect(screen.getByText('Session Management')).toBeInTheDocument();
			});
		});

		it('redirects to /auth when unauthenticated', async () => {
			mockUnauthenticatedUser();
			renderRoutes('/sessions');

			await waitFor(() => {
				expect(screen.getByText('Welcome Back')).toBeInTheDocument();
			});
		});
	});

	describe('navigation', () => {
		it('redirects unknown routes to /landing', async () => {
			mockUnauthenticatedUser();
			renderRoutes('/unknown-route');

			await waitFor(() => {
				expect(screen.getByTestId('landing-page')).toBeInTheDocument();
			});
		});
	});
});
