import { useState } from 'react';
import { Hash } from 'lucide-react';

import type { LobbyInfo } from '../../api/lobby';
import { getLobby } from '../../api/lobby';
import { Button, Input, Modal } from '../ui';
import LobbyInfoPreviewModal from './LobbyInfoPreviewModal';

interface JoinByCodeModalProps {
	onClose: () => void;
}

/**
 * Two-step join-by-code flow:
 *   1. User enters a lobby ULID code.
 *   2. Code is looked up → `LobbyInfoPreviewModal` shows details.
 *   3. User chooses to Join, Spectate, or dismiss.
 *
 * On successful join/spectate the Lobby stream opens and LobbyContext
 * navigates to /lobby automatically.
 */
export default function JoinByCodeModal({ onClose }: JoinByCodeModalProps) {
	const [code, setCode] = useState('');
	const [isLooking, setIsLooking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [lobby, setLobby] = useState<LobbyInfo | null>(null);

	const handleLookup = async () => {
		const trimmed = code.trim();
		if (!trimmed) {
			setError('Please enter a lobby code.');
			return;
		}
		setIsLooking(true);
		setError(null);
		try {
			const info = await getLobby(trimmed);
			setLobby(info);
		} catch {
			setError('Lobby not found. Check the code and try again.');
		} finally {
			setIsLooking(false);
		}
	};

	// Once we have a lobby, hand off to the preview modal.
	if (lobby) {
		return (
			<LobbyInfoPreviewModal
				lobby={lobby}
				onClose={() => setLobby(null)} // back to code entry
				onJoined={onClose} // close everything on join
			/>
		);
	}

	return (
		<Modal
			title="Join by Code"
			icon={<Hash className="w-6 h-6 text-gold-400" />}
			onClose={onClose}
			maxWidth="sm"
			footer={
				<>
					<Button variant="secondary" fullWidth onClick={onClose} disabled={isLooking}>
						Cancel
					</Button>
					<Button
						variant="primary"
						fullWidth
						onClick={() => void handleLookup()}
						loading={isLooking}
						loadingText="Looking up…"
					>
						Look Up
					</Button>
				</>
			}
		>
			<div className="space-y-4">
				{error && (
					<p className="text-sm text-danger-light rounded bg-danger/10 px-3 py-2" role="alert">
						{error}
					</p>
				)}

				<Input
					label="Lobby code"
					value={code}
					onChange={(e) => setCode(e.target.value)}
					placeholder="01JXXXXXXXXXXXXXXXXXXXXXXXXX"
					hint="Paste the full lobby code shared by the host."
					autoFocus
					onKeyDown={(e) => {
						if (e.key === 'Enter') void handleLookup();
					}}
				/>
			</div>
		</Modal>
	);
}
