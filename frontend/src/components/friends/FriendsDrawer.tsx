import { useEffect, useRef, useState } from 'react';
import { Users, Circle, UserMinus, Check, Clock } from 'lucide-react';
import { useFriends } from '../../contexts/FriendsContext';
import type { PublicUser } from '../../api/types';
import AddFriendForm from './AddFriendForm';
import Username from '../ui/Username';
import PublicProfileModal from '../modals/PublicProfileModal';

// ─── Main drawer ──────────────────────────────────────────────────────────────

export default function FriendsDrawer() {
	const [profileFriend, setProfileFriend] = useState<PublicUser | null>(null);
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

	const toggleButtonRef = useRef<HTMLButtonElement>(null);
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	// Tracks whether the drawer was previously open to avoid stealing focus on first render
	const wasOpenRef = useRef(false);

	// Focus close button when drawer opens; return focus to toggle when it closes.
	useEffect(() => {
		if (isOpen) {
			wasOpenRef.current = true;
			closeButtonRef.current?.focus();
		} else if (wasOpenRef.current) {
			wasOpenRef.current = false;
			toggleButtonRef.current?.focus();
		}
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') toggleDrawer();
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, toggleDrawer]);

	return (
		<>
			{/* Toggle Button */}
			<button
				ref={toggleButtonRef}
				onClick={toggleDrawer}
				className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-primary hover:bg-primary-hover text-primary-text shadow-lg flex items-center justify-center transition-colors"
				aria-label={isOpen ? 'Close friends panel' : 'Open friends panel'}
				aria-expanded={isOpen}
			>
				{incoming.length > 0 && (
					<span
						className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold"
						aria-label={`${incoming.length} pending friend ${incoming.length === 1 ? 'request' : 'requests'}`}
					>
						{incoming.length > 9 ? '9+' : incoming.length}
					</span>
				)}
				<Users className="w-5 h-5" />
			</button>

			{/* Panel */}
			<div
				role="dialog"
				aria-label="Friends panel"
				aria-modal="false"
				className={`fixed top-0 right-0 h-full w-80 bg-stone-800 border-l border-stone-700 z-40 flex flex-col transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
				inert={!isOpen || undefined}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-stone-700">
					<h2 className="text-lg font-bold text-stone-100 flex items-center gap-2">
						<Users className="w-5 h-5" />
						Friends
					</h2>
					<button
						ref={closeButtonRef}
						onClick={toggleDrawer}
						className="text-stone-400 hover:text-stone-100 text-xl leading-none p-1 rounded hover:bg-stone-700/50 transition-colors"
						aria-label="Close friends panel"
					>
						×
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-3 space-y-4">
					<AddFriendForm isOpen={isOpen} onRequestSent={fetchAll} />

					{error && (
						<p role="alert" className="text-xs text-red-400">
							{error}
						</p>
					)}

					{loading ? (
						<p
							role="status"
							aria-live="polite"
							className="text-stone-300 text-sm text-center py-4"
						>
							Loading...
						</p>
					) : (
						<>
							{/* Incoming Requests */}
							{incoming.length > 0 && (
								<section>
									<h3 className="text-xs font-semibold text-stone-300 uppercase tracking-wide mb-1">
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
												<span className="text-sm truncate flex-1">
													<Username
														userId={req.sender.id}
														nickname={req.sender.nickname}
														isSelf={false}
														interactive={true}
														colored={false}
													/>
												</span>
												<button
													onClick={() => handleAccept(req.id)}
													disabled={actionInProgress !== null}
													className="text-stone-400 hover:text-green-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Accept"
													aria-label={`Accept friend request from ${req.sender.nickname}`}
												>
													<Check className="w-4 h-4" />
												</button>
												<button
													onClick={() => handleReject(req.id)}
													disabled={actionInProgress !== null}
													className="text-stone-400 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Reject"
													aria-label={`Reject friend request from ${req.sender.nickname}`}
												>
													×
												</button>
											</li>
										))}
									</ul>
								</section>
							)}

							{/* Outgoing Requests */}
							{outgoing.length > 0 && (
								<section>
									<h3 className="text-xs font-semibold text-stone-300 uppercase tracking-wide mb-1">
										Pending Requests
										<span className="ml-1.5 text-stone-350 font-normal normal-case tracking-normal">
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
												<span className="text-sm truncate flex-1">
													<Username
														userId={req.receiver.id}
														nickname={req.receiver.nickname}
														isSelf={false}
														interactive={true}
														colored={false}
													/>
												</span>
												<button
													onClick={() => handleCancel(req.id)}
													disabled={actionInProgress !== null}
													className="text-stone-400 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
													title="Cancel request"
													aria-label={`Cancel friend request to ${req.receiver.nickname}`}
												>
													×
												</button>
											</li>
										))}
									</ul>
								</section>
							)}

							{/* Friends List */}
							<section>
								<h3 className="text-xs font-semibold text-stone-300 uppercase tracking-wide mb-1">
									Friends ({friends.length})
								</h3>
								{friends.length === 0 ? (
									<p className="text-stone-350 text-sm px-2 py-1">
										No friends yet.
									</p>
								) : (
									<ul className="space-y-0.5">
										{friends.map((friend) => (
											<li key={friend.id}>
												<div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-stone-700/50">
													<Circle
														aria-hidden="true"
														className={`w-2.5 h-2.5 flex-shrink-0 ${friend.online ? 'fill-green-400 text-green-400' : 'fill-stone-400 text-stone-400'}`}
													/>
													<span aria-live="polite" className="sr-only">
														{friend.online ? 'Online' : 'Offline'}
													</span>
													<span className="text-sm truncate flex-1">
														<Username
															userId={friend.id}
															nickname={friend.nickname}
															isSelf={false}
															interactive={true}
															colored={false}
															isFriend={true}
															onShowProfile={() =>
																setProfileFriend(friend)
															}
														/>
													</span>
													<button
														onClick={() => handleRemove(friend.id)}
														disabled={actionInProgress !== null}
														className="text-stone-400 hover:text-red-400 transition-colors p-1 disabled:opacity-50 disabled:cursor-not-allowed"
														title="Remove friend"
														aria-label={`Remove ${friend.nickname} from friends`}
													>
														<UserMinus className="w-4 h-4" />
													</button>
												</div>
											</li>
										))}
									</ul>
								)}
							</section>
						</>
					)}
				</div>
			</div>
			{profileFriend && (
				<PublicProfileModal user={profileFriend} onClose={() => setProfileFriend(null)} />
			)}
		</>
	);
}
