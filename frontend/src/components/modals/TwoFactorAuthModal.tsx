import { useState, useRef } from 'react';
import { Shield, AlertCircle, Copy, Check } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import * as userApi from '../../api/user';
import { getErrorMessage } from '../../api/error';
import { useAuth } from '../../contexts/AuthContext';
import type { User } from '../../api/types';

interface TwoFactorModalProps {
	user: User;
	onClose: () => void;
	onSuccess: () => void;
}

export default function TwoFactorModal({ user, onClose, onSuccess }: TwoFactorModalProps) {
	const { refreshUser } = useAuth();
	const [step, setStep] = useState<'confirm' | 'qr' | 'verify' | 'recovery' | 'disable'>('confirm');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [qrCode, setQrCode] = useState<string | null>(null);
	const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
	const [copiedCodes, setCopiedCodes] = useState(false);

	const passwordRef = useRef<HTMLInputElement>(null);
	const mfaCodeRef = useRef<HTMLInputElement>(null);
	const verifyCodeRef = useRef<HTMLInputElement>(null);

	// Step 1: Confirm action (enable or disable)
	const handleConfirmAction = () => {
		if (user.totp_enabled) {
			setStep('disable');
		} else {
			setStep('qr');
		}
	};

	// Step 2: Start 2FA enrollment (get QR code)
	const handleStart2FA = async () => {
		const password = passwordRef.current?.value || '';

		if (!password) {
			setError('Password is required');
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			const response = await userApi.start2FA(password);
			setQrCode(response.qr_base64);
			setStep('verify');
		} catch (err) {
			setError(getErrorMessage(err, 'Failed to start 2FA setup'));
		} finally {
			setIsLoading(false);
		}
	};

	// Step 3: Confirm 2FA with code
	const handleConfirm2FA = async () => {
		const password = passwordRef.current?.value || '';
		const code = verifyCodeRef.current?.value || '';

		if (!password || !code) {
			setError('Password and verification code are required');
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			const response = await userApi.confirm2FA(password, code);
			await refreshUser();
			setRecoveryCodes(response.recovery_codes);
			setStep('recovery');
		} catch (err) {
			setError(getErrorMessage(err, 'Invalid verification code'));
		} finally {
			setIsLoading(false);
		}
	};

	// Disable 2FA
	const handleDisable2FA = async () => {
		const password = passwordRef.current?.value || '';
		const mfaCode = mfaCodeRef.current?.value || '';

		if (!password || !mfaCode) {
			setError('Password and 2FA code are required to disable 2FA');
			return;
		}

		setIsLoading(true);
		setError(null);

		try {
			await userApi.disable2FA(password, mfaCode);
			await refreshUser();
			onSuccess();
		} catch (err) {
			setError(getErrorMessage(err, 'Failed to disable 2FA'));
		} finally {
			setIsLoading(false);
		}
	};

	// Copy recovery codes to clipboard
	const handleCopyRecoveryCodes = async () => {
		const text = recoveryCodes.join('\n');
		try {
			await navigator.clipboard.writeText(text);
			setCopiedCodes(true);
		} catch (err) {
			console.error('Failed to copy recovery codes:', err);
		}
	};

	return (
		<Modal onClose={onClose} title="Two-Factor Authentication" icon={<Shield className="w-6 h-6" />}>
			{error && (
				<div className="bg-red-900/50 border border-red-500 rounded p-3 flex items-start gap-2 mb-4">
					<AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
					<p className="text-sm text-red-200">{error}</p>
				</div>
			)}

			{/* Step 1: Confirm Action */}
			{step === 'confirm' && (
				<div className="space-y-4">
					<div className="bg-wood-900 rounded p-4">
						<p className="text-sm text-wood-300 mb-2">Current Status:</p>
						<p className="text-lg font-semibold">
							{user.totp_enabled ? (
								<span className="text-green-400">Enabled</span>
							) : (
								<span className="text-yellow-400">Disabled</span>
							)}
						</p>
						{user.totp_confirmed_at && (
							<p className="text-xs text-wood-400 mt-1">
								Activated: {new Date(user.totp_confirmed_at).toLocaleDateString()}
							</p>
						)}
					</div>

					<p className="text-sm text-wood-300">
						{user.totp_enabled
							? 'Disabling 2FA will make your account less secure. You will only need your password to log in.'
							: 'Two-factor authentication adds an extra layer of security. You\'ll need a code from your authenticator app when logging in.'}
					</p>

					<div className="flex gap-3">
						<Button
							onClick={handleConfirmAction}
							variant={user.totp_enabled ? 'secondary' : 'primary'}
							className="flex-1"
						>
							{user.totp_enabled ? 'Disable 2FA' : 'Enable 2FA'}
						</Button>
						<Button onClick={onClose} variant="secondary">
							Cancel
						</Button>
					</div>
				</div>
			)}

			{/* Password input - persists across qr and verify steps to preserve ref */}
			{(step === 'qr' || step === 'verify') && (
				<div className={step === 'verify' ? 'hidden' : ''}>
					<label htmlFor="password" className="block text-sm font-medium text-wood-200 mb-2">
						Password
					</label>
					<input
						ref={passwordRef}
						type="password"
						id="password"
						autoFocus
						autoComplete="current-password"
						className="w-full px-4 py-2 bg-wood-900 border border-wood-600 rounded-lg
						         text-wood-100 focus:outline-none focus:border-primary"
						placeholder="Enter your password"
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !isLoading) handleStart2FA();
						}}
					/>
				</div>
			)}

			{/* Step 2: Enter Password & Get QR Code */}
			{step === 'qr' && (
				<div className="space-y-4">
					<p className="text-sm text-wood-300">
						Enter your password to generate a QR code for your authenticator app.
					</p>

					<div className="flex gap-3">
						<Button onClick={handleStart2FA} disabled={isLoading} className="flex-1">
							{isLoading ? 'Generating...' : 'Continue'}
						</Button>
						<Button onClick={() => setStep('confirm')} variant="secondary">
							Back
						</Button>
					</div>
				</div>
			)}

			{/* Step 3: Scan QR & Verify Code */}
			{step === 'verify' && qrCode && (
				<div className="space-y-4">
					<p className="text-sm text-wood-300">
						Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
					</p>

					{/* QR Code */}
					<div className="bg-white p-4 rounded-lg flex items-center justify-center">
						<img src={`data:image/png;base64,${qrCode}`} alt="2FA QR Code" className="max-w-full" />
					</div>

					<p className="text-sm text-wood-300">
						Enter the 6-digit code from your authenticator app to confirm setup:
					</p>

					<div>
						<label htmlFor="verify-code" className="block text-sm font-medium text-wood-200 mb-2">
							Verification Code
						</label>
						<input
							ref={verifyCodeRef}
							type="text"
							id="verify-code"
							autoFocus
							maxLength={6}
							autoComplete="one-time-code"
							className="w-full px-4 py-2 bg-wood-900 border border-wood-600 rounded-lg
							         text-wood-100 text-center text-2xl tracking-widest focus:outline-none focus:border-primary"
							placeholder="000000"
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !isLoading) handleConfirm2FA();
							}}
						/>
					</div>

					<div className="flex gap-3">
						<Button onClick={handleConfirm2FA} disabled={isLoading} className="flex-1">
							{isLoading ? 'Verifying...' : 'Confirm'}
						</Button>
						<Button onClick={() => setStep('qr')} variant="secondary">
							Back
						</Button>
					</div>
				</div>
			)}

			{/* Step: Disable 2FA - Enter password and current MFA code */}
			{step === 'disable' && (
				<div className="space-y-4">
					<p className="text-sm text-wood-300">
						Enter your password and current 2FA code to disable two-factor authentication.
					</p>

					<div>
						<label htmlFor="disable-password" className="block text-sm font-medium text-wood-200 mb-2">
							Password
						</label>
						<input
							ref={passwordRef}
							type="password"
							id="disable-password"
							autoFocus
							autoComplete="current-password"
							className="w-full px-4 py-2 bg-wood-900 border border-wood-600 rounded-lg
							         text-wood-100 focus:outline-none focus:border-primary"
							placeholder="Enter your password"
						/>
					</div>

					<div>
						<label htmlFor="disable-mfa" className="block text-sm font-medium text-wood-200 mb-2">
							Authentication Code
						</label>
						<input
							ref={mfaCodeRef}
							type="text"
							id="disable-mfa"
							autoComplete="one-time-code"
							className="w-full px-4 py-2 bg-wood-900 border border-wood-600 rounded-lg
							         text-wood-100 text-center text-xl tracking-widest focus:outline-none focus:border-primary"
							placeholder="000000 or recovery code"
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !isLoading) handleDisable2FA();
							}}
						/>
					</div>

					<div className="flex gap-3">
						<Button onClick={handleDisable2FA} disabled={isLoading} className="flex-1">
							{isLoading ? 'Disabling...' : 'Disable 2FA'}
						</Button>
						<Button onClick={() => setStep('confirm')} variant="secondary">
							Back
						</Button>
					</div>
				</div>
			)}

			{/* Step 4: Show Recovery Codes */}
			{step === 'recovery' && (
				<div className="space-y-4">
					<div className="bg-yellow-900/50 border border-yellow-600 rounded p-4">
						<p className="text-sm text-yellow-200 font-semibold mb-2">
							Save Your Recovery Codes
						</p>
						<p className="text-xs text-yellow-300">
							Store these codes in a safe place. You'll need them to access your account if you lose your authenticator device.
						</p>
					</div>

					<div className="bg-wood-900 rounded p-4">
						<div className="flex items-center justify-between mb-2">
							<p className="text-sm font-medium text-wood-200">Recovery Codes</p>
							<button
								onClick={handleCopyRecoveryCodes}
								className="flex items-center gap-1 text-xs text-primary hover:text-primary-light"
							>
								{copiedCodes ? (
									<>
										<Check className="w-4 h-4" />
										Copied!
									</>
								) : (
									<>
										<Copy className="w-4 h-4" />
										Copy
									</>
								)}
							</button>
						</div>
						<div className="space-y-1 font-mono text-sm text-wood-300">
							{recoveryCodes.map((code, index) => (
								<div key={index} className="bg-wood-800 px-2 py-1 rounded">
									{code}
								</div>
							))}
						</div>
					</div>

					<Button onClick={onSuccess} className="w-full">
						Done
					</Button>
				</div>
			)}
		</Modal>
	);
}
