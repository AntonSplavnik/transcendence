import {
	ChevronDown,
	Fingerprint,
	LogOut,
	Mail,
	Monitor,
	Pen,
	Shield,
	User as UserIcon,
	Users,
	Volume2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { useLobby } from '../contexts/LobbyContext';
import { useAvatarUrls } from '../hooks/useAvatarUrls';
import useDocumentTitle from '../hooks/useDocumentTitle';
import AudioSettingsModal from './modals/AudioSettingsModal';
import CreateLobbyModal from './modals/CreateLobbyModal';
import DataPrivacyModal from './modals/DataPrivacyModal';
import EditUserModal from './modals/EditUserModal';
import EmailConfirmationModal from './modals/EmailConfirmationModal';
import JoinByCodeModal from './modals/JoinByCodeModal';
import LobbyListModal from './modals/LobbyListModal';
import ReauthModal from './modals/ReauthModal';
import TwoFactorModal from './modals/TwoFactorAuthModal';
import {
	Badge,
	Button,
	Card,
	Dropdown,
	DropdownItem,
	DropdownSeparator,
	LoadingSpinner,
} from './ui';
import AvatarDisplay from './ui/AvatarDisplay';

const REAUTH_THRESHOLD_MINUTES = 60;

interface HomeProps {
	onLogout: () => void;
	onSessions: () => void;
}

export default function Home({ onLogout, onSessions }: HomeProps) {
	useDocumentTitle('Home');
	const { user, session, isEmailConfirmed } = useAuth();
	const { lobbyState } = useLobby();
	const [show2FASettings, setShow2FASettings] = useState(false);
	const [showEditProfile, setShowEditProfile] = useState(false);
	const [showEmailConfirmation, setShowEmailConfirmation] = useState(false);
	const [showAudioSettings, setShowAudioSettings] = useState(false);
	const [showReauthModal, setShowReauthModal] = useState(false);
	const [showLobbyList, setShowLobbyList] = useState(false);
	const [showCreateLobby, setShowCreateLobby] = useState(false);
	const [showJoinByCode, setShowJoinByCode] = useState(false);
	const [showDataPrivacy, setShowDataPrivacy] = useState(false);
	const pendingActionRef = useRef<(() => void) | null>(null);
	const { avatarSmallUrl, avatarLargeUrl, setAvatarUrls } = useAvatarUrls();
	const [description, setDescription] = useState(user?.description ?? '');

	const requireReauth = (action: () => void) => {
		const minutesLeft = session
			? (new Date(session.login_expiry).getTime() - Date.now()) / (1000 * 60)
			: 0;
		if (minutesLeft < REAUTH_THRESHOLD_MINUTES) {
			pendingActionRef.current = action;
			setShowReauthModal(true);
			return;
		}
		action();
	};

	const handleReauthSuccess = () => {
		setShowReauthModal(false);
		pendingActionRef.current?.();
		pendingActionRef.current = null;
	};

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
							<p className="text-stone-350 text-sm italic">{description}</p>
						)}
					</div>
				</div>

				<Dropdown
					align="right"
					trigger={
						<span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-100 transition-colors border border-stone-600">
							<UserIcon className="w-5 h-5" aria-hidden="true" />
							<span className="sr-only sm:not-sr-only">{user.nickname}</span>
							<ChevronDown className="w-4 h-4" aria-hidden="true" />
						</span>
					}
				>
					{/* User info header */}
					<div className="px-4 py-3 border-b border-stone-700">
						<p className="text-sm font-medium text-stone-100">{user.nickname}</p>
						<p className="text-xs text-stone-300 truncate">{user.email}</p>
					</div>

					<DropdownItem
						icon={<Pen className="w-4 h-4" />}
						onClick={() => setShowEditProfile(true)}
					>
						Edit Profile
					</DropdownItem>

					<DropdownItem
						icon={<Volume2 className="w-4 h-4" />}
						onClick={() => setShowAudioSettings(true)}
					>
						Audio Settings
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

					<DropdownItem
						icon={<Mail className="w-4 h-4" />}
						onClick={() => setShowEmailConfirmation(true)}
						suffix={
							isEmailConfirmed ? (
								<Badge variant="success" size="sm">
									Confirmed
								</Badge>
							) : (
								<Badge variant="warning" size="sm">
									Unconfirmed
								</Badge>
							)
						}
					>
						Email Confirmation
					</DropdownItem>

					<DropdownItem
						icon={<Fingerprint className="w-4 h-4" />}
						onClick={() => setShowDataPrivacy(true)}
					>
						Privacy & Data
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
			{/* items-start prevents cards from stretching to match a taller neighbour */}
			<section
				className="grid gap-6 md:grid-cols-2 md:items-start"
				aria-label="Dashboard content"
			>
				<Card accent="gold">
					<h2 className="text-xl font-bold mb-2 text-gold-400">Play Game</h2>

					{lobbyState.status === 'active' ? (
						/* Already in a lobby — show return prompt instead of entry buttons */
						<div className="rounded-lg bg-stone-800/60 border border-stone-700 p-4 text-center">
							<Users
								className="w-6 h-6 text-gold-400 mx-auto mb-2"
								aria-hidden="true"
							/>
							<p className="text-stone-200 text-sm font-medium mb-1">
								{lobbyState.settings.name}
							</p>
							<p className="text-stone-300 text-xs mb-3">
								You're already in a lobby.
							</p>
							<Link to="/lobby">
								<Button fullWidth>Return to Lobby</Button>
							</Link>
						</div>
					) : (
						<>
							<p className="text-sm text-stone-300 mb-4">
								Find or create a lobby to jump into a match.
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									size="sm"
									onClick={() => requireReauth(() => setShowLobbyList(true))}
								>
									Find Public Game
								</Button>
								<Button
									variant="secondary"
									size="sm"
									onClick={() => requireReauth(() => setShowCreateLobby(true))}
								>
									Create Lobby
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => requireReauth(() => setShowJoinByCode(true))}
								>
									Join by Code
								</Button>
							</div>
						</>
					)}
				</Card>

				<Card>
					<div className="flex justify-between items-center">
						<div>
							<h2 className="text-xl font-bold mb-2 text-stone-50">User Stats</h2>
							<div className="space-y-2 text-sm">
								<p className="text-stone-300">
									<span className="text-stone-300">Email:</span> {user.email}
								</p>
								<p className="text-stone-300">
									<span className="text-stone-300">Member since:</span>{' '}
									{new Date(user.created_at).toLocaleDateString()}
								</p>
								<p className="text-stone-300">
									<span className="text-stone-300">2FA:</span>{' '}
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

				<Card>
					<h2 className="text-xl font-bold mb-2 text-stone-50">Recent History</h2>
					<div className="bg-stone-900 rounded-lg p-4 text-center text-stone-350 text-sm italic">
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

			{showEmailConfirmation && (
				<EmailConfirmationModal
					user={user}
					onClose={() => setShowEmailConfirmation(false)}
				/>
			)}

			{/* Audio settings Modal */}
			{showAudioSettings && (
				<AudioSettingsModal onClose={() => setShowAudioSettings(false)} />
			)}

			{/* Lobby modals */}
			{showLobbyList && <LobbyListModal onClose={() => setShowLobbyList(false)} />}
			{showCreateLobby && <CreateLobbyModal onClose={() => setShowCreateLobby(false)} />}
			{showJoinByCode && <JoinByCodeModal onClose={() => setShowJoinByCode(false)} />}

			{showDataPrivacy && <DataPrivacyModal onClose={() => setShowDataPrivacy(false)} />}

			{showReauthModal && (
				<ReauthModal
					onSuccess={handleReauthSuccess}
					onCancel={() => {
						setShowReauthModal(false);
						pendingActionRef.current = null;
					}}
				/>
			)}
		</main>
	);
}
