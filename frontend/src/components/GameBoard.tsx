import { Eye } from 'lucide-react';
import { Navigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { useLobby } from '../contexts/LobbyContext';
import { CHARACTER_CONFIGS, DEFAULT_CHARACTER } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';
import SimpleGameClient from './GameBoard/SimpleGameClient';
import { Badge } from './ui';

/**
 * Game view — driven entirely by GameContext.
 *
 * Rendering is gated on `gameState.status === 'active'` so that a direct URL
 * visit or stale navigation never renders the Babylon canvas without a live
 * game stream.
 *
 * Both players and spectators land here once their game stream opens.
 * Spectators see the same 3D view but with input disabled and a
 * "Spectating" overlay.
 */
export default function GameBoard() {
	const { gameState, snapshotRef, characterClassesRef, sendInput } = useGame();
	const { lobbyState } = useLobby();
	const { user } = useAuth();

	if (gameState.status === 'idle' || !user) {
		return <Navigate to="/home" replace />;
	}

	const isSpectator =
		lobbyState.status === 'active' && !lobbyState.players.has(user.id);

	const storedChar = localStorage.getItem('selectedCharacter') as CharacterChoice | null;
	const characterConfig =
		CHARACTER_CONFIGS[storedChar ?? DEFAULT_CHARACTER] ?? CHARACTER_CONFIGS[DEFAULT_CHARACTER];

	return (
		<div className="relative w-full h-screen">
			<SimpleGameClient
				snapshotRef={snapshotRef}
				characterClassesRef={characterClassesRef}
				onSendInput={sendInput}
				localPlayerId={user.id}
				characterConfig={characterConfig}
				isSpectator={isSpectator}
			/>
			{isSpectator && (
				<div className="absolute top-4 right-4 z-10">
					<Badge
						variant="neutral"
						size="md"
						className="gap-1.5 bg-stone-900/80 backdrop-blur-sm border border-stone-700/50 text-stone-200 shadow-lg"
					>
						<Eye className="w-4 h-4" aria-hidden="true" />
						Spectating
					</Badge>
				</div>
			)}
		</div>
	);
}
