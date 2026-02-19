import { Monitor } from "lucide-react";
import { Button, Modal, InfoBlock } from "../ui";
import type { Session } from "../../api/types";

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

		if (diff < 0) return "Expired";

		const days = Math.floor(diff / (1000 * 60 * 60 * 24));
		const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	};

	return (
		<Modal
			onClose={onClose}
			title="Session Details"
			icon={<Monitor className="w-6 h-6" />}
			maxWidth="lg"
			footer={<Button onClick={onClose} fullWidth>Close</Button>}
		>
			<div className="space-y-3">
				<InfoBlock label="Session ID" value={session.session_id} mono />
				<InfoBlock label="Created" value={formatDate(session.created_at)} />
				<InfoBlock label="Last Used" value={formatDate(session.last_used_at)} />
				<InfoBlock
					label="JWT Expiry (Access Token)"
					value={formatDate(session.access_expiry)}
					sublabel={`Expires in: ${getTimeRemaining(session.access_expiry)}`}
				/>
				<InfoBlock
					label="Session Expiry (Login Required)"
					value={formatDate(session.login_expiry)}
					sublabel={`Expires in: ${getTimeRemaining(session.login_expiry)}`}
				/>
				{(session.device_name || session.ip_address) && (
					<InfoBlock
						label="Device Information"
						value={
							<>
								{session.device_name && <span>Device: {session.device_name}</span>}
								{session.device_name && session.ip_address && <br />}
								{session.ip_address && <span>IP: {session.ip_address}</span>}
							</>
						}
					/>
				)}
			</div>
		</Modal>
	);
}
