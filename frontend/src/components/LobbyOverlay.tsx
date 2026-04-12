import { Clock, Users } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useGame } from '../contexts/GameContext';
import { useLobby } from '../contexts/LobbyContext';
import { formatGameMode } from '../stream/types';

/**
 * Compact lobby status indicator — shown when the user is in a lobby but not
 * on the /lobby page or in-game.
 */
export default function LobbyOverlay() {
	const { lobbyState } = useLobby();
	const { gameState } = useGame();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	// Not needed when already on the lobby page, or while in a game.
	if (lobbyState.status !== 'active' || gameState.status !== 'idle' || pathname === '/lobby') {
		return null;
	}

	const { settings, players, countdown, gameActive } = lobbyState;
	const totalCount = players.size;
	const readyCount = gameActive ? 0 : [...players.values()].filter((p) => p.ready).length;
	const allReady = !gameActive && totalCount > 0 && readyCount === totalCount;
	const hasCountdown = !gameActive && countdown !== null;

	const dotCls = gameActive
		? 'bg-success'
		: hasCountdown
			? 'bg-gold-400 animate-pulse'
			: allReady
				? 'bg-success'
				: 'bg-stone-500';

	const statusText = gameActive
		? 'In progress'
		: hasCountdown
			? 'Starting…'
			: allReady
				? 'All ready'
				: `${readyCount}/${totalCount} ready`;

	return (
		<div className="fixed top-[25%] left-4 z-40 group">
			<button
				onClick={() => navigate('/lobby')}
				className="
					flex items-center gap-0 overflow-hidden
					rounded-xl border border-stone-700 bg-stone-900/90 backdrop-blur-sm
					shadow-lg transition-all duration-200
					hover:border-gold-400/50 hover:bg-stone-800/90
					focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/50
				"
				aria-label={`Lobby: ${settings.name} — ${statusText}. Click to open lobby.`}
			>
				{/* ── Collapsed column (always visible) ── */}
				<div className="flex flex-col items-center gap-2 px-3 py-3">
					{/* Status dot */}
					<span
						className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotCls}`}
						aria-hidden="true"
					/>

					{/* Player count */}
					<span className="flex flex-col items-center leading-tight" aria-hidden="true">
						<Users className="w-3.5 h-3.5 text-stone-400" />
						<span className="text-[10px] font-semibold tabular-nums text-stone-300 mt-0.5">
							{gameActive ? totalCount : `${readyCount}/${totalCount}`}
						</span>
					</span>

					{/* Countdown icon — only while countdown is running */}
					{hasCountdown && (
						<Clock
							className="w-3.5 h-3.5 text-gold-400 animate-pulse"
							aria-hidden="true"
						/>
					)}
				</div>

				{/* ── Hover-expanded text panel ── */}
				<div
					className="
						max-w-0 overflow-hidden opacity-0
						group-hover:max-w-[160px] group-hover:opacity-100
						transition-all duration-200 ease-out
					"
					aria-hidden="true"
				>
					<div className="pr-3 py-3 whitespace-nowrap border-l border-stone-700 pl-3">
						<p className="text-sm font-medium text-stone-100 leading-tight truncate max-w-[130px]">
							{settings.name}
						</p>
						<p
							className={`text-xs mt-0.5 leading-tight ${hasCountdown ? 'text-gold-400' : allReady ? 'text-success-light' : 'text-stone-400'}`}
						>
							{statusText}
						</p>
						<p className="text-[10px] text-stone-500 mt-1 leading-tight">
							{formatGameMode(settings.gamemode)}
						</p>
					</div>
				</div>
			</button>
		</div>
	);
}
