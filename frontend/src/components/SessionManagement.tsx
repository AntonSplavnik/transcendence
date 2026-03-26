import { useState, useRef, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
	ArrowLeft,
	LogOut,
	Key,
	Monitor,
	Lock,
	Trash2,
	ShieldAlert,
	RefreshCw,
} from 'lucide-react';
import { Button, Card, Badge, Input, Alert, InfoBlock, LoadingSpinner, Modal } from './ui';
import {
	changePassword,
	getSessions,
	logoutSessions,
	logoutOtherSessions,
	deleteSessions,
} from '../api/user';
import { getErrorMessage } from '../api/error';
import { validateMfaCode } from '../utils/validation';
import type { Session } from '../api/types';

interface SessionManagementProps {
	onBack: () => void;
	onLogout: () => void;
}

// ==================== HELPERS ====================

function formatDate(dateString: string): string {
	return new Date(dateString).toLocaleString();
}

function getTimeRemaining(expiryString: string): string {
	const diff = new Date(expiryString).getTime() - Date.now();
	if (diff < 0) return 'Expired';
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));
	const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
	const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

// ==================== SESSION ROW ====================

interface SessionRowProps {
	session: Session;
	isCurrent: boolean;
	isSelected: boolean;
	onToggle: () => void;
}

function SessionRow({ session, isCurrent, isSelected, onToggle }: SessionRowProps) {
	return (
		<div
			className={`
				rounded-lg border p-4 transition-colors
				${
					isCurrent
						? 'border-info/40 bg-info-bg/30'
						: isSelected
							? 'border-gold-400/40 bg-stone-800/60'
							: 'border-stone-700/50 bg-stone-900'
				}
				${!isCurrent ? 'cursor-pointer hover:border-stone-600' : ''}
			`}
			onClick={!isCurrent ? onToggle : undefined}
		>
			<div className="flex items-start gap-3">
				<input
					type="checkbox"
					checked={isSelected}
					onChange={onToggle}
					onClick={(e) => e.stopPropagation()}
					disabled={isCurrent}
					className="mt-1 rounded border-stone-600 bg-stone-800 text-gold-400 focus:ring-gold-400/50 disabled:opacity-30"
					aria-label={`Select session ${session.session_id}`}
				/>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-2">
						<span className="text-sm font-mono text-stone-200">
							Session #{session.session_id}
						</span>
						{isCurrent && (
							<Badge variant="info" size="sm">
								Current
							</Badge>
						)}
					</div>
					<div className="grid gap-2 text-xs text-stone-400 sm:grid-cols-2">
						<span>
							Created:{' '}
							<span className="text-stone-300">{formatDate(session.created_at)}</span>
						</span>
						<span>
							Last used:{' '}
							<span className="text-stone-300">
								{formatDate(session.last_used_at)}
							</span>
						</span>
						<span>
							Expires:{' '}
							<span className="text-stone-300">
								{getTimeRemaining(session.login_expiry)}
							</span>
						</span>
						{session.ip_address && (
							<span>
								IP: <span className="text-stone-300">{session.ip_address}</span>
							</span>
						)}
						{session.device_name && (
							<span>
								Device:{' '}
								<span className="text-stone-300">{session.device_name}</span>
							</span>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

// ==================== ACTION MODAL CONFIG ====================

type PendingAction = 'logout-selected' | 'logout-others' | 'delete-selected' | 'refresh';

const ACTION_CONFIG: Record<
	PendingAction,
	{
		title: string;
		icon: React.ReactNode;
		confirmLabel: string;
		confirmVariant: 'primary' | 'secondary' | 'danger';
		loadingText: string;
	}
> = {
	'logout-selected': {
		title: 'Log Out Sessions',
		icon: <LogOut className="w-6 h-6" />,
		confirmLabel: 'Log Out',
		confirmVariant: 'secondary',
		loadingText: 'Logging out...',
	},
	'logout-others': {
		title: 'Log Out All Others',
		icon: <LogOut className="w-6 h-6" />,
		confirmLabel: 'Log Out',
		confirmVariant: 'secondary',
		loadingText: 'Logging out...',
	},
	'delete-selected': {
		title: 'Delete Session Records',
		icon: <Trash2 className="w-6 h-6" />,
		confirmLabel: 'Delete',
		confirmVariant: 'danger',
		loadingText: 'Deleting...',
	},
	refresh: {
		title: 'Refresh Sessions',
		icon: <RefreshCw className="w-6 h-6" />,
		confirmLabel: 'Refresh',
		confirmVariant: 'primary',
		loadingText: 'Refreshing...',
	},
};

// ==================== COMPONENT ====================

export default function SessionManagement({ onBack, onLogout }: SessionManagementProps) {
	const { user, session: authSession } = useAuth();
	const currentSessionId = authSession?.session_id ?? null;

	// Change password form
	const [cpCurrentPw, setCpCurrentPw] = useState('');
	const [cpNewPw, setCpNewPw] = useState('');
	const [cpConfirmPw, setCpConfirmPw] = useState('');
	const [cpMfaCode, setCpMfaCode] = useState('');
	const [cpKeepSessions, setCpKeepSessions] = useState(false);
	const [cpLoading, setCpLoading] = useState(false);
	const [cpError, setCpError] = useState('');
	const [cpSuccess, setCpSuccess] = useState('');
	const [cpCurrentPwError, setCpCurrentPwError] = useState('');
	const [cpNewPwError, setCpNewPwError] = useState('');
	const [cpMfaError, setCpMfaError] = useState('');

	// All sessions (password-gated)
	const passwordRef = useRef('');
	const [unlockPw, setUnlockPw] = useState('');
	const [unlockMfa, setUnlockMfa] = useState('');
	const [unlocked, setUnlocked] = useState(false);
	const [allSessions, setAllSessions] = useState<Session[]>([]);
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [unlockMfaError, setUnlockMfaError] = useState('');
	const [unlockLoading, setUnlockLoading] = useState(false);
	const [sessionsError, setSessionsError] = useState('');
	const [sessionsSuccess, setSessionsSuccess] = useState('');

	// Confirmation modal
	const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
	const [modalMfa, setModalMfa] = useState('');
	const [modalMfaError, setModalMfaError] = useState('');
	const [modalLoading, setModalLoading] = useState(false);
	const [modalError, setModalError] = useState('');

	// Clear credentials and re-lock when tab becomes hidden (security)
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.hidden) {
				passwordRef.current = '';
				setModalMfa('');
				if (unlocked) {
					setUnlocked(false);
					setAllSessions([]);
					setSelectedIds(new Set());
					setSessionsError('');
					setSessionsSuccess('');
				}
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	}, [unlocked]);

	const fetchAllSessions = useCallback(async (mfaCode?: string) => {
		try {
			const sessions = await getSessions(passwordRef.current, mfaCode || undefined);
			setAllSessions(sessions);
			setSelectedIds(new Set());
		} catch (err) {
			setSessionsError(getErrorMessage(err, 'Failed to refresh sessions'));
		}
	}, []);

	// ==================== HANDLERS ====================

	const handleUnlock = async () => {
		if (!unlockPw) return;
		if (user?.totp_enabled) {
			const mfaErr = validateMfaCode(unlockMfa || '');
			if (mfaErr) {
				setUnlockMfaError(mfaErr);
				return;
			}
		}
		setSessionsError('');
		setUnlockLoading(true);
		try {
			const sessions = await getSessions(unlockPw, unlockMfa || undefined);
			passwordRef.current = unlockPw;
			setModalMfa(unlockMfa);
			setAllSessions(sessions);
			setUnlocked(true);
			setUnlockPw('');
			setUnlockMfa('');
		} catch (err) {
			setSessionsError(getErrorMessage(err, 'Verification failed'));
		} finally {
			setUnlockLoading(false);
		}
	};

	const handleChangePassword = async () => {
		setCpError('');
		setCpSuccess('');
		if (!cpCurrentPw || !cpNewPw || !cpConfirmPw) {
			setCpError('Please fill in all required fields.');
			return;
		}
		if (cpCurrentPw.length < 8 || cpCurrentPw.length > 128) {
			setCpCurrentPwError('Must be between 8 and 128 characters long.');
			return;
		}
		if (cpNewPw.length < 8 || cpNewPw.length > 128) {
			setCpNewPwError('Must be between 8 and 128 characters long.');
			return;
		}
		if (cpCurrentPw === cpNewPw) {
			setCpError('New password must differ from your current password.');
			return;
		}
		if (cpNewPw !== cpConfirmPw) {
			setCpError('New passwords do not match.');
			return;
		}
		if (user?.totp_enabled) {
			const mfaErr = validateMfaCode(cpMfaCode);
			if (mfaErr) {
				setCpMfaError(mfaErr);
				return;
			}
		}
		setCpLoading(true);
		try {
			await changePassword(cpCurrentPw, cpNewPw, cpMfaCode || undefined, cpKeepSessions);
			setCpSuccess('Password changed successfully.');
			setCpCurrentPw('');
			setCpNewPw('');
			setCpConfirmPw('');
			setCpMfaCode('');
			setCpCurrentPwError('');
			setCpNewPwError('');
			setCpMfaError('');
			// Password changed — stored password is stale, re-lock sessions
			if (unlocked) {
				setUnlocked(false);
				setAllSessions([]);
				passwordRef.current = '';
				setSessionsError('');
				setSessionsSuccess('');
			}
		} catch (err) {
			setCpError(getErrorMessage(err, 'Failed to change password'));
		} finally {
			setCpLoading(false);
		}
	};

	const handleToggleSelect = (sessionId: number) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(sessionId)) next.delete(sessionId);
			else next.add(sessionId);
			return next;
		});
	};

	const handleRefresh = () => {
		if (user?.totp_enabled) {
			setPendingAction('refresh');
		} else {
			fetchAllSessions();
		}
	};

	const closeModal = () => {
		setPendingAction(null);
		setModalError('');
		setModalMfaError('');
		setModalLoading(false);
	};

	const handleConfirmAction = async () => {
		if (!pendingAction) return;
		if (user?.totp_enabled) {
			const mfaErr = validateMfaCode(modalMfa);
			if (mfaErr) {
				setModalMfaError(mfaErr);
				return;
			}
		}
		const mfa = modalMfa || undefined;
		setModalError('');
		setModalLoading(true);
		try {
			switch (pendingAction) {
				case 'logout-selected':
					await logoutSessions(passwordRef.current, Array.from(selectedIds), mfa);
					break;
				case 'logout-others':
					await logoutOtherSessions(passwordRef.current, mfa);
					break;
				case 'delete-selected':
					await deleteSessions(passwordRef.current, Array.from(selectedIds), mfa);
					break;
				case 'refresh':
					await fetchAllSessions(mfa);
					break;
			}
			closeModal();
			if (pendingAction !== 'refresh') {
				await fetchAllSessions(mfa);
			}
		} catch (err) {
			setModalError(getErrorMessage(err, 'Action failed'));
			setModalLoading(false);
		}
	};

	if (!user) {
		return (
			<main className="p-6 max-w-4xl mx-auto w-full" aria-busy="true">
				<div className="text-center text-stone-300 flex items-center justify-center gap-2">
					<LoadingSpinner size="md" />
					<span>Loading...</span>
				</div>
			</main>
		);
	}

	// Modal description text
	const getModalDescription = () => {
		switch (pendingAction) {
			case 'logout-selected':
				return `Log out ${selectedIds.size} selected session(s)? Those devices will need to log in again.`;
			case 'logout-others':
				return 'Log out all sessions except your current one? All other devices will need to log in again.';
			case 'delete-selected':
				return `Permanently delete ${selectedIds.size} session record(s)? This action cannot be undone.`;
			case 'refresh':
				return 'Confirm your MFA code to refresh sessions.';
			default:
				return '';
		}
	};

	const config = pendingAction ? ACTION_CONFIG[pendingAction] : null;

	return (
		<main className="p-6 max-w-4xl mx-auto w-full">
			{/* Header */}
			<header className="flex items-center justify-between mb-8 pb-4 border-b border-stone-700">
				<div className="flex items-center gap-3">
					<button
						onClick={onBack}
						className="p-2 rounded-lg hover:bg-stone-800 transition-colors text-stone-300 hover:text-stone-100"
						aria-label="Back to dashboard"
					>
						<ArrowLeft className="w-5 h-5" />
					</button>
					<div>
						<h1>Session Management</h1>
						<p className="text-stone-300 text-sm">
							Manage your sessions and security settings.
						</p>
					</div>
				</div>
				<Button
					variant="danger"
					size="sm"
					icon={<LogOut className="w-4 h-4" />}
					onClick={onLogout}
				>
					Log Out
				</Button>
			</header>

			<div className="space-y-6">
				{/* ==================== SECTION 1: CURRENT SESSION ==================== */}
				<Card accent="gold">
					<div className="flex items-center gap-2 mb-4">
						<Monitor className="w-5 h-5 text-gold-400" aria-hidden="true" />
						<h2 className="text-lg font-bold text-stone-50">Current Session</h2>
						<Badge variant="info" size="sm">
							This Device
						</Badge>
					</div>
					{authSession && (
						<div className="grid gap-3 sm:grid-cols-2">
							<InfoBlock label="Session ID" value={authSession.session_id} mono />
							<InfoBlock
								label="Last Used"
								value={formatDate(authSession.last_used_at)}
							/>
							<InfoBlock label="Created" value={formatDate(authSession.created_at)} />
							<InfoBlock
								label="Session Expiry"
								value={formatDate(authSession.login_expiry)}
								sublabel={`Expires in: ${getTimeRemaining(authSession.login_expiry)}`}
							/>
							<InfoBlock
								label="JWT Expiry"
								value={formatDate(authSession.access_expiry)}
								sublabel={`Expires in: ${getTimeRemaining(authSession.access_expiry)}`}
							/>
							{(authSession.device_name || authSession.ip_address) && (
								<InfoBlock
									label="Device Info"
									value={
										<>
											{authSession.device_name && (
												<span>{authSession.device_name}</span>
											)}
											{authSession.device_name && authSession.ip_address && (
												<br />
											)}
											{authSession.ip_address && (
												<span>IP: {authSession.ip_address}</span>
											)}
										</>
									}
								/>
							)}
						</div>
					)}
				</Card>

				{/* ==================== SECTION 2: CHANGE PASSWORD ==================== */}
				<Card>
					<div className="flex items-center gap-2 mb-4">
						<Key className="w-5 h-5 text-gold-400" aria-hidden="true" />
						<h2 className="text-lg font-bold text-stone-50">Change Password</h2>
					</div>

					{cpError && (
						<Alert
							variant="error"
							className="mb-4"
							dismissable
							onDismiss={() => setCpError('')}
						>
							{cpError}
						</Alert>
					)}
					{cpSuccess && (
						<Alert
							variant="success"
							className="mb-4"
							dismissable
							onDismiss={() => setCpSuccess('')}
						>
							{cpSuccess}
						</Alert>
					)}

					<div className="space-y-4">
						<Input
							label="Current Password"
							type="password"
							value={cpCurrentPw}
							onChange={(e) => {
								setCpCurrentPw(e.target.value);
								setCpCurrentPwError('');
							}}
							onBlur={() => {
								if (
									cpCurrentPw &&
									(cpCurrentPw.length < 8 || cpCurrentPw.length > 128)
								)
									setCpCurrentPwError(
										'Must be between 8 and 128 characters long.',
									);
							}}
							onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
							error={cpCurrentPwError}
							autoComplete="current-password"
							fullWidth
						/>
						<div className="grid gap-4 sm:grid-cols-2">
							<Input
								label="New Password"
								type="password"
								value={cpNewPw}
								onChange={(e) => {
									setCpNewPw(e.target.value);
									setCpNewPwError('');
								}}
								onBlur={() => {
									if (cpNewPw && (cpNewPw.length < 8 || cpNewPw.length > 128))
										setCpNewPwError(
											'Must be between 8 and 128 characters long.',
										);
								}}
								onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
								error={cpNewPwError}
								autoComplete="new-password"
								fullWidth
							/>
							<Input
								label="Confirm New Password"
								type="password"
								value={cpConfirmPw}
								onChange={(e) => setCpConfirmPw(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
								autoComplete="new-password"
								error={
									cpConfirmPw && cpNewPw !== cpConfirmPw
										? 'Passwords do not match'
										: undefined
								}
								fullWidth
							/>
						</div>
						{user.totp_enabled && (
							<Input
								label="MFA Code"
								type="text"
								variant="code"
								value={cpMfaCode}
								onChange={(e) => {
									setCpMfaCode(e.target.value);
									setCpMfaError('');
								}}
								onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
								placeholder="000000 or recovery code"
								error={cpMfaError}
								autoComplete="one-time-code"
							/>
						)}

						<label className="flex items-center gap-2 text-sm text-stone-300 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={cpKeepSessions}
								onChange={(e) => setCpKeepSessions(e.target.checked)}
								className="rounded border-stone-600 bg-stone-800 text-gold-400 focus:ring-gold-400/50"
							/>
							Keep other sessions logged in
						</label>

						<Button
							onClick={handleChangePassword}
							loading={cpLoading}
							loadingText="Changing..."
						>
							Change Password
						</Button>
					</div>
				</Card>

				{/* ==================== SECTION 3: ALL SESSIONS ==================== */}
				<Card>
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<ShieldAlert className="w-5 h-5 text-gold-400" aria-hidden="true" />
							<h2 className="text-lg font-bold text-stone-50">All Sessions</h2>
						</div>
						{unlocked && (
							<button
								onClick={handleRefresh}
								className="p-2 rounded-lg hover:bg-stone-800 transition-colors text-stone-400 hover:text-stone-100"
								aria-label="Refresh sessions"
							>
								<RefreshCw className="w-4 h-4" />
							</button>
						)}
					</div>

					{!unlocked ? (
						/* ---- Locked state: password gate ---- */
						<div className="space-y-4">
							<p className="text-sm text-stone-400">
								Enter your password to view and manage all active sessions.
							</p>
							{sessionsError && (
								<Alert
									variant="error"
									dismissable
									onDismiss={() => setSessionsError('')}
								>
									{sessionsError}
								</Alert>
							)}
							<Input
								label="Password"
								type="password"
								value={unlockPw}
								onChange={(e) => setUnlockPw(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
								autoComplete="current-password"
								fullWidth
							/>
							{user.totp_enabled && (
								<Input
									label="MFA Code"
									type="text"
									variant="code"
									value={unlockMfa}
									onChange={(e) => {
										setUnlockMfa(e.target.value);
										setUnlockMfaError('');
									}}
									onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
									placeholder="000000 or recovery code"
									error={unlockMfaError}
									autoComplete="one-time-code"
								/>
							)}
							<Button
								onClick={handleUnlock}
								loading={unlockLoading}
								loadingText="Verifying..."
								icon={<Lock className="w-4 h-4" />}
							>
								Unlock Sessions
							</Button>
						</div>
					) : (
						/* ---- Unlocked state: session list ---- */
						<div className="space-y-4">
							{sessionsError && (
								<Alert
									variant="error"
									dismissable
									onDismiss={() => setSessionsError('')}
								>
									{sessionsError}
								</Alert>
							)}
							{sessionsSuccess && (
								<Alert
									variant="success"
									dismissable
									onDismiss={() => setSessionsSuccess('')}
								>
									{sessionsSuccess}
								</Alert>
							)}

							{allSessions.length === 0 ? (
								<p className="text-sm text-stone-400 text-center py-4">
									No sessions found.
								</p>
							) : (
								<>
									{/* Session cards */}
									<div className="space-y-3">
										{allSessions.map((sess) => (
											<SessionRow
												key={sess.session_id}
												session={sess}
												isCurrent={sess.session_id === currentSessionId}
												isSelected={selectedIds.has(sess.session_id)}
												onToggle={() => handleToggleSelect(sess.session_id)}
											/>
										))}
									</div>

									{/* Action bar */}
									<div className="flex flex-wrap gap-3 pt-2 border-t border-stone-700">
										<Button
											variant="secondary"
											size="sm"
											onClick={() => setPendingAction('logout-selected')}
											disabled={selectedIds.size === 0}
											icon={<LogOut className="w-4 h-4" />}
										>
											Log Out Selected ({selectedIds.size})
										</Button>
										<Button
											variant="secondary"
											size="sm"
											onClick={() => setPendingAction('logout-others')}
											disabled={
												allSessions.filter(
													(s) => s.session_id !== currentSessionId,
												).length === 0
											}
											icon={<LogOut className="w-4 h-4" />}
										>
											Log Out All Others
										</Button>
										<Button
											variant="danger"
											size="sm"
											onClick={() => setPendingAction('delete-selected')}
											disabled={selectedIds.size === 0}
											icon={<Trash2 className="w-4 h-4" />}
										>
											Delete Selected Records
										</Button>
									</div>
								</>
							)}
						</div>
					)}
				</Card>
			</div>

			{/* ==================== CONFIRMATION MODAL ==================== */}
			{pendingAction && config && (
				<Modal
					onClose={closeModal}
					title={config.title}
					icon={config.icon}
					maxWidth="sm"
					footer={
						<div className="flex gap-3 w-full">
							<Button variant="secondary" onClick={closeModal} fullWidth>
								Cancel
							</Button>
							<Button
								variant={config.confirmVariant}
								onClick={handleConfirmAction}
								loading={modalLoading}
								loadingText={config.loadingText}
								fullWidth
							>
								{config.confirmLabel}
							</Button>
						</div>
					}
				>
					<div className="space-y-4">
						<p className="text-sm text-stone-300">{getModalDescription()}</p>
						{modalError && (
							<Alert variant="error" dismissable onDismiss={() => setModalError('')}>
								{modalError}
							</Alert>
						)}
						{user.totp_enabled && (
							<Input
								label="MFA Code"
								type="text"
								variant="code"
								value={modalMfa}
								onChange={(e) => {
									setModalMfa(e.target.value);
									setModalMfaError('');
								}}
								onKeyDown={(e) => e.key === 'Enter' && handleConfirmAction()}
								placeholder="000000 or recovery code"
								error={modalMfaError}
								autoComplete="one-time-code"
							/>
						)}
					</div>
				</Modal>
			)}
		</main>
	);
}
