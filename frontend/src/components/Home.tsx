import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User as UserIcon, Shield, Monitor, LogOut, ChevronDown, Pen } from 'lucide-react';
import { fetchAvatar } from '../api/avatar';
import Button from "./ui/Button";
import Card from "./ui/Card";
import AvatarDisplay from './ui/AvatarDisplay';
import AvatarUploadModal from './modals/AvatarUploadModal';
import TwoFactorModal from './modals/TwoFactorAuthModal';
import SessionDetailsModal from './modals/SessionDetailModal';
import ReauthModal from './modals/ReauthModal';


const REAUTH_THRESHOLD_MINUTES = 30;

interface HomeProps {
	onGame: () => void;
	onLogout: () => void;
}

export default function Home({ onGame, onLogout }: HomeProps) {
	const { user, session } = useAuth();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [showSessionDetails, setShowSessionDetails] = useState(false);
	const [show2FASettings, setShow2FASettings] = useState(false);
	const [showEditProfile, setShowEditProfile] = useState(false);
	const [showReauthModal, setShowReauthModal] = useState(false);
	const [avatarSmallUrl, setAvatarSmallUrl] = useState<string | null>(null);
	const [avatarLargeUrl, setAvatarLargeUrl] = useState<string | null>(null);

	const loadAvatars = useCallback(async () => {
		if (!user) return;
		try {
			const [small, large] = await Promise.all([
				fetchAvatar(user.id, 'small'),
				fetchAvatar(user.id, 'large'),
			]);
			setAvatarSmallUrl(prev => { if (prev) URL.revokeObjectURL(prev); return small; });
			setAvatarLargeUrl(prev => { if (prev) URL.revokeObjectURL(prev); return large; });
		} catch {
			setAvatarSmallUrl(null);
			setAvatarLargeUrl(null);
		}
	}, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		loadAvatars();
	}, [loadAvatars]);

	// authentication guard from context
	if (!user || !session) {
		return (
			<main className="p-6 max-w-4xl mx-auto w-full">
				<div className="text-center text-wood-300">Loading...</div>
			</main>
		);
	}

	const handlePlayGame = () => {
		const expiryTime = new Date(session.access_expiry).getTime();
		const now = Date.now();
		const minutesLeft = (expiryTime - now) / (1000 * 60);

		if (minutesLeft < REAUTH_THRESHOLD_MINUTES) {
			setShowReauthModal(true);
			return;
		}

		onGame();
	};

	const handleReauthSuccess = () => {
		setShowReauthModal(false);
		onGame();
	};

	const handle2FASuccess = () => {
		setShow2FASettings(false);
		//probably no reload necessary, because frontend state is updated in 2FA modal, and backend as well.
	};

	return (
		<main className="p-6 max-w-4xl mx-auto w-full">
			{/* Header with User Menu */}
			<header className="flex items-center justify-between mb-8 pb-4 border-b border-wood-700">
				<div className="flex items-center gap-4">
					<AvatarDisplay userId={user.id} size="small" src={avatarSmallUrl} className="w-14 h-14"/>
					<div>
						<h1 className="text-3xl font-bold text-wood-100">Player Dashboard</h1>
						<p className="text-wood-300">Welcome back, {user.nickname}.</p>
					</div>
				</div>
				{/* User Menu Dropdown */}
				<div className="relative">
					<button
						onClick={() => setIsMenuOpen(!isMenuOpen)}
						className="flex items-center gap-2 px-4 py-2 rounded-lg bg-wood-800 hover:bg-wood-700 
                       text-wood-100 transition-colors border border-wood-600"
					>
						<UserIcon className="w-5 h-5" />
						<span className="hidden sm:inline">{user.nickname}</span>
						<ChevronDown className={`w-4 h-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
					</button>

					{/* Dropdown Menu */}
					{isMenuOpen && (
						<>
							{/* Backdrop to close menu */}
							<div
								className="fixed inset-0 z-10"
								onClick={() => setIsMenuOpen(false)}
							/>

							{/* Menu Items */}
							<div className="absolute right-0 mt-2 w-64 bg-wood-800 border border-wood-600 
                              rounded-lg shadow-xl z-20 overflow-hidden">
								{/* User Info Section */}
								<div className="px-4 py-3 border-b border-wood-700">
									<p className="text-sm font-medium text-wood-100">{user.nickname}</p>
									<p className="text-xs text-wood-400 truncate">{user.email}</p>
								</div>

								{/* Menu Options */}
								<div className="py-2">
									<button
										onClick={() => {
											setShowEditProfile(true);
											setIsMenuOpen(false);
										}}
										className="w-full px-4 py-2 text-left text-sm text-wood-200 hover:bg-wood-700 
                               flex items-center gap-3 transition-colors"
									>
										<Pen className="w-4 h-4" />
										<span>Edit Profile</span>
									</button>

									<button
										onClick={() => {
											setShow2FASettings(true);
											setIsMenuOpen(false);
										}}
										className="w-full px-4 py-2 text-left text-sm text-wood-200 hover:bg-wood-700 
                               flex items-center gap-3 transition-colors"
									>
										<Shield className="w-4 h-4" />
										<span>Two-Factor Authentication</span>
										{user.totp_enabled && (
											<span className="ml-auto text-xs text-green-400">✓ Active</span>
										)}
									</button>

									<button
										onClick={() => {
											setShowSessionDetails(true);
											setIsMenuOpen(false);
										}}
										className="w-full px-4 py-2 text-left text-sm text-wood-200 hover:bg-wood-700 
                               flex items-center gap-3 transition-colors"
									>
										<Monitor className="w-4 h-4" />
										<span>Session Details</span>
									</button>

									<div className="my-2 border-t border-wood-700" />

									<button
										onClick={() => {
											setIsMenuOpen(false);
											onLogout();
										}}
										className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-wood-700 
                               flex items-center gap-3 transition-colors"
									>
										<LogOut className="w-4 h-4" />
										<span>Log Out</span>
									</button>
								</div>
							</div>
						</>
					)}
				</div>
			</header>

			{/* Main Content */}
			<section className="grid gap-6 md:grid-cols-2">
				<Card>
					<h2 className="text-xl font-bold mb-2 text-primary">Play Game</h2>
					<p className="text-sm text-wood-300 mb-4">
						Jump into a match immediately.
					</p>
					<Button onClick={handlePlayGame} className="w-full">
						Play a Match
					</Button>
				</Card>

				<Card>
					<div className="flex justify-between items-center">
						<div>
							<h2 className="text-xl font-bold mb-2 text-wood-100">User Stats</h2>
							<div className="space-y-2 text-sm">
								<p className="text-wood-300">
									<span className="text-wood-400">Email:</span> {user.email}
								</p>
								<p className="text-wood-300">
									<span className="text-wood-400">Member since:</span>{' '}
									{new Date(user.created_at).toLocaleDateString()}
								</p>
								<p className="text-wood-300">
									<span className="text-wood-400">2FA:</span>{' '}
									{user.totp_enabled ? (
										<span className="text-green-400">✅ Enabled</span>
									) : (
										<span className="text-yellow-400">❌ Disabled</span>
									)}
								</p>
							</div>
						</div>
						<AvatarDisplay userId={user.id} size="large" src={avatarLargeUrl} className="w-28 h-28 rounded-lg"/>
					</div>
				</Card>

				<Card>
					<h2 className="text-xl font-bold mb-2 text-wood-100">Recent History</h2>
					<div className="bg-wood-900 rounded p-4 text-center text-wood-400 text-sm italic">
						No recent battles recorded.
					</div>
				</Card>
			</section>

			{/* Modals */}
			{show2FASettings && (
				<TwoFactorModal
					user={user}
					onClose={() => setShow2FASettings(false)}
					onSuccess={handle2FASuccess}
				/>
			)}

			{showSessionDetails && (
				<SessionDetailsModal
					session={session}
					onClose={() => setShowSessionDetails(false)}
				/>
			)}

			{/* Edit profile Modal */}
			{showEditProfile && (
				<AvatarUploadModal
					user={user}
					onClose={() => setShowEditProfile(false)}
					onAvatarChanged={loadAvatars}
					avatarUrl={avatarLargeUrl}
				/>
			)}

			{/*  */}
			{showReauthModal && (
				<ReauthModal
					onSuccess={handleReauthSuccess}
					onCancel={() => setShowReauthModal(false)}
				/>
			)}
		</main>
	);
}
