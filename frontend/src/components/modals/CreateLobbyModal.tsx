import { useState } from 'react';
import { Gamepad2 } from 'lucide-react';

import { createLobby } from '../../api/lobby';
import type { LobbySettings } from '../../api/lobby';
import { Button, Input, Modal } from '../ui';

interface CreateLobbyModalProps {
	onClose: () => void;
}

/**
 * Form for creating a new lobby.
 *
 * On success the server opens the Lobby uni-stream, LobbyContext handles it,
 * and navigation to /lobby is driven by the idle → active effect there.
 * This modal just needs to close itself after the API call succeeds.
 */
export default function CreateLobbyModal({ onClose }: CreateLobbyModalProps) {
	const [name, setName] = useState('');
	const [gamemode, setGamemode] = useState('default');
	const [isPublic, setIsPublic] = useState(true);
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleCreate = async () => {
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError('Lobby name is required.');
			return;
		}

		const settings: LobbySettings = {
			name: trimmedName,
			gamemode: gamemode.trim() || 'default',
			public: isPublic,
		};

		setIsCreating(true);
		setError(null);
		try {
			await createLobby(settings);
			// Navigation to /lobby is automatic once the Lobby stream opens.
			onClose();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to create lobby.';
			setError(msg);
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<Modal
			title="Create Lobby"
			icon={<Gamepad2 className="w-6 h-6 text-gold-400" />}
			onClose={onClose}
			maxWidth="sm"
			footer={
				<>
					<Button variant="secondary" fullWidth onClick={onClose} disabled={isCreating}>
						Cancel
					</Button>
					<Button
						variant="primary"
						fullWidth
						onClick={() => void handleCreate()}
						loading={isCreating}
						loadingText="Creating…"
					>
						Create
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
					label="Lobby name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="My lobby"
					maxLength={32}
					autoFocus
				/>

				<Input
					label="Gamemode"
					value={gamemode}
					onChange={(e) => setGamemode(e.target.value)}
					placeholder="default"
					maxLength={32}
				/>

				<label className="flex items-center gap-3 cursor-pointer select-none">
					<input
						type="checkbox"
						checked={isPublic}
						onChange={(e) => setIsPublic(e.target.checked)}
						className="w-4 h-4 accent-gold-400"
					/>
					<span className="text-sm text-stone-300">Public lobby (visible in lobby list)</span>
				</label>
			</div>
		</Modal>
	);
}
