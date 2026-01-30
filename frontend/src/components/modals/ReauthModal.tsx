import { useState, useRef } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import { useAuth } from '../../contexts/AuthContext';
import { getErrorMessage } from '../../api/error';

interface ReauthModalProps {
	onSuccess: () => void;
	onCancel: () => void;
	requireMfa?: boolean;
}

export default function ReauthModal({ onSuccess, onCancel, requireMfa = false }: ReauthModalProps) {
	const { reauth, user } = useAuth();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const passwordRef = useRef<HTMLInputElement>(null);
	const mfaRef = useRef<HTMLInputElement>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		const password = passwordRef.current?.value || '';
		const mfaCode = mfaRef.current?.value || undefined;

		if (!password) {
			setError('Password is required');
			setIsLoading(false);
			return;
		}

		if (requireMfa && user?.totp_enabled && !mfaCode) {
			setError('2FA code is required');
			setIsLoading(false);
			return;
		}

		try {
			await reauth(password, mfaCode);
			onSuccess();
		} catch (err) {
			setError(getErrorMessage(err, 'Re-authentication failed'));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
			<div className="bg-wood-800 border-2 border-wood-600 rounded-lg p-6 max-w-md w-full">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-2xl font-bold text-wood-100 flex items-center gap-2">
						<Lock className="w-6 h-6" />
						Re-authenticate
					</h2>
					<button
						onClick={onCancel}
						className="text-wood-400 hover:text-wood-200 text-2xl leading-none"
					>
						×
					</button>
				</div>

				<p className="text-sm text-wood-300 mb-4">
					Your session is expiring soon. Please enter your password to continue.
				</p>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Password Input */}
					<div>
						<label htmlFor="password" className="block text-sm font-medium text-wood-200 mb-2">
							Password
						</label>
						<input
							ref={passwordRef}
							type="password"
							id="password"
							autoComplete="current-password"
							className="w-full px-4 py-2 bg-wood-900 border border-wood-600 rounded-lg 
							         text-wood-100 placeholder-wood-500 focus:outline-none focus:border-primary"
							placeholder="Enter your password"
							disabled={isLoading}
						/>
					</div>

					{/* 2FA Input (if enabled) */}
					{user?.totp_enabled && (
						<div>
							<label htmlFor="mfa" className="block text-sm font-medium text-wood-200 mb-2">
								2FA Code
							</label>
							<input
								ref={mfaRef}
								type="text"
								id="mfa"
								autoComplete="one-time-code"
								maxLength={6}
								className="w-full px-4 py-2 bg-wood-900 border border-wood-600 rounded-lg 
								         text-wood-100 placeholder-wood-500 focus:outline-none focus:border-primary"
								placeholder="000000"
								disabled={isLoading}
							/>
						</div>
					)}

					{/* Error Message */}
					{error && (
						<div className="bg-red-900/50 border border-red-500 rounded p-3 flex items-start gap-2">
							<AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
							<p className="text-sm text-red-200">{error}</p>
						</div>
					)}

					{/* Buttons */}
					<div className="flex gap-3">
						<Button type="submit" disabled={isLoading} className="flex-1">
							{isLoading ? 'Verifying...' : 'Continue'}
						</Button>
						<Button type="button" onClick={onCancel} variant="secondary">
							Cancel
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
