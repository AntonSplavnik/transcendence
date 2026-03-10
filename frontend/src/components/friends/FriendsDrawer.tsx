import { useEffect, useRef, useState } from 'react';
import { Users, X, Circle, UserMinus, Check, Clock, MessageCircle, User } from 'lucide-react';
import { useFriends } from '../../contexts/FriendsContext';
import type { PublicUser } from '../../api/types';
import AddFriendForm from './AddFriendForm';

// ─── Friend action popup ──────────────────────────────────────────────────────

interface FriendPopupProps {
	friend: PublicUser;
	onClose: () => void;
}

function FriendPopup({ friend, onClose }: FriendPopupProps) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				onClose();
			}
		};
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [onClose]);

	return (
		<div
			ref={ref}
			className="mt-1 mx-2 rounded-lg bg-stone-900 border border-stone-600 shadow-lg overflow-hidden"
		>
			<div className="px-3 py-2 border-b border-stone-700 flex items-center gap-2">
				<Circle
					className={`w-2 h-2 flex-shrink-0 ${friend.online ? 'fill-green-400 text-green-400' : 'fill-stone-500 text-stone-500'}`}
				/>
				<span className="text-sm font-semibold text-stone-100 truncate">
					{friend.nickname}
				</span>
				<span className="text-xs text-stone-500 ml-auto">
					{friend.online ? 'Online' : 'Offline'}
				</span>
			</div>
			<div className="p-1">
				<button
					className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm text-stone-300 hover:bg-stone-700 hover:text-stone-100 transition-colors text-left"
					onClick={() => {
						/* TODO: open chat */ onClose();
					}}
				>
					<MessageCircle className="w-4 h-4 flex-shrink-0" />
					Send a message
				</button>
				<button
					className="w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm text-stone-300 hover:bg-stone-700 hover:text-stone-100 transition-colors text-left"
					onClick={() => {
						/* TODO: show profile */ onClose();
					}}
				>
					<User className="w-4 h-4 flex-shrink-0" />
					Show profile
				</button>
			</div>
		</div>
	);
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

export default function FriendsDrawer() {
	const {
		isOpen,
		toggleDrawer,
		friends,
		incoming,
		outgoing,
		loading,
		error,
		actionInProgress,
		fetchAll,
		handleAccept,
		handleReject,
		handleCancel,
		handleRemove,
	} = useFriends();

	const [rawActivePopupId, setActivePopupId] = useState<number | null>(null);
	// Derive popup visibility from drawer state — avoids a sync setState-in-effect
	const activePopupId = isOpen ? rawActivePopupId : null;

	const togglePopup = (id: number) => setActivePopupId((prev) => (prev === id ? null : id));

	// Escape key closes drawer (and any open popup)
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				if (rawActivePopupId !== null) setActivePopupId(null);
				else toggleDrawer();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, toggleDrawer, rawActivePopupId]);

	return (
		<>
			{/* Toggle Button */}
			<button
				onClick={toggleDrawer}
				className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-primary hover:bg-primary-hover text-primary-text shadow-lg flex items-center justify-center transition-colors"
				title="Friends"
				aria-label={isOpen ? 'Close friends panel' : 'Open friends panel'}
				aria-expanded={isOpen}
			>
				{incoming.length > 0 && (
					<span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold">
						{incoming.length > 9 ? '9+' : incoming.length}
					</span>
				)}
				<Users className="w-5 h-5" />
			</button>

			{/* Panel */}
			<div
				className={`fixed top-0 right-0 h-full w-80 bg-stone-800 border-l border-stone-700 z-40 flex flex-col transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-stone-700">
					<h2 className="text-lg font-bold text-stone-100 flex items-center gap-2">
						<Users className="w-5 h-5" />
						Friends
					</h2>
					<button
						onClick={toggleDrawer}
						className="text-stone-400 hover:text-stone-200 transition-colors"
						aria-label="Close friends panel"
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-3 space-y-4">
					<AddFriendForm isOpen={isOpen} onRequestSent={fetchAll} />

					{error && <p className="text-xs text-red-400">{error}</p>}

					{loading ? (
						<p className="text-stone-400 text-sm text-center py-4">Loading...</p>
					) : (
						<>
							{/* Incoming Requests */}
							{incoming.length > 0 && (
								<section>
									<h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">
										Incoming Requests
										<span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-primary text-primary-text">
											{incoming.length}
										</span>
									</h3>
									<ul className="space-y-1">
										{incoming.map((req) => (
											<li
												key={req.id}
												className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-stone-700/50"
											>
												<span className="text-sm text-stone-100 truncate flex-1">
													{req.sender.nickname}
												</span>
												<button
													onClick={() => handleAccept(req.id)}
													disabled={actionInProgress !== null}
													className="text-stone-500 hover:text-green-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Accept"
													aria-label={`Accept friend request from ${req.sender.nickname}`}
												>
													<Check className="w-4 h-4" />
												</button>
												<button
													onClick={() => handleReject(req.id)}
													disabled={actionInProgress !== null}
													className="text-stone-500 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
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

							{/* Outgoing Requests */}
							{outgoing.length > 0 && (
								<section>
									<h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">
										Pending Requests
										<span className="ml-1.5 text-stone-500 font-normal normal-case tracking-normal">
											({outgoing.length})
										</span>
									</h3>
									<ul className="space-y-1">
										{outgoing.map((req) => (
											<li
												key={req.id}
												className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-stone-700/50 opacity-70"
											>
												<Clock className="w-2.5 h-2.5 flex-shrink-0 text-stone-500" />
												<span className="text-sm text-stone-100 truncate flex-1">
													{req.receiver.nickname}
												</span>
												<button
													onClick={() => handleCancel(req.id)}
													disabled={actionInProgress !== null}
													className="text-stone-500 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Cancel request"
													aria-label={`Cancel friend request to ${req.receiver.nickname}`}
												>
													<X className="w-4 h-4" />
												</button>
											</li>
										))}
									</ul>
								</section>
							)}

							{/* Friends List */}
							<section>
								<h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1">
									Friends ({friends.length})
								</h3>
								{friends.length === 0 ? (
									<p className="text-stone-500 text-sm px-2 py-1">
										No friends yet.
									</p>
								) : (
									<ul className="space-y-0.5">
										{friends.map((friend) => (
											<li key={friend.id}>
												<div
													className={`flex items-center gap-2 px-2 py-1.5 rounded ${activePopupId === friend.id ? 'bg-stone-700/50' : 'hover:bg-stone-700/50'}`}
												>
													<Circle
														className={`w-2.5 h-2.5 flex-shrink-0 ${friend.online ? 'fill-green-400 text-green-400' : 'fill-stone-500 text-stone-500'}`}
													/>
													<button
														className="text-sm text-stone-100 truncate flex-1 text-left hover:text-white transition-colors"
														onClick={() => togglePopup(friend.id)}
														aria-expanded={activePopupId === friend.id}
														aria-label={`Open actions for ${friend.nickname}`}
													>
														{friend.nickname}
													</button>
													<button
														onClick={() => {
															setActivePopupId(null);
															handleRemove(friend.id);
														}}
														disabled={actionInProgress !== null}
														className="text-stone-500 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
														title="Remove friend"
														aria-label={`Remove ${friend.nickname} from friends`}
													>
														<UserMinus className="w-4 h-4" />
													</button>
												</div>
												{activePopupId === friend.id && (
													<FriendPopup
														friend={friend}
														onClose={() => setActivePopupId(null)}
													/>
												)}
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
