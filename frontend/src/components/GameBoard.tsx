import { Navigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { useGame } from '../contexts/GameContext';
import { useLobby } from '../contexts/LobbyContext';
import SimpleGameClient from './GameBoard/SimpleGameClient';

/**
 * Game view — driven entirely by GameContext.
 *
 * Rendering is gated on `gameState.status === 'active'` so that a direct URL
 * visit or stale navigation never renders the Babylon canvas without a live
 * game stream.  The GameContext effect handles the idle → active navigation,
 * so this guard is belt-and-suspenders.
 *
 * Spectators are redirected to /lobby: they share the same
 * "Game" stream type as players but only receive a uni-stream (no bidi), so
 * GameContext never transitions to 'active' for them.  InGameGuard already
 * prevents spectators from being sent here, but this handles the edge case of
 * a direct URL visit.
 */
export default function GameBoard() {
	const { gameState, snapshotRef, sendInput } = useGame();
	const { lobbyState } = useLobby();
	const { user } = useAuth();

	const isSpectator =
		!!user &&
		gameState.status === 'idle' &&
		lobbyState.status === 'active' &&
		!lobbyState.players.has(user.id);

	if (gameState.status === 'idle' || !user) {
		return <Navigate to={isSpectator ? '/lobby' : '/home'} replace />;
	}

	return (
		<SimpleGameClient
			snapshotRef={snapshotRef}
			onSendInput={sendInput}
			localPlayerId={user.id}
		/>
	);
}
