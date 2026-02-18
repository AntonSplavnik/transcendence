import { useState, useRef } from "react";
import { Lock } from "lucide-react";
import { Button, Modal, Input, Alert } from "../ui";
import { useAuth } from "../../contexts/AuthContext";
import { getErrorMessage } from "../../api/error";

interface ReauthModalProps {
	onSuccess: () => void;
	onCancel: () => void;
}

export default function ReauthModal({ onSuccess, onCancel }: ReauthModalProps) {
	const { reauth, user } = useAuth();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const passwordRef = useRef<HTMLInputElement>(null);
	const mfaRef = useRef<HTMLInputElement>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setIsLoading(true);

		const password = passwordRef.current?.value || "";
		const mfaCode = mfaRef.current?.value || undefined;

		if (!password) {
			setError("Password is required");
			setIsLoading(false);
			return;
		}

		if (user?.totp_enabled && !mfaCode) {
			setError("2FA code is required");
			setIsLoading(false);
			return;
		}

		try {
			await reauth(password, mfaCode);
			if (passwordRef.current) passwordRef.current.value = "";
			onSuccess();
		} catch (err) {
			setError(getErrorMessage(err, "Re-authentication failed"));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Modal onClose={onCancel} title="Re-authenticate" icon={<Lock className="w-6 h-6" />}>
			<p className="text-sm text-stone-300 mb-4">
				Your session is expiring soon. Please enter your password to continue.
			</p>

			<form onSubmit={handleSubmit} className="space-y-4" aria-label="Re-authentication form">
				<Input
					ref={passwordRef}
					label="Password"
					type="password"
					id="reauth-password"
					autoFocus
					autoComplete="current-password"
					placeholder="Enter your password"
					disabled={isLoading}
				/>

				{user?.totp_enabled && (
					<Input
						ref={mfaRef}
						label="2FA Code"
						type="text"
						id="reauth-mfa"
						autoComplete="one-time-code"
						placeholder="000000"
						disabled={isLoading}
					/>
				)}

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
