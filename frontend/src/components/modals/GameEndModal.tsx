import { Crown, Skull, Swords, Trophy } from 'lucide-react';

import type { PlayerGameResult } from '../../contexts/LobbyContext';
import { Button, Modal } from '../ui';

interface GameEndModalProps {
	results: PlayerGameResult[];
	players: ReadonlyMap<number, { nickname: string; ready: boolean }>;
	onClose: () => void;
}

/** Placeholder results shown when the backend doesn't send stats yet. */
const PLACEHOLDER_RESULTS: PlayerGameResult[] = [
	{ player_id: 0, kills: 0, damage_dealt: 0, alive: true },
	{ player_id: 0, kills: 0, damage_dealt: 0, alive: false },
	{ player_id: 0, kills: 0, damage_dealt: 0, alive: false },
	{ player_id: 0, kills: 0, damage_dealt: 0, alive: false },
];

function getOrdinal(n: number): string {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function resolveName(
	playerId: number,
	players: ReadonlyMap<number, { nickname: string; ready: boolean }>,
	index: number,
): string {
	if (playerId === 0) return `Player ${index + 1}`;
	return players.get(playerId)?.nickname ?? `#${playerId}`;
}

function statusLabel(alive: boolean, isWinner: boolean): string {
	if (isWinner) return 'Winner';
	if (alive) return 'Survived';
	return 'Eliminated';
}

export default function GameEndModal({ results, players, onClose }: GameEndModalProps) {
	const displayResults = results.length > 0 ? results : PLACEHOLDER_RESULTS;

	return (
		<Modal
			title="Game Over"
			closable={false}
			onClose={onClose}
			icon={<Trophy className="w-6 h-6 text-gold-400" aria-hidden="true" />}
			maxWidth="md"
			footer={
				<Button variant="primary" fullWidth onClick={onClose} aria-label="Return to lobby">
					Back to Lobby
				</Button>
			}
		>
			{/* Column headers */}
			<div
				className="grid grid-cols-[2.5rem_1fr_3.5rem_5rem] gap-x-3 px-3 pb-2 text-xs font-semibold text-stone-500 uppercase tracking-wider"
				role="row"
				aria-hidden="true"
			>
				<span>Rank</span>
				<span>Player</span>
				<span className="text-center">Kills</span>
				<span className="text-right">Damage</span>
			</div>

			{/* Player rows */}
			<ul className="space-y-1.5" role="list" aria-label="Final standings">
				{displayResults.map((r, i) => {
					const isWinner = i === 0 && r.alive;
					const name = resolveName(r.player_id, players, i);
					const rank = getOrdinal(i + 1);
					const status = statusLabel(r.alive, isWinner);

					return (
						<li
							key={r.player_id === 0 ? `placeholder-${i}` : r.player_id}
							role="listitem"
							aria-label={`${rank} place: ${name}, ${status}, ${r.kills} kills, ${r.damage_dealt.toFixed(0)} damage`}
							className={`
								grid grid-cols-[2.5rem_1fr_3.5rem_5rem] gap-x-3 items-center
								px-3 py-2.5 rounded-lg transition-colors
								${
									isWinner
										? 'bg-gold-400/10 border border-gold-400/30 shadow-[0_0_12px_rgba(224,160,48,0.15)]'
										: 'bg-stone-800/60 border border-stone-700/50'
								}
							`}
						>
							{/* Rank */}
							<span
								aria-hidden="true"
								className={`text-sm font-bold ${isWinner ? 'text-gold-400' : 'text-stone-400'}`}
							>
								{rank}
							</span>

							{/* Player name + status icon */}
							<div className="flex items-center gap-2 min-w-0">
								{isWinner ? (
									<Crown
										className="w-4 h-4 text-gold-400 shrink-0"
										aria-hidden="true"
									/>
								) : r.alive ? (
									<Swords
										className="w-4 h-4 text-stone-400 shrink-0"
										aria-hidden="true"
									/>
								) : (
									<Skull
										className="w-4 h-4 text-stone-500 shrink-0"
										aria-hidden="true"
									/>
								)}
								<span
									className={`truncate font-semibold ${isWinner ? 'text-gold-300' : 'text-stone-200'}`}
								>
									{name}
								</span>
								{isWinner && (
									<span
										className="text-[0.65rem] font-bold uppercase tracking-widest text-gold-400 bg-gold-400/15 px-1.5 py-0.5 rounded"
										aria-hidden="true"
									>
										Winner
									</span>
								)}
								{r.alive && !isWinner && (
									<span
										className="text-[0.65rem] font-bold uppercase tracking-widest text-stone-400 bg-stone-700/60 px-1.5 py-0.5 rounded"
										aria-hidden="true"
									>
										Survived
									</span>
								)}
							</div>

							{/* Kills */}
							<span
								aria-hidden="true"
								className={`text-sm text-center font-mono ${isWinner ? 'text-gold-300' : 'text-stone-300'}`}
							>
								{r.kills}
							</span>

							{/* Damage dealt */}
							<span
								aria-hidden="true"
								className={`text-sm text-right font-mono ${isWinner ? 'text-gold-300' : 'text-stone-300'}`}
							>
								{r.damage_dealt.toFixed(0)}
							</span>
						</li>
					);
				})}
			</ul>
		</Modal>
	);
}
