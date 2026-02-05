import { useState, useRef, useEffect } from 'react';
import { Shield, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { getErrorMessage, getErrorBrief } from '../../api/error';

interface TwoFactorLoginModalProps {
	email: string;
	getPassword: () => string;
	onSuccess: () => void;
	onCancel: () => void;
}

export default function TwoFactorLoginModal({
	email,
	getPassword,
	onSuccess,
	onCancel,
}: TwoFactorLoginModalProps) {
	const { login } = useAuth();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const codeRef = useRef<HTMLInputElement>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		const code = codeRef.current?.value || '';

		if (!code) {
			setError('Authentication code is required');
			setIsLoading(false);
			return;
		}

		try {
			const password = getPassword();
			await login(email, password, code);
			onSuccess();
		} catch (err) {
			const brief = getErrorBrief(err);
			if (brief === 'TwoFactorInvalid') {
				setError('Invalid authentication code. Please try again.');
			} else {
				setError(getErrorMessage(err, 'Authentication failed'));
			}
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Modal onClose={onCancel} title="Two-Factor Authentication" icon={<Shield className="w-6 h-6" />}>
			<p className="text-sm text-wood-300 mb-4">
				Enter the 6-digit code from your authenticator app, or use a recovery code.
			</p>

			<form onSubmit={handleSubmit} className="space-y-4">
				<div>
					<label htmlFor="mfa-code" className="block text-sm font-medium text-wood-200 mb-2">
						Authentication Code
					</label>
					<input
						ref={codeRef}
						type="text"
						id="mfa-code"
						autoFocus
						autoComplete="one-time-code"
						className="w-full px-4 py-2 bg-wood-900 border border-wood-600 rounded-lg
						         text-wood-100 placeholder-wood-500 text-center text-xl tracking-widest
						         focus:outline-none focus:border-primary"
						placeholder="000000 or recovery code"
						disabled={isLoading}
					/>
				</div>

				{error && (
					<div className="bg-red-900/50 border border-red-500 rounded p-3 flex items-start gap-2">
						<AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
						<p className="text-sm text-red-200">{error}</p>
					</div>
				)}

				<div className="flex gap-3">
					<Button type="submit" disabled={isLoading} className="flex-1">
						{isLoading ? 'Verifying...' : 'Continue'}
					</Button>
					<Button type="button" onClick={onCancel} variant="secondary">
						Cancel
					</Button>
				</div>
			</form>
		</Modal>
	);
}
