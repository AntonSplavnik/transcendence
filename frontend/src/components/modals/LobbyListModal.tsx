import { RefreshCw, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { LobbyInfo } from '../../api/lobby';
import { listLobbies } from '../../api/lobby';
import { Badge, Button, Modal } from '../ui';
import LobbyInfoPreviewModal from './LobbyInfoPreviewModal';

interface LobbyListModalProps {
	onClose: () => void;
}

/**
 * Lists all public lobbies.  Selecting one opens `LobbyInfoPreviewModal`
 * for a join/spectate confirmation step.
 */
export default function LobbyListModal({ onClose }: LobbyListModalProps) {
	const [lobbies, setLobbies] = useState<LobbyInfo[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedLobby, setSelectedLobby] = useState<LobbyInfo | null>(null);

	const fetchLobbies = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const data = await listLobbies();
			setLobbies(data);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : 'Failed to load lobbies.');
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchLobbies();
	}, [fetchLobbies]);

	if (selectedLobby) {
		return (
			<LobbyInfoPreviewModal
				lobby={selectedLobby}
				// On cancel: go back to the list.
				// On join/spectate success: close everything — the lobby stream
				// will open and LobbyContext will navigate to /lobby automatically.
				onClose={() => setSelectedLobby(null)}
				onJoined={onClose}
			/>
		);
	}

	return (
		<Modal
			title="Find a Game"
			icon={<Users className="w-6 h-6 text-gold-400" />}
			onClose={onClose}
			maxWidth="md"
			footer={
				<Button variant="secondary" fullWidth onClick={onClose}>
					Close
				</Button>
			}
		>
			<div className="space-y-3">
				<div className="flex items-center justify-between">
					<p className="text-sm text-stone-400">
						{isLoading
							? 'Loading…'
							: `${lobbies.length} public ${lobbies.length === 1 ? 'lobby' : 'lobbies'} found`}
					</p>
					<Button
						variant="ghost"
						size="sm"
						icon={<RefreshCw className="w-3.5 h-3.5" />}
						onClick={() => void fetchLobbies()}
						loading={isLoading}
						aria-label="Refresh lobby list"
					>
						Refresh
					</Button>
				</div>

				{error && (
					<p
						className="text-sm text-danger-light rounded bg-danger/10 px-3 py-2"
						role="alert"
					>
						{error}
					</p>
				)}

				{!isLoading && !error && lobbies.length === 0 && (
					<div className="rounded-lg bg-stone-900 p-6 text-center text-stone-400 text-sm italic">
						No public lobbies available. Create one!
					</div>
				)}

				{lobbies.length > 0 && (
					<ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
						{lobbies.map((lobby) => (
							<li key={lobby.id}>
								<button
									onClick={() => setSelectedLobby(lobby)}
									className="w-full rounded-lg bg-stone-800/60 border border-stone-700 px-4 py-3 text-left hover:border-gold-400/40 hover:bg-stone-800 transition-all duration-150"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="font-medium text-stone-100 text-sm truncate">
											{lobby.settings.name}
										</span>
										<div className="flex items-center gap-2 shrink-0">
											{lobby.game_active && (
												<Badge variant="success" dot size="sm">
													In game
												</Badge>
											)}
											<span className="flex items-center gap-1 text-stone-400 text-xs">
												<Users className="w-3 h-3" aria-hidden="true" />
												{lobby.player_count}
											</span>
										</div>
									</div>
									<p className="text-xs text-stone-500 mt-0.5">
										{lobby.settings.gamemode}
									</p>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</Modal>
	);
}
