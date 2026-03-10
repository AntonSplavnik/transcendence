import { User } from 'lucide-react';
import { Modal, Card, Badge } from '../ui';
import AvatarDisplay from '../ui/AvatarDisplay';
import type { PublicUser } from '../../api/types';

interface PublicProfileModalProps {
	user: PublicUser;
	onClose: () => void;
}

export default function PublicProfileModal({ user, onClose }: PublicProfileModalProps) {
	return (
		<Modal
			onClose={onClose}
			title={user.nickname}
			icon={<User className="w-6 h-6" />}
			maxWidth="sm"
		>
			<div className="space-y-4">
				{/* Avatar + status */}
				<div className="flex items-center gap-4">
					<AvatarDisplay userId={user.id} size="large" className="w-24 h-24 rounded-lg" />
					<div className="space-y-2">
						{user.online ? (
							<Badge variant="success" dot>
								Online
							</Badge>
						) : (
							<Badge variant="neutral" dot>
								Offline
							</Badge>
						)}
						<p className="text-xs text-stone-400">
							Member since {new Date(user.created_at).toLocaleDateString()}
						</p>
					</div>
				</div>

				{/* Recent history */}
				<Card variant="inset">
					<h3 className="text-sm font-semibold text-stone-300 mb-2">Recent History</h3>
					<div className="text-center text-stone-500 text-sm italic py-2">
						No recent battles recorded.
					</div>
				</Card>
			</div>
		</Modal>
	);
}
