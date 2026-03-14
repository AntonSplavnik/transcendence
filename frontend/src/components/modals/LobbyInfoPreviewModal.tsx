import { useState } from 'react';
import { Crown, Gamepad2, Users } from 'lucide-react';

import type { LobbyInfo } from '../../api/lobby';
import { joinLobby, spectateLobby } from '../../api/lobby';
import { Badge, Button, Modal } from '../ui';

interface LobbyInfoPreviewModalProps {
	lobby: LobbyInfo;
	/** Called on cancel / back. */
	onClose: () => void;
	/**
	 * Called after a successful join or spectate API call, before the lobby
	 * stream has opened.  Use this to close any parent modals immediately so
	 * they don't flash visible while LobbyContext navigates to /lobby.
	 */
	onJoined?: () => void;
}

/**
 * Preview a lobby's details before deciding to join as player or spectator.
 *
 * On join/spectate success the Lobby stream opens and LobbyContext navigates
 * to /lobby automatically.
 */
export default function LobbyInfoPreviewModal({
	lobby,
	onClose,
	onJoined,
}: LobbyInfoPreviewModalProps) {
	const [isJoining, setIsJoining] = useState(false);
	const [isSpectating, setIsSpectating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const busy = isJoining || isSpectating;

	const handleJoin = async () => {
		setIsJoining(true);
		setError(null);
		try {
			await joinLobby(lobby.id);
			// Close parent modals immediately so they don't flash while the lobby
			// stream opens and LobbyContext navigates to /lobby.
			onJoined?.();
			onClose();
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : 'Failed to join lobby.');
		} finally {
			setIsJoining(false);
		}
	};

	const handleSpectate = async () => {
		setIsSpectating(true);
		setError(null);
		try {
			await spectateLobby(lobby.id);
			onJoined?.();
			onClose();
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : 'Failed to spectate lobby.');
		} finally {
			setIsSpectating(false);
		}
	};

	return (
		<Modal
			title={lobby.settings.name}
			icon={<Gamepad2 className="w-6 h-6 text-gold-400" />}
			onClose={onClose}
			maxWidth="sm"
			footer={
				<>
					<Button variant="secondary" fullWidth onClick={onClose} disabled={busy}>
						Back
					</Button>
					<Button
						variant="ghost"
						fullWidth
						onClick={() => void handleSpectate()}
						loading={isSpectating}
						loadingText="Joining…"
						disabled={busy}
					>
						Spectate
					</Button>
					<Button
						variant="primary"
						fullWidth
						onClick={() => void handleJoin()}
						loading={isJoining}
						loadingText="Joining…"
						disabled={busy || lobby.game_active}
					>
						Join
					</Button>
				</>
			}
		>
			<div className="space-y-3">
				{error && (
					<p className="text-sm text-danger-light rounded bg-danger/10 px-3 py-2" role="alert">
						{error}
					</p>
				)}

				{/* Meta row */}
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
					<span className="text-stone-400">
						Gamemode:{' '}
						<span className="text-stone-200">{lobby.settings.gamemode}</span>
					</span>
					<span className="text-stone-400">
						<Badge variant={lobby.settings.public ? 'info' : 'neutral'} size="sm">
							{lobby.settings.public ? 'Public' : 'Private'}
						</Badge>
					</span>
				</div>

				{/* Player list */}
				{lobby.players.length > 0 && (
					<section aria-label="Current players">
						<h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">
							<Users className="w-3.5 h-3.5" aria-hidden="true" />
							Players ({lobby.player_count})
						</h3>
						<ul className="space-y-1">
							{lobby.players.map((p) => (
								<li
									key={p.user_id}
									className="flex items-center justify-between rounded bg-stone-800/50 px-2.5 py-1.5 text-sm"
								>
									<span className="flex items-center gap-2 text-stone-200">
										{p.user_id === lobby.host_id && (
											<Crown
												className="w-3 h-3 text-gold-400 shrink-0"
												aria-label="Host"
											/>
										)}
										{p.nickname}
									</span>
									{!lobby.game_active && (
									<Badge variant={p.ready ? 'success' : 'warning'} size="sm">
										{p.ready ? 'Ready' : 'Not ready'}
									</Badge>
								)}
								</li>
							))}
						</ul>
					</section>
				)}

				{lobby.spectator_count > 0 && (
					<p className="text-sm text-stone-400">
						{lobby.spectator_count} spectator{lobby.spectator_count !== 1 ? 's' : ''} watching
					</p>
				)}

				{lobby.game_active && (
					<Badge variant="success" dot className="w-full justify-center">
						Game in progress
					</Badge>
				)}
			</div>
		</Modal>
	);
}
