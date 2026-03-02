import { useState, useEffect, useCallback } from 'react';
import { Users, X, Circle, UserMinus, Check, Clock } from 'lucide-react';
import * as friendsApi from '../../api/friends';
import { getErrorMessage } from '../../api/error';
import type { PublicUser, FriendRequestResponse } from '../../api/types';
import AddFriendForm from './AddFriendForm';

interface FriendsDrawerProps {
	isOpen: boolean;
	onToggle: () => void;
}

export default function FriendsDrawer({ isOpen, onToggle }: FriendsDrawerProps) {
	const [friends, setFriends] = useState<PublicUser[]>([]);
	const [incoming, setIncoming] = useState<FriendRequestResponse[]>([]);
	const [outgoing, setOutgoing] = useState<FriendRequestResponse[]>([]);
	const [loading, setLoading] = useState(false);
	const [actionInProgress, setActionInProgress] = useState<number | null>(null);
	const [error, setError] = useState('');

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

	useEffect(() => {
		if (isOpen) fetchAll();
	}, [isOpen, fetchAll]);

	// Escape key to close
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onToggle();
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, onToggle]);

	const handleRemove = async (userId: number) => {
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
	};

	const handleAccept = async (requestId: number) => {
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
	};

	const handleReject = async (requestId: number) => {
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
	};

	const handleCancel = async (requestId: number) => {
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
	};

	return (
		<>
			{/* Toggle Button */}
			<button
				onClick={onToggle}
				className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-primary hover:bg-primary-hover text-primary-text shadow-lg flex items-center justify-center transition-colors"
				title="Friends"
				aria-label={isOpen ? 'Close friends panel' : 'Open friends panel'}
				aria-expanded={isOpen}
			>
				<Users className="w-5 h-5" />
			</button>

			{/* Backdrop */}
			{isOpen && (
				<div
					className="fixed inset-0 bg-black/30 z-30"
					onClick={onToggle}
				/>
			)}

			{/* Panel */}
			<div
				className={`fixed top-0 right-0 h-full w-80 bg-wood-800 border-l border-wood-700 z-40 flex flex-col transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-wood-700">
					<h2 className="text-lg font-bold text-wood-100 flex items-center gap-2">
						<Users className="w-5 h-5" />
						Friends
					</h2>
					<button
						onClick={onToggle}
						className="text-wood-400 hover:text-wood-200 transition-colors"
						aria-label="Close friends panel"
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-3 space-y-4">
					<AddFriendForm isOpen={isOpen} onRequestSent={fetchAll} />

					{error && (
						<p className="text-xs text-red-400">{error}</p>
					)}

					{loading ? (
						<p className="text-wood-400 text-sm text-center py-4">Loading...</p>
					) : (
						<>
							{/* Incoming Requests */}
							{incoming.length > 0 && (
								<section>
									<h3 className="text-xs font-semibold text-wood-400 uppercase tracking-wide mb-1">
										Incoming Requests
										<span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-primary text-primary-text">
											{incoming.length}
										</span>
									</h3>
									<ul className="space-y-1">
										{incoming.map((req) => (
											<li key={req.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-wood-700/50">
												<span className="text-sm text-wood-100 truncate flex-1">{req.sender.nickname}</span>
												<button
													onClick={() => handleAccept(req.id)}
													disabled={actionInProgress !== null}
													className="text-wood-500 hover:text-green-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Accept"
													aria-label={`Accept friend request from ${req.sender.nickname}`}
												>
													<Check className="w-4 h-4" />
												</button>
												<button
													onClick={() => handleReject(req.id)}
													disabled={actionInProgress !== null}
													className="text-wood-500 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Reject"
													aria-label={`Reject friend request from ${req.sender.nickname}`}
												>
													<X className="w-4 h-4" />
												</button>
											</li>
										))}
									</ul>
								</section>
							)}

							{/* Friends List + Outgoing Requests */}
							<section>
								<h3 className="text-xs font-semibold text-wood-400 uppercase tracking-wide mb-1">
									Friends ({friends.length})
								</h3>
								{friends.length === 0 && outgoing.length === 0 ? (
									<p className="text-wood-500 text-sm px-2 py-1">No friends yet.</p>
								) : (
									<ul className="space-y-1">
										{friends.map((friend) => (
											<li key={friend.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-wood-700/50">
												<Circle
													className={`w-2.5 h-2.5 flex-shrink-0 ${friend.online ? 'fill-green-400 text-green-400' : 'fill-wood-500 text-wood-500'}`}
												/>
												<span className="text-sm text-wood-100 truncate flex-1">{friend.nickname}</span>
												<button
													onClick={() => handleRemove(friend.id)}
													disabled={actionInProgress !== null}
													className="text-wood-500 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Remove friend"
													aria-label={`Remove ${friend.nickname} from friends`}
												>
													<UserMinus className="w-4 h-4" />
												</button>
											</li>
										))}
										{outgoing.map((req) => (
											<li key={`out-${req.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-wood-700/50 opacity-60">
												<Clock className="w-2.5 h-2.5 flex-shrink-0 text-wood-500" />
												<span className="text-sm text-wood-100 truncate flex-1">{req.receiver.nickname}</span>
												<span className="text-xs text-wood-500">Pending</span>
												<button
													onClick={() => handleCancel(req.id)}
													disabled={actionInProgress !== null}
													className="text-wood-500 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Cancel request"
													aria-label={`Cancel friend request to ${req.receiver.nickname}`}
												>
													<X className="w-4 h-4" />
												</button>
											</li>
										))}
									</ul>
								)}
							</section>
						</>
					)}
				</div>
			</div>
		</>
	);
}
