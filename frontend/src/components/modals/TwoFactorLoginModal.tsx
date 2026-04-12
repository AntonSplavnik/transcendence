import { Shield } from 'lucide-react';
import { useRef, useState } from 'react';
import { getErrorBrief, getErrorMessage } from '../../api/error';
import { useAuth } from '../../contexts/AuthContext';
import { validateMfaCode } from '../../utils/validation';
import { Alert, Button, Input, Modal } from '../ui';

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
	const [codeError, setCodeError] = useState('');
	const codeRef = useRef<HTMLInputElement>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setCodeError('');

		const code = codeRef.current?.value || '';

		const mfaErr = validateMfaCode(code);
		if (mfaErr) {
			setCodeError(mfaErr);
			return;
		}

		setIsLoading(true);

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
		<Modal
			onClose={onCancel}
			title="Two-Factor Authentication"
			icon={<Shield className="w-6 h-6" />}
		>
			<p className="text-sm text-stone-300 mb-4">
				Enter the 6-digit code from your authenticator app, or use a recovery code.
			</p>

			<form
				onSubmit={handleSubmit}
				className="space-y-4"
				aria-label="Two-factor authentication form"
			>
				<Input
					ref={codeRef}
					label="Authentication Code"
					variant="code"
					id="mfa-code"
					autoFocus
					autoComplete="one-time-code"
					placeholder="000000 or recovery code"
					error={codeError}
					onChange={() => setCodeError('')}
					disabled={isLoading}
				/>

				{error && <Alert variant="error">{error}</Alert>}

				<div className="flex gap-3">
					<Button
						type="submit"
						loading={isLoading}
						loadingText="Verifying..."
						className="flex-1"
					>
						Continue
					</Button>
					<Button type="button" onClick={onCancel} variant="secondary">
						Cancel
					</Button>
				</div>
			</form>
		</Modal>
	);
}
