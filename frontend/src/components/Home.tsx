import { useAuth } from '../contexts/AuthContext';
import { User as UserIcon, Shield, Monitor, LogOut, ChevronDown, Pen, Flame, Trophy } from 'lucide-react';
import { Button, Card, Badge, LoadingSpinner } from './ui';
import { Dropdown, DropdownItem, DropdownSeparator } from './ui';
import TwoFactorModal from './modals/TwoFactorAuthModal';
import ReauthModal from './modals/ReauthModal';
import AvatarDisplay from './ui/AvatarDisplay';
import EditUserModal from './modals/EditUserModal';
import { useState } from 'react';
import { useAvatarUrls } from '../hooks/useAvatarUrls';
import { useStats } from '../hooks/useStats';
import { useAchievements } from '../hooks/useAchievements';
import AchievementsModal from './modals/AchievementsModal';

const REAUTH_THRESHOLD_MINUTES = 30;

interface HomeProps {
	onGame: () => void;
	onLogout: () => void;
	onSessions: () => void;
}

export default function Home({ onGame, onLogout, onSessions }: HomeProps) {
	const { user, session } = useAuth();
	const [show2FASettings, setShow2FASettings] = useState(false);
	const [showEditProfile, setShowEditProfile] = useState(false);
	const [showReauthModal, setShowReauthModal] = useState(false);
	const { avatarSmallUrl, avatarLargeUrl, setAvatarUrls } = useAvatarUrls();
	const [description, setDescription] = useState(user?.description ?? '');
	const { stats } = useStats();
	const { achievements } = useAchievements();
	const [showAchievements, setShowAchievements] = useState(false);

	if (!user || !session) {
		return (
			<main className="p-6 max-w-4xl mx-auto w-full" aria-busy="true">
				<div className="text-center text-stone-300 flex items-center justify-center gap-2">
					<LoadingSpinner size="md" />
					<span>Loading...</span>
				</div>
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
	};

	return (
		<main className="p-6 max-w-4xl mx-auto w-full">
			{/* Header with User Menu */}
			<header className="flex items-center justify-between mb-8 pb-4 border-b border-stone-700">
				<div className="flex items-center gap-4">
					<AvatarDisplay
						userId={user.id}
						size="small"
						src={avatarSmallUrl}
						className="w-20 h-20"
					/>
					<div>
						<h1>Player Dashboard</h1>
						<p className="text-stone-300">Welcome back, {user.nickname}.</p>
						{description && (
							<p className="text-stone-400 text-sm italic">{description}</p>
						)}
					</div>
				</div>

				<Dropdown
					align="right"
					trigger={
						<span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 transition-colors border border-stone-600">
							<UserIcon className="w-5 h-5" aria-hidden="true" />
							<span className="hidden sm:inline">{user.nickname}</span>
							<ChevronDown className="w-4 h-4" aria-hidden="true" />
						</span>
					}
				>
					{/* User info header */}
					<div className="px-4 py-3 border-b border-stone-700">
						<p className="text-sm font-medium text-stone-100">{user.nickname}</p>
						<p className="text-xs text-stone-400 truncate">{user.email}</p>
					</div>

					<DropdownItem
						icon={<Pen className="w-4 h-4" />}
						onClick={() => setShowEditProfile(true)}
					>
						Edit Profile
					</DropdownItem>

					<DropdownItem
						icon={<Shield className="w-4 h-4" />}
						onClick={() => setShow2FASettings(true)}
						suffix={
							user.totp_enabled ? (
								<Badge variant="success" size="sm">
									Active
								</Badge>
							) : undefined
						}
					>
						Two-Factor Auth
					</DropdownItem>

					<DropdownItem icon={<Monitor className="w-4 h-4" />} onClick={onSessions}>
						Manage Sessions
					</DropdownItem>

					<DropdownSeparator />

					<DropdownItem
						icon={<LogOut className="w-4 h-4" />}
						onClick={onLogout}
						variant="danger"
					>
						Log Out
					</DropdownItem>
				</Dropdown>
			</header>

			{/* Main Content */}
			<section className="grid gap-6 md:grid-cols-2" aria-label="Dashboard content">
				<Card hoverable>
					<h2 className="text-xl font-bold mb-2 text-gold-400">Play Game</h2>
					<p className="text-sm text-stone-300 mb-4">Jump into a match immediately.</p>
					<Button onClick={handlePlayGame} fullWidth>
						Play a Match
					</Button>
				</Card>

				<Card>
					<div className="flex justify-between items-center">
						<div>
							<h2 className="text-xl font-bold mb-2 text-stone-50">User Stats</h2>
							<div className="space-y-2 text-sm">
								<p className="text-stone-300">
									<span className="text-stone-400">Email:</span> {user.email}
								</p>
								<p className="text-stone-300">
									<span className="text-stone-400">Member since:</span>{' '}
									{new Date(user.created_at).toLocaleDateString()}
								</p>
								<p className="text-stone-300">
									<span className="text-stone-400">2FA:</span>{' '}
									{user.totp_enabled ? (
										<Badge variant="success" dot>
											Enabled
										</Badge>
									) : (
										<Badge variant="warning" dot>
											Disabled
										</Badge>
									)}
								</p>
							</div>
						</div>
						<AvatarDisplay
							userId={user.id}
							size="large"
							src={avatarLargeUrl}
							className="w-28 h-28 rounded-lg"
						/>
					</div>
				</Card>

				{/* XP & Level bar — full width */}
				<Card className="md:col-span-2">
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<Trophy className="w-5 h-5 text-warning" aria-hidden="true" />
							<h2 className="text-xl font-bold text-stone-50">
								Level{' '}
								<span className="text-warning">{stats?.level ?? '—'}</span>
							</h2>
						</div>
						{stats && (
							<span className="text-sm text-stone-400 font-mono">
								{stats.xp_in_level}{' '}
								<span className="text-stone-500">/</span>{' '}
								{stats.xp_to_next} XP
							</span>
						)}
					</div>

					{/* Progress bar */}
					<div
						className="h-3 bg-stone-700 rounded-full overflow-hidden"
						role="progressbar"
						aria-valuenow={stats?.progress_percent ?? 0}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label={`Level progress: ${Math.round(stats?.progress_percent ?? 0)}%`}
					>
						<div
							className="h-full bg-warning rounded-full transition-all duration-500"
							style={{ width: `${stats?.progress_percent ?? 0}%` }}
						/>
					</div>

					{/* Stats row */}
					{stats && (
						<div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
							<div className="bg-stone-900 rounded-lg px-3 py-2 text-center">
								<p className="text-xs text-stone-400 mb-0.5">Games</p>
								<p className="text-lg font-bold text-stone-100 font-mono">{stats.games_played}</p>
							</div>
							<div className="bg-stone-900 rounded-lg px-3 py-2 text-center">
								<p className="text-xs text-stone-400 mb-0.5">Wins</p>
								<p className="text-lg font-bold text-stone-100 font-mono">{stats.games_won}</p>
							</div>
							<div className="bg-stone-900 rounded-lg px-3 py-2 text-center">
								<p className="text-xs text-stone-400 mb-0.5">Win Rate</p>
								<p className="text-lg font-bold text-stone-100 font-mono">
									{Math.round(stats.win_rate)}%
								</p>
							</div>
							<div className="bg-stone-900 rounded-lg px-3 py-2 text-center">
								<p className="text-xs text-stone-400 mb-0.5 flex items-center justify-center gap-1">
									<Flame className="w-3 h-3 text-warning" aria-hidden="true" />
									Best Streak
								</p>
								<p className="text-lg font-bold text-warning font-mono">{stats.best_win_streak}</p>
							</div>
						</div>
					)}
				</Card>

				<Card>
					<h2 className="text-xl font-bold mb-2 text-stone-50">Recent History</h2>
					<div className="bg-stone-900 rounded-lg p-4 text-center text-stone-400 text-sm italic">
						No recent battles recorded.
					</div>
				</Card>

				{/* Achievements preview */}
				<Card>
					<div className="flex items-center justify-between mb-3">
						<div className="flex items-center gap-2">
							<Trophy className="w-5 h-5 text-warning" aria-hidden="true" />
							<h2 className="text-xl font-bold text-stone-50">Achievements</h2>
						</div>
						<button
							onClick={() => setShowAchievements(true)}
							className="text-sm text-stone-400 hover:text-stone-100 transition-colors"
						>
							View All →
						</button>
					</div>
					{achievements ? (() => {
						const unlockedTiers = achievements.reduce(
							(sum, a) =>
								sum +
								(a.bronze_unlocked ? 1 : 0) +
								(a.silver_unlocked ? 1 : 0) +
								(a.gold_unlocked ? 1 : 0),
							0,
						);
						const totalTiers = achievements.length * 3;
						const pct = totalTiers > 0 ? Math.round((unlockedTiers / totalTiers) * 100) : 0;
						return (
							<>
								<p className="text-sm text-stone-400 mb-2">
									{unlockedTiers} / {totalTiers} tiers unlocked
								</p>
								<div
									className="h-2 bg-stone-700 rounded-full overflow-hidden"
									role="progressbar"
									aria-valuenow={pct}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-label={`Achievements: ${pct}%`}
								>
									<div
										className="h-full bg-gold rounded-full transition-all duration-500"
										style={{ width: `${pct}%` }}
									/>
								</div>
							</>
						);
					})() : (
						<div className="h-2 bg-stone-700 rounded-full" />
					)}
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

			{/* Edit profile Modal */}
			{showEditProfile && (
				<EditUserModal
					user={user}
					description={description}
					onClose={() => setShowEditProfile(false)}
					onAvatarChanged={(smallUrl, largeUrl) => setAvatarUrls(smallUrl, largeUrl)}
					onDescriptionChanged={(desc) => setDescription(desc)}
				/>
			)}

			{showAchievements && (
				<AchievementsModal onClose={() => setShowAchievements(false)} />
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
