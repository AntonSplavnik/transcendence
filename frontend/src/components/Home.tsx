import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User as UserIcon, Shield, Monitor, LogOut, ChevronDown } from 'lucide-react';
import Button from "./ui/Button";
import Card from "./ui/Card";
import { storeError } from '../api/error';
import type { User, Session } from '../api/types';

interface HomeProps {
	onGame: () => void;
	onLogout: () => void;
}

// TODO: implement explicit sessionExpiringSoon warning/modal to type in password again using reauth API (write new reauth in context)

export default function Home({ onGame, onLogout }: HomeProps) {
	const { user, session } = useAuth();
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const [showSessionDetails, setShowSessionDetails] = useState(false);
	const [show2FASettings, setShow2FASettings] = useState(false);

	// authentification guard from context
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

		if (minutesLeft < 20) {
			storeError(
				new Error('Your session is expiring soon. Please log in again to continue playing.'),
				'SessionExpiringSoon'
			);
			return;
		}

		onGame();
	};

	return (
		<main className="p-6 max-w-4xl mx-auto w-full">
			{/* Header with User Menu */}
			<header className="flex items-center justify-between mb-8 pb-4 border-b border-wood-700">
				<div>
					<h1 className="text-3xl font-bold text-wood-100">Player Dashboard</h1>
					<p className="text-wood-300">Welcome back, {user.nickname}.</p>
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
				</Card>

				<Card>
					<h2 className="text-xl font-bold mb-2 text-wood-100">Recent History</h2>
					<div className="bg-wood-900 rounded p-4 text-center text-wood-400 text-sm italic">
						No recent battles recorded.
					</div>
				</Card>
			</section>

			{/* 2FA Settings Modal */}
			{show2FASettings && (
				<TwoFactorModal
					user={user}
					onClose={() => setShow2FASettings(false)}
				/>
			)}

			{/* Session Details Modal */}
			{showSessionDetails && (
				<SessionDetailsModal
					session={session}
					onClose={() => setShowSessionDetails(false)}
				/>
			)}
		</main>
	);
}

// ============= Two-Factor Authentication Modal =============

interface TwoFactorModalProps {
	user: User;
	onClose: () => void;
}

function TwoFactorModal({ user, onClose }: TwoFactorModalProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleToggle2FA = async () => {
		setIsLoading(true);
		setError(null);

		try {
			if (user.totp_enabled) {
				// TODO: Disable 2FA
				console.log('Disable 2FA');
				// await authApi.disable2FA();
			} else {
				// TODO: Enable 2FA (show QR code flow)
				console.log('Enable 2FA');
				// await authApi.enable2FA();
			}
		} catch (err) {
			setError('Failed to update 2FA settings');
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
			<div className="bg-wood-800 border-2 border-wood-600 rounded-lg p-6 max-w-md w-full">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-2xl font-bold text-wood-100 flex items-center gap-2">
						<Shield className="w-6 h-6" />
						Two-Factor Authentication
					</h2>
					<button
						onClick={onClose}
						className="text-wood-400 hover:text-wood-200 text-2xl leading-none"
					>
						×
					</button>
				</div>

				<div className="space-y-4">
					<div className="bg-wood-900 rounded p-4">
						<p className="text-sm text-wood-300 mb-2">
							Current Status:
						</p>
						<p className="text-lg font-semibold">
							{user.totp_enabled ? (
								<span className="text-green-400">✅ Enabled</span>
							) : (
								<span className="text-yellow-400">❌ Disabled</span>
							)}
						</p>
						{user.totp_confirmed_at && (
							<p className="text-xs text-wood-400 mt-1">
								Activated: {new Date(user.totp_confirmed_at).toLocaleDateString()}
							</p>
						)}
					</div>

					<p className="text-sm text-wood-300">
						Two-factor authentication adds an extra layer of security to your account.
						You'll need to enter a code from your authenticator app when logging in.
					</p>

					{error && (
						<div className="bg-red-900/50 border border-red-500 rounded p-3 text-sm text-red-200">
							{error}
						</div>
					)}

					<div className="flex gap-3">
						<Button
							onClick={handleToggle2FA}
							disabled={isLoading}
							variant={user.totp_enabled ? 'secondary' : 'primary'}
							className="flex-1"
						>
							{isLoading ? 'Processing...' : user.totp_enabled ? 'Disable 2FA' : 'Enable 2FA'}
						</Button>
						<Button onClick={onClose} variant="secondary">
							Cancel
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

// ============= Session Details Modal =============

interface SessionDetailsModalProps {
	session: Session;
	onClose: () => void;
}

function SessionDetailsModal({ session, onClose }: SessionDetailsModalProps) {
	const formatDate = (dateString: string) => {
		return new Date(dateString).toLocaleString();
	};

	const getTimeRemaining = (expiryString: string) => {
		const expiry = new Date(expiryString);
		const now = new Date();
		const diff = expiry.getTime() - now.getTime();

		if (diff < 0) return 'Expired';

		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	};

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
			<div className="bg-wood-800 border-2 border-wood-600 rounded-lg p-6 max-w-lg w-full">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-2xl font-bold text-wood-100 flex items-center gap-2">
						<Monitor className="w-6 h-6" />
						Session Details
					</h2>
					<button
						onClick={onClose}
						className="text-wood-400 hover:text-wood-200 text-2xl leading-none"
					>
						×
					</button>
				</div>

				<div className="space-y-4">
					{/* Session ID */}
					<div className="bg-wood-900 rounded p-4">
						<p className="text-xs text-wood-400 mb-1">Session ID</p>
						<p className="text-sm font-mono text-wood-200">{session.session_id}</p>
					</div>

					{/* Created */}
					<div className="bg-wood-900 rounded p-4">
						<p className="text-xs text-wood-400 mb-1">Created</p>
						<p className="text-sm text-wood-200">{formatDate(session.created_at)}</p>
					</div>

					{/* Last Used */}
					<div className="bg-wood-900 rounded p-4">
						<p className="text-xs text-wood-400 mb-1">Last Used</p>
						<p className="text-sm text-wood-200">{formatDate(session.last_used_at)}</p>
					</div>

					{/* JWT Expiry */}
					<div className="bg-wood-900 rounded p-4">
						<p className="text-xs text-wood-400 mb-1">JWT Expiry (Access Token)</p>
						<p className="text-sm text-wood-200">{formatDate(session.access_expiry)}</p>
						<p className="text-xs text-wood-400 mt-1">
							Expires in: {getTimeRemaining(session.access_expiry)}
						</p>
					</div>

					{/* Session Expiry */}
					<div className="bg-wood-900 rounded p-4">
						<p className="text-xs text-wood-400 mb-1">Session Expiry (Login Required)</p>
						<p className="text-sm text-wood-200">{formatDate(session.login_expiry)}</p>
						<p className="text-xs text-wood-400 mt-1">
							Expires in: {getTimeRemaining(session.login_expiry)}
						</p>
					</div>

					{/* Device Info */}
					{(session.device_name || session.ip_address) && (
						<div className="bg-wood-900 rounded p-4">
							<p className="text-xs text-wood-400 mb-2">Device Information</p>
							{session.device_name && (
								<p className="text-sm text-wood-200">Device: {session.device_name}</p>
							)}
							{session.ip_address && (
								<p className="text-sm text-wood-200">IP: {session.ip_address}</p>
							)}
						</div>
					)}

					<Button onClick={onClose} className="w-full">
						Close
					</Button>
				</div>
			</div>
		</div>
	);
}
