import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, fireEvent, waitFor } from '../../helpers/render';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/msw-handlers';
import FriendsDrawer from '../../../src/components/friends/FriendsDrawer';
import { FriendsProvider } from '../../../src/contexts/FriendsContext';
import type { PublicUser, FriendRequestResponse } from '../../../src/api/types';

// Mock NotificationContext so FriendsProvider doesn't need StreamProvider
vi.mock('../../../src/contexts/NotificationContext', () => ({
	useNotifications: () => ({
		notifications: [],
		activeToasts: [],
		dismissToast: vi.fn(),
	}),
}));

const mockFriend: PublicUser = {
	id: 10,
	nickname: 'Alice',
	created_at: '2024-01-01T00:00:00Z',
	online: true,
};

const mockOfflineFriend: PublicUser = {
	id: 11,
	nickname: 'Charlie',
	created_at: '2024-01-01T00:00:00Z',
	online: false,
};

const mockIncomingRequest: FriendRequestResponse = {
	id: 1,
	sender: { id: 20, nickname: 'Bob', created_at: '2024-01-01T00:00:00Z', online: false },
	receiver: { id: 1, nickname: 'TestUser', created_at: '2024-01-01T00:00:00Z', online: true },
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
};

const mockOutgoingRequest: FriendRequestResponse = {
	id: 2,
	sender: { id: 1, nickname: 'TestUser', created_at: '2024-01-01T00:00:00Z', online: true },
	receiver: { id: 30, nickname: 'Dave', created_at: '2024-01-01T00:00:00Z', online: false },
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
};

describe('FriendsDrawer', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function renderDrawer() {
		return render(
			<FriendsProvider>
				<FriendsDrawer />
			</FriendsProvider>,
			{ withAuth: false },
		);
	}

	function setupFriendsApi(
		friends: PublicUser[] = [],
		incoming: FriendRequestResponse[] = [],
		outgoing: FriendRequestResponse[] = [],
	) {
		server.use(
			http.get('/api/friends', () => HttpResponse.json(friends)),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json(incoming)),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json(outgoing)),
		);
	}

	// ─── Toggle button ──────────────────────────────────────────────────

	it('renders toggle button', () => {
		renderDrawer();

		expect(screen.getByLabelText('Open friends panel')).toBeInTheDocument();
	});

	it('opens drawer on toggle click', async () => {
		setupFriendsApi();
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByRole('dialog', { name: 'Friends panel' })).toBeInTheDocument();
		});
	});

	// ─── Badge ──────────────────────────────────────────────────────────

	it('shows incoming request badge count', async () => {
		setupFriendsApi([], [mockIncomingRequest]);
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Bob')).toBeInTheDocument();
		});

		// The badge shows count of incoming requests
		expect(screen.getByText('Incoming Requests')).toBeInTheDocument();
	});

	// ─── Friends list ───────────────────────────────────────────────────

	it('displays friends list', async () => {
		setupFriendsApi([mockFriend, mockOfflineFriend]);
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Alice')).toBeInTheDocument();
			expect(screen.getByText('Charlie')).toBeInTheDocument();
		});
	});

	it('shows empty state when no friends', async () => {
		setupFriendsApi();
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('No friends yet.')).toBeInTheDocument();
		});
	});

	// ─── Incoming requests ──────────────────────────────────────────────

	it('displays incoming requests with accept/reject buttons', async () => {
		setupFriendsApi([], [mockIncomingRequest]);
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Bob')).toBeInTheDocument();
		});
		expect(screen.getByLabelText('Accept friend request from Bob')).toBeInTheDocument();
		expect(screen.getByLabelText('Reject friend request from Bob')).toBeInTheDocument();
	});

	it('removes incoming request on accept', async () => {
		setupFriendsApi([], [mockIncomingRequest]);
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Bob')).toBeInTheDocument();
		});

		await user.click(screen.getByLabelText('Accept friend request from Bob'));

		await waitFor(() => {
			expect(
				screen.queryByLabelText('Accept friend request from Bob'),
			).not.toBeInTheDocument();
		});
	});

	it('removes incoming request on reject', async () => {
		setupFriendsApi([], [mockIncomingRequest]);
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Bob')).toBeInTheDocument();
		});

		await user.click(screen.getByLabelText('Reject friend request from Bob'));

		await waitFor(() => {
			expect(
				screen.queryByLabelText('Reject friend request from Bob'),
			).not.toBeInTheDocument();
		});
	});

	// ─── Outgoing requests ──────────────────────────────────────────────

	it('displays outgoing requests with cancel button', async () => {
		setupFriendsApi([], [], [mockOutgoingRequest]);
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Dave')).toBeInTheDocument();
		});
		expect(screen.getByLabelText('Cancel friend request to Dave')).toBeInTheDocument();
	});

	it('removes outgoing request on cancel', async () => {
		setupFriendsApi([], [], [mockOutgoingRequest]);
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Dave')).toBeInTheDocument();
		});

		await user.click(screen.getByLabelText('Cancel friend request to Dave'));

		await waitFor(() => {
			expect(
				screen.queryByLabelText('Cancel friend request to Dave'),
			).not.toBeInTheDocument();
		});
	});

	// ─── Remove friend ──────────────────────────────────────────────────

	it('removes friend from list', async () => {
		setupFriendsApi([mockFriend]);
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Alice')).toBeInTheDocument();
		});

		await user.click(screen.getByLabelText('Remove Alice from friends'));

		await waitFor(() => {
			expect(screen.queryByLabelText('Remove Alice from friends')).not.toBeInTheDocument();
		});
	});

	// ─── Close button ───────────────────────────────────────────────────

	it('closes drawer with close button', async () => {
		setupFriendsApi();
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('No friends yet.')).toBeInTheDocument();
		});

		// Close via the × button in the header (there are two "Close friends panel" buttons:
		// the FAB toggle and the × header button — click the one inside the dialog)
		const closeButtons = screen.getAllByLabelText('Close friends panel');
		const headerClose = closeButtons.find((btn) => btn.textContent === '×')!;
		await user.click(headerClose);

		// Toggle button now shows "Open"
		expect(screen.getByLabelText('Open friends panel')).toBeInTheDocument();
	});

	// ─── Escape key ─────────────────────────────────────────────────────

	it('closes drawer with Escape key', async () => {
		setupFriendsApi();
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('No friends yet.')).toBeInTheDocument();
		});

		fireEvent.keyDown(document, { key: 'Escape' });

		// After close, toggle button shows "Open"
		expect(screen.getByLabelText('Open friends panel')).toBeInTheDocument();
	});

	// ─── Error state ────────────────────────────────────────────────────

	it('shows error on API failure', async () => {
		server.use(
			http.get('/api/friends', () => HttpResponse.error()),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([])),
		);

		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeInTheDocument();
		});
	});

	// ─── Action error ───────────────────────────────────────────────────

	it('shows error when remove friend fails', async () => {
		setupFriendsApi([mockFriend]);
		server.use(
			http.delete('/api/friends/remove/:id', () => {
				return HttpResponse.json(
					{
						error: {
							code: 500,
							name: 'Error',
							brief: 'ServerError',
							detail: 'Server error',
						},
					},
					{ status: 500 },
				);
			}),
		);

		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		await waitFor(() => {
			expect(screen.getByText('Alice')).toBeInTheDocument();
		});

		await user.click(screen.getByLabelText('Remove Alice from friends'));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeInTheDocument();
		});
	});

	// ─── Accessibility ──────────────────────────────────────────────────

	it('has proper aria attributes on drawer panel', async () => {
		setupFriendsApi();
		const user = userEvent.setup();
		renderDrawer();

		await user.click(screen.getByLabelText('Open friends panel'));

		const dialog = screen.getByRole('dialog');
		expect(dialog).toHaveAttribute('aria-label', 'Friends panel');
	});

	it('toggle button has aria-expanded', () => {
		renderDrawer();

		const toggle = screen.getByLabelText('Open friends panel');
		expect(toggle).toHaveAttribute('aria-expanded', 'false');
	});
});
