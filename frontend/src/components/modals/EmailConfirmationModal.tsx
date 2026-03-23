import { useState, useEffect, useCallback } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { Button, Modal, Alert, Badge } from '../ui';
import { sendConfirmationEmail } from '../../api/user';
import { getErrorMessage, isAxiosError, getErrorBrief } from '../../api/error';
import { useAuth } from '../../contexts/AuthContext';
import type { User } from '../../api/types';

interface EmailConfirmationModalProps {
	user: User;
	onClose: () => void;
}

const COOLDOWN_SECONDS = 61;

export default function EmailConfirmationModal({ user, onClose }: EmailConfirmationModalProps) {
	const { refreshUser } = useAuth();
	const [confirmed, setConfirmed] = useState(user.email_confirmed_at != null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [cooldown, setCooldown] = useState(0);

	useEffect(() => {
		if (cooldown <= 0) return;
		const interval = setInterval(() => {
			setCooldown((prev) => {
				if (prev <= 1) {
					clearInterval(interval);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
		return () => clearInterval(interval);
	}, [cooldown]);

	const handleSend = async () => {
		setIsLoading(true);
		setError(null);

		try {
			await sendConfirmationEmail();
			setCooldown(COOLDOWN_SECONDS);
		} catch (err) {
			if (isAxiosError(err) && err.response?.status === 429) {
				setCooldown(COOLDOWN_SECONDS);
				setError('Too many requests. Please wait before trying again.');
			} else if (isAxiosError(err) && getErrorBrief(err) === 'AlreadyConfirmed') {
				setConfirmed(true);
			} else {
				setError(getErrorMessage(err, 'Failed to send confirmation email'));
			}
		} finally {
			setIsLoading(false);
		}
	};

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			await refreshUser();
		} catch {
			// Silently ignore refresh errors
		} finally {
			setIsRefreshing(false);
		}
	}, [refreshUser]);

	// Update confirmed state when user prop changes (after refreshUser updates context)
	useEffect(() => {
		setConfirmed(user.email_confirmed_at != null);
	}, [user.email_confirmed_at]);

	return (
		<Modal
			onClose={onClose}
			title="Email Confirmation"
			icon={<Mail className="w-6 h-6" />}
		>
			{confirmed ? (
				<div className="space-y-4">
					<Alert variant="success">
						Your email <span className="font-medium">{user.email}</span> is confirmed.
					</Alert>

					<Button onClick={onClose} fullWidth>
						Close
					</Button>
				</div>
			) : (
				<div className="space-y-4">
					{error && (
						<Alert
							variant="error"
							dismissable
							onDismiss={() => setError(null)}
						>
							{error}
						</Alert>
					)}

					<p className="text-sm text-stone-300">
						Confirming your email address helps secure your account and enables
						important notifications. A confirmation link will be sent to your
						email.
					</p>

					<div className="p-3 bg-stone-900 rounded-lg border border-stone-700/40">
						<p className="text-xs text-stone-400 mb-1">Email address</p>
						<p className="text-stone-100">{user.email}</p>
					</div>

					<div className="flex items-center gap-2">
						<Badge variant="warning" size="sm">Unconfirmed</Badge>
						<button
							onClick={handleRefresh}
							disabled={isRefreshing}
							className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 transition-colors disabled:opacity-50"
						>
							<RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
							Refresh status
						</button>
					</div>

					<Button
						onClick={handleSend}
						loading={isLoading}
						loadingText="Sending..."
						disabled={cooldown > 0}
						fullWidth
					>
						{cooldown > 0
							? `Resend in ${cooldown}s`
							: 'Send Confirmation Email'}
					</Button>
				</div>
			)}
		</Modal>
	);
}
