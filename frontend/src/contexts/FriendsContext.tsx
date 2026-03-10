import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import * as friendsApi from '../api/friends';
import { getErrorMessage } from '../api/error';
import type { PublicUser, FriendRequestResponse } from '../api/types';
import type { NotificationPayload } from '../stream/types';
import { useNotifications } from './NotificationContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isFriendNotification(payload: NotificationPayload): boolean {
	return (
		typeof payload === 'object' &&
		('FriendRequestReceived' in payload ||
			'FriendRequestAccepted' in payload ||
			'FriendRequestRejected' in payload ||
			'FriendRequestCancelled' in payload ||
			'FriendRemoved' in payload)
	);
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface FriendsContextType {
	isOpen: boolean;
	toggleDrawer: () => void;
	friends: PublicUser[];
	incoming: FriendRequestResponse[];
	outgoing: FriendRequestResponse[];
	loading: boolean;
	error: string;
	actionInProgress: number | null;
	fetchAll: () => Promise<void>;
	handleRemove: (userId: number) => Promise<void>;
	handleAccept: (requestId: number) => Promise<void>;
	handleReject: (requestId: number) => Promise<void>;
	handleCancel: (requestId: number) => Promise<void>;
}

const FriendsContext = createContext<FriendsContextType | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export function FriendsProvider({ children }: { children: ReactNode }) {
	const { notifications } = useNotifications();

	const [isOpen, setIsOpen] = useState(false);
	const [friends, setFriends] = useState<PublicUser[]>([]);
	const [incoming, setIncoming] = useState<FriendRequestResponse[]>([]);
	const [outgoing, setOutgoing] = useState<FriendRequestResponse[]>([]);
	const [loading, setLoading] = useState(false);
	const [actionInProgress, setActionInProgress] = useState<number | null>(null);
	const [error, setError] = useState('');

	const toggleDrawer = useCallback(() => setIsOpen((prev) => !prev), []);

	const fetchAll = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const [f, i, o] = await Promise.all([
				friendsApi.getFriends(),
				friendsApi.getIncomingRequests(),
				friendsApi.getOutgoingRequests(),
			]);
			setFriends(f);
			setIncoming(i);
			setOutgoing(o);
		} catch (err) {
			setError(getErrorMessage(err, 'Failed to load data'));
		} finally {
			setLoading(false);
		}
	}, []);

	// Fetch when drawer opens
	useEffect(() => {
		if (isOpen) fetchAll();
	}, [isOpen, fetchAll]);

	// Refresh on incoming friend-related notifications
	const processedCountRef = useRef(0);
	useEffect(() => {
		if (notifications.length <= processedCountRef.current) return;
		const newNotifs = notifications.slice(0, notifications.length - processedCountRef.current);
		processedCountRef.current = notifications.length;
		if (newNotifs.some((n) => isFriendNotification(n.payload))) {
			fetchAll();
		}
	}, [notifications, fetchAll]);

	// Open drawer when a notification toast is clicked (FriendRequestReceived/Accepted)
	useEffect(() => {
		const handler = () => setIsOpen(true);
		window.addEventListener('open-friends-drawer', handler);
		return () => window.removeEventListener('open-friends-drawer', handler);
	}, []);

	// ─── Action handlers ──────────────────────────────────────────────────

	const handleRemove = useCallback(
		async (userId: number) => {
			if (actionInProgress !== null) return;
			setError('');
			setActionInProgress(userId);
			try {
				await friendsApi.removeFriend(userId);
				setFriends((prev) => prev.filter((f) => f.id !== userId));
			} catch (err) {
				setError(getErrorMessage(err, 'Failed to remove friend'));
			} finally {
				setActionInProgress(null);
			}
		},
		[actionInProgress],
	);

	const handleAccept = useCallback(
		async (requestId: number) => {
			if (actionInProgress !== null) return;
			setError('');
			setActionInProgress(requestId);
			try {
				const accepted = await friendsApi.acceptFriendRequest(requestId);
				setIncoming((prev) => prev.filter((r) => r.id !== requestId));
				setFriends((prev) => [...prev, accepted.sender]);
			} catch (err) {
				setError(getErrorMessage(err, 'Failed to accept request'));
			} finally {
				setActionInProgress(null);
			}
		},
		[actionInProgress],
	);

	const handleReject = useCallback(
		async (requestId: number) => {
			if (actionInProgress !== null) return;
			setError('');
			setActionInProgress(requestId);
			try {
				await friendsApi.rejectFriendRequest(requestId);
				setIncoming((prev) => prev.filter((r) => r.id !== requestId));
			} catch (err) {
				setError(getErrorMessage(err, 'Failed to reject request'));
			} finally {
				setActionInProgress(null);
			}
		},
		[actionInProgress],
	);

	const handleCancel = useCallback(
		async (requestId: number) => {
			if (actionInProgress !== null) return;
			setError('');
			setActionInProgress(requestId);
			try {
				await friendsApi.cancelFriendRequest(requestId);
				setOutgoing((prev) => prev.filter((r) => r.id !== requestId));
			} catch (err) {
				setError(getErrorMessage(err, 'Failed to cancel request'));
			} finally {
				setActionInProgress(null);
			}
		},
		[actionInProgress],
	);

	return (
		<FriendsContext.Provider
			value={{
				isOpen,
				toggleDrawer,
				friends,
				incoming,
				outgoing,
				loading,
				error,
				actionInProgress,
				fetchAll,
				handleRemove,
				handleAccept,
				handleReject,
				handleCancel,
			}}
		>
			{children}
		</FriendsContext.Provider>
	);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFriends(): FriendsContextType {
	const ctx = useContext(FriendsContext);
	if (!ctx) throw new Error('useFriends must be used within a FriendsProvider');
	return ctx;
}
