import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';
import { Button, Modal } from '../ui';

/**
 * Non-dismissible modal shown when the authenticated user has not accepted
 * the current Terms of Service.  The user must accept before they can use
 * any feature-level endpoint.
 */
export default function TosModal() {
	const { acceptTos } = useAuth();
	const navigate = useNavigate();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleAccept = async () => {
		setLoading(true);
		setError(null);
		try {
			await acceptTos();
			navigate('/home', { replace: true });
		} catch {
			setError('Failed to accept Terms of Service. Please try again.');
			setLoading(false);
		}
	};

	return (
		<Modal
			title="Terms of Service"
			closable={false}
			onClose={() => {}}
			icon={<FileText className="w-6 h-6 text-gold-400" />}
			footer={
				<Button
					variant="primary"
					fullWidth
					onClick={handleAccept}
					loading={loading}
					disabled={loading}
				>
					I accept the Terms of Service
				</Button>
			}
		>
			<p className="text-stone-300">
				To continue using the platform, please review and accept our updated Terms of
				Service.
			</p>
			<p className="text-stone-400 text-sm mt-3">
				You can read the full terms on the{' '}
				<Link to="/terms" className="text-gold-400 hover:underline">
					Terms of Service page
				</Link>
				.
			</p>
			{error && <p className="text-red-400 text-sm mt-3" role="alert">{error}</p>}
		</Modal>
	);
}
