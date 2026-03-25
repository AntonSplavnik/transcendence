import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/msw-handlers';
import { FriendsProvider, useFriends } from '../../../src/contexts/FriendsContext';
import type { ReactNode } from 'react';

// Mock NotificationContext
vi.mock('../../../src/contexts/NotificationContext', () => ({
	useNotifications: () => ({
		notifications: [],
		activeToasts: [],
		dismissToast: vi.fn(),
	}),
}));

function wrapper({ children }: { children: ReactNode }) {
	return <FriendsProvider>{children}</FriendsProvider>;
}

describe('FriendsContext', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── Hook outside provider ──────────────────────────────────────────

	it('throws when useFriends is used outside FriendsProvider', () => {
		// Suppress console.error for expected throw
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(() => {
			renderHook(() => useFriends());
		}).toThrow('useFriends must be used within a FriendsProvider');

		spy.mockRestore();
	});

	// ─── Initial state ──────────────────────────────────────────────────

	it('provides initial state', () => {
		const { result } = renderHook(() => useFriends(), { wrapper });

		expect(result.current.isOpen).toBe(false);
		expect(result.current.friends).toEqual([]);
		expect(result.current.incoming).toEqual([]);
		expect(result.current.outgoing).toEqual([]);
		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBe('');
		expect(result.current.actionInProgress).toBeNull();
	});

	// ─── Toggle drawer ──────────────────────────────────────────────────

	it('toggles drawer state', async () => {
		const { result } = renderHook(() => useFriends(), { wrapper });

		expect(result.current.isOpen).toBe(false);

		await act(() => result.current.toggleDrawer());

		expect(result.current.isOpen).toBe(true);

		await act(() => result.current.toggleDrawer());

		expect(result.current.isOpen).toBe(false);
	});

	// ─── Fetch on open ──────────────────────────────────────────────────

	it('fetches data when drawer opens', async () => {
		const friend = {
			id: 10,
			nickname: 'Alice',
			created_at: '2024-01-01T00:00:00Z',
			online: true,
		};
		server.use(
			http.get('/api/friends', () => HttpResponse.json([friend])),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([])),
		);

		const { result } = renderHook(() => useFriends(), { wrapper });

		await act(() => result.current.toggleDrawer());

		await waitFor(() => {
			expect(result.current.friends).toEqual([friend]);
			expect(result.current.loading).toBe(false);
		});
	});

	// ─── Fetch error ────────────────────────────────────────────────────

	it('sets error on fetch failure', async () => {
		server.use(
			http.get('/api/friends', () => HttpResponse.error()),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([])),
		);

		const { result } = renderHook(() => useFriends(), { wrapper });

		await act(() => result.current.toggleDrawer());

		await waitFor(() => {
			expect(result.current.error).toBeTruthy();
			expect(result.current.loading).toBe(false);
		});
	});

	// ─── handleAccept ───────────────────────────────────────────────────

	it('handleAccept removes request and adds friend', async () => {
		const incoming = {
			id: 1,
			sender: {
				id: 20,
				nickname: 'Bob',
				created_at: '2024-01-01T00:00:00Z',
				online: false,
			},
			receiver: {
				id: 1,
				nickname: 'TestUser',
				created_at: '2024-01-01T00:00:00Z',
				online: true,
			},
			created_at: '2024-01-01T00:00:00Z',
			updated_at: '2024-01-01T00:00:00Z',
		};

		server.use(
			http.get('/api/friends', () => HttpResponse.json([])),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([incoming])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([])),
		);

		const { result } = renderHook(() => useFriends(), { wrapper });

		await act(() => result.current.toggleDrawer());

		await waitFor(() => {
			expect(result.current.incoming).toHaveLength(1);
		});

		await act(() => result.current.handleAccept(1));

		await waitFor(() => {
			expect(result.current.incoming).toHaveLength(0);
			expect(result.current.friends).toHaveLength(1);
		});
	});

	// ─── handleReject ───────────────────────────────────────────────────

	it('handleReject removes request', async () => {
		const incoming = {
			id: 1,
			sender: {
				id: 20,
				nickname: 'Bob',
				created_at: '2024-01-01T00:00:00Z',
				online: false,
			},
			receiver: {
				id: 1,
				nickname: 'TestUser',
				created_at: '2024-01-01T00:00:00Z',
				online: true,
			},
			created_at: '2024-01-01T00:00:00Z',
			updated_at: '2024-01-01T00:00:00Z',
		};

		server.use(
			http.get('/api/friends', () => HttpResponse.json([])),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([incoming])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([])),
		);

		const { result } = renderHook(() => useFriends(), { wrapper });

		await act(() => result.current.toggleDrawer());

		await waitFor(() => {
			expect(result.current.incoming).toHaveLength(1);
		});

		await act(() => result.current.handleReject(1));

		await waitFor(() => {
			expect(result.current.incoming).toHaveLength(0);
		});
	});

	// ─── handleCancel ───────────────────────────────────────────────────

	it('handleCancel removes outgoing request', async () => {
		const outgoing = {
			id: 2,
			sender: {
				id: 1,
				nickname: 'TestUser',
				created_at: '2024-01-01T00:00:00Z',
				online: true,
			},
			receiver: {
				id: 30,
				nickname: 'Dave',
				created_at: '2024-01-01T00:00:00Z',
				online: false,
			},
			created_at: '2024-01-01T00:00:00Z',
			updated_at: '2024-01-01T00:00:00Z',
		};

		server.use(
			http.get('/api/friends', () => HttpResponse.json([])),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([outgoing])),
		);

		const { result } = renderHook(() => useFriends(), { wrapper });

		await act(() => result.current.toggleDrawer());

		await waitFor(() => {
			expect(result.current.outgoing).toHaveLength(1);
		});

		await act(() => result.current.handleCancel(2));

		await waitFor(() => {
			expect(result.current.outgoing).toHaveLength(0);
		});
	});

	// ─── handleRemove ───────────────────────────────────────────────────

	it('handleRemove removes friend from list', async () => {
		const friend = {
			id: 10,
			nickname: 'Alice',
			created_at: '2024-01-01T00:00:00Z',
			online: true,
		};

		server.use(
			http.get('/api/friends', () => HttpResponse.json([friend])),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([])),
		);

		const { result } = renderHook(() => useFriends(), { wrapper });

		await act(() => result.current.toggleDrawer());

		await waitFor(() => {
			expect(result.current.friends).toHaveLength(1);
		});

		await act(() => result.current.handleRemove(10));

		await waitFor(() => {
			expect(result.current.friends).toHaveLength(0);
		});
	});

	// ─── Action error handling ──────────────────────────────────────────

	it('sets error when action fails', async () => {
		server.use(
			http.get('/api/friends', () =>
				HttpResponse.json([
					{ id: 10, nickname: 'Alice', created_at: '2024-01-01T00:00:00Z', online: true },
				]),
			),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([])),
			http.delete('/api/friends/remove/:id', () =>
				HttpResponse.json(
					{
						error: {
							code: 500,
							name: 'Error',
							brief: 'ServerError',
							detail: 'Failed',
						},
					},
					{ status: 500 },
				),
			),
		);

		const { result } = renderHook(() => useFriends(), { wrapper });

		await act(() => result.current.toggleDrawer());

		await waitFor(() => {
			expect(result.current.friends).toHaveLength(1);
		});

		await act(() => result.current.handleRemove(10));

		await waitFor(() => {
			expect(result.current.error).toBeTruthy();
			expect(result.current.actionInProgress).toBeNull();
		});
	});

	// ─── Guards against concurrent actions ──────────────────────────────

	it('ignores action when another is in progress', async () => {
		let resolveRemove: (() => void) | undefined;
		server.use(
			http.get('/api/friends', () =>
				HttpResponse.json([
					{ id: 10, nickname: 'Alice', created_at: '2024-01-01T00:00:00Z', online: true },
					{ id: 11, nickname: 'Bob', created_at: '2024-01-01T00:00:00Z', online: true },
				]),
			),
			http.get('/api/friends/requests/incoming', () => HttpResponse.json([])),
			http.get('/api/friends/requests/outgoing', () => HttpResponse.json([])),
			http.delete('/api/friends/remove/:id', () => {
				return new Promise((resolve) => {
					resolveRemove = () => resolve(new HttpResponse(null, { status: 204 }));
				});
			}),
		);

		const { result } = renderHook(() => useFriends(), { wrapper });

		await act(() => result.current.toggleDrawer());

		await waitFor(() => {
			expect(result.current.friends).toHaveLength(2);
		});

		// Start first action (don't await)
		act(() => {
			result.current.handleRemove(10);
		});

		await waitFor(() => {
			expect(result.current.actionInProgress).toBe(10);
		});

		// Try second action while first is in progress — should be ignored
		await act(() => result.current.handleRemove(11));

		// Still 2 friends (second action was ignored)
		expect(result.current.friends).toHaveLength(2);

		// Resolve first
		await act(async () => {
			resolveRemove?.();
		});

		await waitFor(() => {
			expect(result.current.actionInProgress).toBeNull();
			expect(result.current.friends).toHaveLength(1);
		});
	});

	// ─── open-friends-drawer event ──────────────────────────────────────

	it('opens drawer on open-friends-drawer window event', async () => {
		const { result } = renderHook(() => useFriends(), { wrapper });

		expect(result.current.isOpen).toBe(false);

		await act(() => {
			window.dispatchEvent(new Event('open-friends-drawer'));
		});

		expect(result.current.isOpen).toBe(true);
	});
});
