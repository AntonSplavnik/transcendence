import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { useLobby } from '../contexts/LobbyContext';
import { CHARACTER_CONFIGS, DEFAULT_CHARACTER } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';
import SimpleGameClient from './GameBoard/SimpleGameClient';
import GameEndModal from './modals/GameEndModal';

/**
 * Game view — driven entirely by GameContext.
 *
 * Rendering is gated on `gameState.status === 'active'` so that a direct URL
 * visit or stale navigation never renders the Babylon canvas without a live
 * game stream.  The GameContext effect handles the idle → active navigation,
 * so this guard is belt-and-suspenders.
 *
 * When the game ends, a GameEndModal is overlaid on top of the still-visible
 * canvas.  The user dismisses the modal to navigate back to /lobby.
 *
 * Spectators are redirected to /lobby: they share the same
 * "Game" stream type as players but only receive a uni-stream (no bidi), so
 * GameContext never transitions to 'active' for them.  InGameGuard already
 * prevents spectators from being sent here, but this handles the edge case of
 * a direct URL visit.
 */
export default function GameBoard() {
	const { gameState, snapshotRef, characterClassesRef, sendInput } = useGame();
	const { lobbyState, clearGameEndResult } = useLobby();
	const { user } = useAuth();
	const navigate = useNavigate();

	const hasGameEndResult = lobbyState.status === 'active' && lobbyState.gameEndResult != null;

	const isSpectator =
		!!user &&
		gameState.status === 'idle' &&
		lobbyState.status === 'active' &&
		!lobbyState.players.has(user.id);

	// Allow staying on /game while the game-end modal is shown,
	// even though gameState has transitioned to idle.
	if (gameState.status === 'idle' && !hasGameEndResult) {
		if (!user) return <Navigate to="/home" replace />;
		return <Navigate to={isSpectator ? '/lobby' : '/home'} replace />;
	}

	const storedChar = localStorage.getItem('selectedCharacter') as CharacterChoice | null;
	const characterConfig =
		CHARACTER_CONFIGS[storedChar ?? DEFAULT_CHARACTER] ?? CHARACTER_CONFIGS[DEFAULT_CHARACTER];

	return (
		<>
			<SimpleGameClient
				snapshotRef={snapshotRef}
				characterClassesRef={characterClassesRef}
				onSendInput={sendInput}
				localPlayerId={user!.id}
				characterConfig={characterConfig}
			/>
			{hasGameEndResult && (
				<GameEndModal
					results={lobbyState.gameEndResult!.results}
					players={lobbyState.players}
					onClose={() => {
						clearGameEndResult();
						navigate('/lobby');
					}}
				/>
			)}
		</>
	);
}
