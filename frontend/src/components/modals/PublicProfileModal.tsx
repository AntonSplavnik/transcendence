import { User } from 'lucide-react';
import type { PublicUser } from '../../api/types';
import { Badge, Card, Modal } from '../ui';
import AvatarDisplay from '../ui/AvatarDisplay';

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
					<AvatarDisplay
						userId={user.id}
						size="large"
						className="w-24 h-24 rounded-lg"
						alt={`${user.nickname}'s avatar`}
					/>
					<div className="space-y-2">
						{/* Visual badge hidden from SR — the live region below handles announcements */}
						<span aria-hidden="true">
							{user.online ? (
								<Badge variant="success" dot>
									Online
								</Badge>
							) : (
								<Badge variant="neutral" dot>
									Offline
								</Badge>
							)}
						</span>
						{/* Single persistent live region — always in DOM, text content changes */}
						<span aria-live="polite" className="sr-only">
							{user.online ? 'Online' : 'Offline'}
						</span>
						<p className="text-xs text-stone-300">
							Member since {new Date(user.created_at).toLocaleDateString()}
						</p>
					</div>
				</div>

				{/* Description */}
				{user.description && (
					<Card variant="inset">
						<h3 className="text-sm font-semibold text-stone-300 mb-2">About</h3>
						<p className="text-sm text-stone-400 whitespace-pre-wrap">
							{user.description}
						</p>
					</Card>
				)}
			</div>
		</Modal>
	);
}
