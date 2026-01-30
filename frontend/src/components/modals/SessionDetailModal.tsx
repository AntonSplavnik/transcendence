import { Monitor } from 'lucide-react';
import Button from "../ui/Button";
import type { Session } from '../../api/types';

interface SessionDetailsModalProps {
	session: Session;
	onClose: () => void;
}

export default function SessionDetailsModal({ session, onClose }: SessionDetailsModalProps) {
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
