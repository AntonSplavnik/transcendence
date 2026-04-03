import { useState, useRef, useEffect, useCallback } from 'react';
import { ShieldCheck, Download, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { deleteMyAccount, exportMyData } from '../../api/user';
import { getErrorMessage, getErrorBrief } from '../../api/error';
import { validateMfaCode } from '../../utils/validation';
import { Modal, Button, Card, Alert, Input } from '../ui';
import type { GdprInitiateResponse, DataExport } from '../../api/types';

type GdprFlowStep =
	| 'idle'
	| 'credentials'
	| 'initiating'
	| 'awaiting_email'
	| 'confirm_credentials'
	| 'executing'
	| 'done';

interface GdprFlowState {
	step: GdprFlowStep;
	token: string | null;
	emailConfirmationRequired: boolean;
	expiresAt: string | null;
	error: string | null;
	exportData: DataExport | null;
}

const INITIAL_FLOW_STATE: GdprFlowState = {
	step: 'idle',
	token: null,
	emailConfirmationRequired: false,
	expiresAt: null,
	error: null,
	exportData: null,
};

interface DataPrivacyModalProps {
	onClose: () => void;
}

export default function DataPrivacyModal({ onClose }: DataPrivacyModalProps) {
	const { user, clearAuth } = useAuth();

	const [exportFlow, setExportFlow] = useState<GdprFlowState>(INITIAL_FLOW_STATE);
	const [deleteFlow, setDeleteFlow] = useState<GdprFlowState>(INITIAL_FLOW_STATE);

	// Credential refs — kept out of state to avoid leaking via React DevTools
	const exportPasswordRef = useRef<HTMLInputElement>(null);
	const exportMfaRef = useRef<HTMLInputElement>(null);
	const deletePasswordRef = useRef<HTMLInputElement>(null);
	const deleteMfaRef = useRef<HTMLInputElement>(null);

	// Inline validation error state
	const [exportPasswordError, setExportPasswordError] = useState('');
	const [exportMfaError, setExportMfaError] = useState('');
	const [deletePasswordError, setDeletePasswordError] = useState('');
	const [deleteMfaError, setDeleteMfaError] = useState('');

	// Nickname confirmation for delete execute step
	const [deleteNickname, setDeleteNickname] = useState('');
	const [deleteNicknameError, setDeleteNicknameError] = useState('');

	// Clear credential refs on tab visibility change (security pattern from SessionManagement)
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.hidden) {
				if (exportPasswordRef.current) exportPasswordRef.current.value = '';
				if (exportMfaRef.current) exportMfaRef.current.value = '';
				if (deletePasswordRef.current) deletePasswordRef.current.value = '';
				if (deleteMfaRef.current) deleteMfaRef.current.value = '';
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	}, []);

	// Focus management — focus password input on step transitions
	useEffect(() => {
		if (exportFlow.step === 'credentials' || exportFlow.step === 'confirm_credentials') {
			exportPasswordRef.current?.focus();
		}
	}, [exportFlow.step]);

	useEffect(() => {
		if (deleteFlow.step === 'credentials' || deleteFlow.step === 'confirm_credentials') {
			deletePasswordRef.current?.focus();
		}
	}, [deleteFlow.step]);

	const validateCredentials = useCallback(
		(
			action: 'export' | 'delete',
		): { password: string; mfaCode: string | undefined } | null => {
			const passwordRef = action === 'export' ? exportPasswordRef : deletePasswordRef;
			const mfaRef = action === 'export' ? exportMfaRef : deleteMfaRef;
			const setPasswordError = action === 'export' ? setExportPasswordError : setDeletePasswordError;
			const setMfaError = action === 'export' ? setExportMfaError : setDeleteMfaError;

			const password = passwordRef.current?.value ?? '';
			const mfaCode = mfaRef.current?.value || undefined;

			let valid = true;

			if (!password) {
				setPasswordError('Password is required.');
				valid = false;
			} else {
				setPasswordError('');
			}

			if (user?.totp_enabled && mfaCode) {
				const mfaErr = validateMfaCode(mfaCode);
				if (mfaErr) {
					setMfaError(mfaErr);
					valid = false;
				} else {
					setMfaError('');
				}
			} else if (user?.totp_enabled && !mfaCode) {
				setMfaError('Authentication code is required.');
				valid = false;
			} else {
				setMfaError('');
			}

			return valid ? { password, mfaCode } : null;
		},
		[user?.totp_enabled],
	);

	// ── Initiate handler ──────────────────────────────────────
	const handleInitiate = useCallback(
		async (action: 'export' | 'delete') => {
			const creds = validateCredentials(action);
			if (!creds) return;

			const setFlow = action === 'export' ? setExportFlow : setDeleteFlow;
			setFlow(prev => ({ ...prev, step: 'initiating', error: null }));

			try {
				const apiFn = action === 'export' ? exportMyData : deleteMyAccount;
				const response = await apiFn(creds.password, creds.mfaCode);
				const initResponse = response as GdprInitiateResponse;

				setFlow(prev => ({
					...prev,
					token: initResponse.token,
					emailConfirmationRequired: initResponse.email_confirmation_required,
					expiresAt: initResponse.expires_at,
					step: initResponse.email_confirmation_required
						? 'awaiting_email'
						: 'confirm_credentials',
				}));
			} catch (err) {
				setFlow(prev => ({
					...prev,
					step: 'credentials',
					error: getErrorMessage(err, `Failed to initiate ${action}`),
				}));
			}
		},
		[validateCredentials],
	);

	// ── Execute handler ───────────────────────────────────────
	const handleExecute = useCallback(
		async (action: 'export' | 'delete') => {
			const creds = validateCredentials(action);
			if (!creds) return;

			const flow = action === 'export' ? exportFlow : deleteFlow;
			const setFlow = action === 'export' ? setExportFlow : setDeleteFlow;

			// Nickname confirmation for delete
			if (action === 'delete') {
				if (deleteNickname !== user?.nickname) {
					setDeleteNicknameError('Nickname does not match.');
					return;
				}
				setDeleteNicknameError('');
			}

			setFlow(prev => ({ ...prev, step: 'executing', error: null }));

			try {
				const apiFn = action === 'export' ? exportMyData : deleteMyAccount;
				const response = await apiFn(creds.password, creds.mfaCode, flow.token!);

				if (action === 'export') {
					const data = response as DataExport;
					triggerDownload(data);
					setExportFlow(prev => ({
						...prev,
						step: 'done',
						exportData: data,
					}));
				} else {
					setDeleteFlow(prev => ({ ...prev, step: 'done' }));
					setTimeout(() => clearAuth(), 2000);
				}
			} catch (err) {
				const brief = getErrorBrief(err);
				if (brief === 'EmailConfirmationPending') {
					setFlow(prev => ({
						...prev,
						step: 'awaiting_email',
						error: 'Please confirm via the email link before proceeding.',
					}));
				} else if (brief === 'TokenExpired' || brief === 'InvalidToken') {
					setFlow({
						...INITIAL_FLOW_STATE,
						error:
							brief === 'TokenExpired'
								? 'Your request has expired. Please start over.'
								: 'This request is invalid. Please start over.',
					});
				} else {
					setFlow(prev => ({
						...prev,
						step: 'confirm_credentials',
						error: getErrorMessage(err, `Failed to complete ${action}`),
					}));
				}
			}
		},
		[validateCredentials, exportFlow, deleteFlow, deleteNickname, user?.nickname, clearAuth],
	);

	// ── Download handler ──────────────────────────────────────
	const triggerDownload = useCallback((data: DataExport) => {
		const blob = new Blob([JSON.stringify(data, null, 2)], {
			type: 'application/json',
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `my-data-export-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}, []);

	const handleDownloadExport = useCallback(() => {
		if (!exportFlow.exportData) return;
		triggerDownload(exportFlow.exportData);
	}, [exportFlow.exportData, triggerDownload]);

	// ── Credential form (reused by both sections) ─────────────
	const renderCredentialInputs = (
		action: 'export' | 'delete',
		phase: 'initiate' | 'execute',
	) => {
		const passwordRef = action === 'export' ? exportPasswordRef : deletePasswordRef;
		const mfaRef = action === 'export' ? exportMfaRef : deleteMfaRef;
		const passwordError = action === 'export' ? exportPasswordError : deletePasswordError;
		const mfaError = action === 'export' ? exportMfaError : deleteMfaError;
		const setPasswordErr = action === 'export' ? setExportPasswordError : setDeletePasswordError;
		const setMfaErr = action === 'export' ? setExportMfaError : setDeleteMfaError;
		const flow = action === 'export' ? exportFlow : deleteFlow;
		const isLoading = flow.step === 'initiating' || flow.step === 'executing';

		const handleSubmit = () => {
			if (phase === 'initiate') handleInitiate(action);
			else handleExecute(action);
		};

		const handleKeyDown = (e: React.KeyboardEvent) => {
			if (e.key === 'Enter') handleSubmit();
		};

		return (
			<div className="space-y-3">
				{phase === 'execute' && (
					<p className="text-sm text-stone-300">
						Re-enter your credentials to complete the {action === 'export' ? 'data export' : 'account deletion'}.
					</p>
				)}

				{action === 'delete' && phase === 'execute' && (
					<Input
						label={`Type your username "${user?.nickname}" to confirm`}
						id={`${action}-nickname-confirm`}
						value={deleteNickname}
						onChange={e => {
							setDeleteNickname(e.target.value);
							setDeleteNicknameError('');
						}}
						error={deleteNicknameError}
						onKeyDown={handleKeyDown}
						autoComplete="off"
						placeholder={user?.nickname ?? ''}
					/>
				)}

				<Input
					ref={passwordRef}
					label="Password"
					type="password"
					id={`${action}-${phase}-password`}
					autoComplete="current-password"
					error={passwordError}
					onChange={() => setPasswordErr('')}
					onKeyDown={handleKeyDown}
				/>

				{user?.totp_enabled && (
					<Input
						ref={mfaRef}
						label="Authentication Code"
						variant="code"
						id={`${action}-${phase}-mfa`}
						autoComplete="one-time-code"
						placeholder="000000 or recovery code"
						error={mfaError}
						onChange={() => setMfaErr('')}
						onKeyDown={handleKeyDown}
					/>
				)}

				<div className="flex gap-3 pt-1">
					<Button
						onClick={handleSubmit}
						loading={isLoading}
						loadingText={phase === 'initiate' ? 'Verifying...' : action === 'export' ? 'Exporting...' : 'Deleting...'}
						variant={action === 'delete' && phase === 'execute' ? 'danger' : 'primary'}
						disabled={action === 'delete' && phase === 'execute' && deleteNickname !== user?.nickname}
						className="flex-1"
					>
						{phase === 'initiate'
							? 'Continue'
							: action === 'export'
								? 'Download My Data'
								: 'Permanently Delete My Account'}
					</Button>
					<Button
						onClick={() => {
							if (action === 'export') setExportFlow(INITIAL_FLOW_STATE);
							else {
								setDeleteFlow(INITIAL_FLOW_STATE);
								setDeleteNickname('');
								setDeleteNicknameError('');
							}
						}}
						variant="secondary"
					>
						Cancel
					</Button>
				</div>
			</div>
		);
	};

	// ── Awaiting email step (reused) ──────────────────────────
	const renderAwaitingEmail = (action: 'export' | 'delete') => {
		const setFlow = action === 'export' ? setExportFlow : setDeleteFlow;

		return (
			<div className="space-y-3">
				<Alert variant="info">
					<p className="font-semibold mb-1">Check your email</p>
					<p className="text-xs opacity-90">
						We sent a confirmation link to your email address. Click the link,
						then return here and press Continue. The link expires in 30 minutes.
					</p>
				</Alert>
				<Button onClick={() => setFlow(prev => ({ ...prev, step: 'confirm_credentials' }))}>
					I've Confirmed — Continue
				</Button>
			</div>
		);
	};

	return (
		<Modal onClose={onClose} title="Privacy & Data" icon={<ShieldCheck className="w-6 h-6" />} maxWidth="lg">
			{/* ── Export My Data ──────────────────────────────── */}
			<section aria-labelledby="export-heading">
				<Card accent="info">
					<div className="flex items-center gap-2 mb-3">
						<Download className="w-5 h-5 text-info" aria-hidden="true" />
						<h3 id="export-heading" className="text-lg font-bold text-stone-50">
							Export My Data
						</h3>
					</div>

					<p className="text-sm text-stone-300 mb-4">
						Download a copy of all personal data we store about you (GDPR Article 20).
						This includes your profile, sessions, friend requests, notifications, and avatars.
					</p>

					{/* Screen reader announcements */}
					<div aria-live="polite" aria-atomic="true" className="sr-only">
						{exportFlow.step === 'awaiting_email' && 'Check your email for a confirmation link.'}
						{exportFlow.step === 'done' && 'Data export complete. File has been downloaded.'}
					</div>

					{exportFlow.error && (
						<Alert
							variant="error"
							dismissable
							onDismiss={() => setExportFlow(prev => ({ ...prev, error: null }))}
							className="mb-3"
						>
							{exportFlow.error}
						</Alert>
					)}

					{exportFlow.step === 'idle' && (
						<Button
							onClick={() => setExportFlow(prev => ({ ...prev, step: 'credentials' }))}
							icon={<Download className="w-4 h-4" />}
						>
							Export My Data
						</Button>
					)}

					{(exportFlow.step === 'credentials' || exportFlow.step === 'initiating') &&
						renderCredentialInputs('export', 'initiate')}

					{exportFlow.step === 'awaiting_email' && renderAwaitingEmail('export')}

					{(exportFlow.step === 'confirm_credentials' || exportFlow.step === 'executing') &&
						renderCredentialInputs('export', 'execute')}

					{exportFlow.step === 'done' && exportFlow.exportData && (
						<div className="space-y-3">
							<Alert variant="success">
								Your data export has been downloaded.
							</Alert>
							<Button
								onClick={handleDownloadExport}
								icon={<Download className="w-4 h-4" />}
								variant="secondary"
								fullWidth
							>
								Download Again
							</Button>
						</div>
					)}
				</Card>
			</section>

			{/* ── Separator ──────────────────────────────────── */}
			<hr className="my-6 border-stone-700" />

			{/* ── Delete My Account ──────────────────────────── */}
			<section aria-labelledby="delete-heading">
				<Card accent="danger">
					<div className="flex items-center gap-2 mb-3">
						<Trash2 className="w-5 h-5 text-danger" aria-hidden="true" />
						<h3 id="delete-heading" className="text-lg font-bold text-stone-50">
							Delete My Account
						</h3>
					</div>

					<Alert variant="warning" className="mb-4">
						<p className="font-semibold mb-1">This action is permanent</p>
						<p className="text-xs opacity-90">
							Your account will be anonymized and all personal data erased.
							This includes your profile, sessions, avatars, friend requests,
							and notifications. This cannot be undone.
						</p>
					</Alert>

					{/* Screen reader announcements */}
					<div aria-live="assertive" aria-atomic="true" className="sr-only">
						{deleteFlow.step === 'awaiting_email' && 'Check your email for a confirmation link.'}
						{deleteFlow.step === 'done' && 'Your account has been deleted. Redirecting.'}
					</div>

					{deleteFlow.error && (
						<Alert
							variant="error"
							dismissable
							onDismiss={() => setDeleteFlow(prev => ({ ...prev, error: null }))}
							className="mb-3"
						>
							{deleteFlow.error}
						</Alert>
					)}

					{deleteFlow.step === 'idle' && (
						<Button
							onClick={() => setDeleteFlow(prev => ({ ...prev, step: 'credentials' }))}
							variant="danger"
							icon={<Trash2 className="w-4 h-4" />}
						>
							Delete My Account
						</Button>
					)}

					{(deleteFlow.step === 'credentials' || deleteFlow.step === 'initiating') &&
						renderCredentialInputs('delete', 'initiate')}

					{deleteFlow.step === 'awaiting_email' && renderAwaitingEmail('delete')}

					{(deleteFlow.step === 'confirm_credentials' || deleteFlow.step === 'executing') &&
						renderCredentialInputs('delete', 'execute')}

					{deleteFlow.step === 'done' && (
						<Alert variant="success">
							<p className="font-semibold mb-1">Account deleted</p>
							<p className="text-xs opacity-90">
								Your account has been permanently deleted. You will be redirected shortly.
							</p>
						</Alert>
					)}
				</Card>
			</section>
		</Modal>
	);
}
