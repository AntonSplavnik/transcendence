import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAvatar } from '../../../src/api/avatar';
import AppRoutes from '../../../src/AppRoutes';
import { AuthProvider } from '../../../src/contexts/AuthContext';
import { createMockAuthResponse, createMockSession } from '../../fixtures/users';
import { server } from '../../helpers/msw-handlers';

// ── Mocks ────────────────────────────────────────────────────────────
// Same as AppRoutes.test.tsx, EXCEPT AvatarDisplay is NOT mocked.
// We keep the real AvatarDisplay so we can verify it re-fetches data
// after ToS acceptance (the core behaviour under test).

vi.mock('../../../src/components/GameBoard', () => ({
	default: ({ onLeave }: { onLeave: () => void }) => (
		<div data-testid="game-board">
			<button onClick={onLeave}>Leave Game</button>
		</div>
	),
}));

vi.mock('../../../src/components/ui/AvatarUpload', () => ({
	default: () => <div data-testid="avatar-upload" />,
}));

// fetchAvatar is mocked so we control when it fails / succeeds.
// AvatarDisplay is real — it calls fetchAvatar and renders the result.
vi.mock('../../../src/api/avatar', () => ({
	fetchAvatar: vi.fn(),
	uploadAvatar: vi.fn().mockResolvedValue(undefined),
	deleteAvatar: vi.fn().mockResolvedValue(undefined),
}));
const mockFetchAvatar = vi.mocked(fetchAvatar);

vi.mock('../../../src/components/LandingPage', () => ({
	default: ({ onLogin }: { onLogin: () => void }) => (
		<div data-testid="landing-page">
			<button onClick={onLogin}>Login</button>
		</div>
	),
}));

vi.mock('../../../src/contexts/StreamContext', () => ({
	useStream: vi.fn(() => ({
		connectionManager: {
			registerUniHandler: vi.fn(),
			unregisterHandler: vi.fn(),
		},
		connectionState: { status: 'connected' },
	})),
}));

vi.mock('../../../src/contexts/NotificationContext', () => ({
	useNotifications: vi.fn(() => ({
		notifications: [],
		activeToasts: [],
		dismissToast: vi.fn(),
	})),
}));

vi.mock('../../../src/components/friends/FriendsDrawer', () => ({
	default: () => null,
}));

// ── Tests ────────────────────────────────────────────────────────────

describe('ToS acceptance flow', () => {
	const TOS_TIMESTAMP = '2025-06-01T00:00:00Z';

	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		localStorage.setItem('auth_hint', '1');
	});

	/**
	 * Simulate an authenticated user who has NOT accepted the current ToS.
	 *
	 * - GET  /api/user/me  → user with tos_accepted_at: null (updated after accept)
	 * - GET  /api/tos      → current_tos_timestamp newer than the user's acceptance
	 * - POST accept-tos    → flips the flag so subsequent /me calls return accepted
	 * - fetchAvatar        → rejects before acceptance, resolves after
	 */
	function setupTosNotAccepted() {
		let accepted = false;

		server.use(
			http.get('/api/user/me', () => {
				return HttpResponse.json(
					createMockAuthResponse({
						tos_accepted_at: accepted ? TOS_TIMESTAMP : null,
					}),
				);
			}),
			http.get('/api/tos', () => {
				return HttpResponse.json({ current_tos_timestamp: TOS_TIMESTAMP });
			}),
			http.post('/api/auth/session-management/accept-tos', () => {
				accepted = true;
				return HttpResponse.json(createMockSession());
			}),
		);

		mockFetchAvatar.mockImplementation(() => {
			if (!accepted) {
				return Promise.reject(new Error('TosNotAccepted'));
			}
			return Promise.resolve('blob:mock-avatar-url');
		});
	}

	const renderRoutes = (initialRoute = '/home') => {
		return render(
			<MemoryRouter initialEntries={[initialRoute]}>
				<AuthProvider>
					<AppRoutes />
				</AuthProvider>
			</MemoryRouter>,
		);
	};

	// ── Scenario 1: accept via the modal overlay on the home page ────

	describe('accept via modal on home page', () => {
		it('shows the ToS modal when user has not accepted current ToS', async () => {
			setupTosNotAccepted();
			renderRoutes('/home');

			await waitFor(() => {
				expect(screen.getByText('I accept the Terms of Service')).toBeInTheDocument();
			});

			// Home page content is rendered underneath the modal
			expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
		});

		it('hides modal and reloads data that previously failed', async () => {
			setupTosNotAccepted();
			renderRoutes('/home');
			const user = userEvent.setup();

			// Wait for the modal to appear
			await waitFor(() => {
				expect(screen.getByText('I accept the Terms of Service')).toBeInTheDocument();
			});

			// Before acceptance: avatars failed to load, so AvatarDisplay shows
			// the fallback icon (role="img" div), not an <img> element.
			const avatarImgsBefore = screen
				.queryAllByRole('img', { name: 'User avatar' })
				.filter((el) => el.tagName === 'IMG');
			expect(avatarImgsBefore).toHaveLength(0);

			const callsBefore = mockFetchAvatar.mock.calls.length;

			// Click "I accept the Terms of Service" in the modal
			await user.click(screen.getByText('I accept the Terms of Service'));

			// Modal disappears
			await waitFor(() => {
				expect(screen.queryByText('I accept the Terms of Service')).not.toBeInTheDocument();
			});

			// Still on the home page
			expect(screen.getByText('Player Dashboard')).toBeInTheDocument();

			// After acceptance: avatar <img> elements should appear, meaning
			// AvatarDisplay successfully re-fetched the avatar data.
			await waitFor(() => {
				const avatarImgsAfter = screen
					.getAllByRole('img', { name: 'User avatar' })
					.filter((el) => el.tagName === 'IMG');
				expect(avatarImgsAfter.length).toBeGreaterThan(0);
			});

			// fetchAvatar was called again after acceptance (components re-fetched)
			expect(mockFetchAvatar.mock.calls.length).toBeGreaterThan(callsBefore);
		});
	});

	// ── Scenario 2: accept on the full /terms page ───────────────────

	describe('accept via terms page', () => {
		it('navigates to /home and loads avatars after accepting on terms page', async () => {
			setupTosNotAccepted();
			renderRoutes('/home');
			const user = userEvent.setup();

			// Wait for the modal
			await waitFor(() => {
				expect(screen.getByText('I accept the Terms of Service')).toBeInTheDocument();
			});

			// Click the link inside the modal to navigate to /terms
			await user.click(screen.getByText('Terms of Service page'));

			// Should now be on the full Terms of Service page
			await waitFor(() => {
				expect(screen.getByText(/Who Can Use This Service/)).toBeInTheDocument();
			});

			// The inline accept button should be visible
			expect(screen.getByText('I Accept')).toBeInTheDocument();

			// Click accept on the terms pageat weird, TosGate is ON TOP of the Realtime StatusOverlays and the ErrorBanner? so it blurrs these too... maybe errorBanner should be on top of that? or was it intentional that TosGate in on top of all these?
			await user.click(screen.getByText('I Accept'));

			// Should navigate to /home
			await waitFor(() => {
				expect(screen.getByText('Player Dashboard')).toBeInTheDocument();
			});

			// Avatar images should render (Home re-mounted → fresh fetch)
			await waitFor(() => {
				const avatarImgs = screen
					.getAllByRole('img', { name: 'User avatar' })
					.filter((el) => el.tagName === 'IMG');
				expect(avatarImgs.length).toBeGreaterThan(0);
			});
		});
	});
});
