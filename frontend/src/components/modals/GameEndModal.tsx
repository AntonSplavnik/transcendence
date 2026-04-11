import { Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { PlayerMatchStats } from '../../game/types';
import { Button, Modal } from '../ui';

interface GameEndModalProps {
	title: string;
	onLeave: () => void;
	stats: PlayerMatchStats[];
	localPlayerId: number;
}

const AUTO_LEAVE_SECONDS = 60;

export default function GameEndModal({ title, onLeave, stats, localPlayerId }: GameEndModalProps) {
	const [secondsLeft, setSecondsLeft] = useState(AUTO_LEAVE_SECONDS);
	const hasLeftRef = useRef(false);

	useEffect(() => {
		const id = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		if (secondsLeft <= 0 && !hasLeftRef.current) {
			hasLeftRef.current = true;
			onLeave();
		}
	}, [secondsLeft, onLeave]);

	const handleLeave = () => {
		if (hasLeftRef.current) return;
		hasLeftRef.current = true;
		onLeave();
	};

	const sorted = [...stats].sort((a, b) => a.placement - b.placement);

	return (
		<Modal
			title={title}
			icon={<Trophy className="w-6 h-6 text-gold-400" />}
			onClose={handleLeave}
			closable={false}
			maxWidth="lg"
			footer={
				<Button
					variant="primary"
					fullWidth
					onClick={handleLeave}
					autoFocus
					aria-label="Return to Lobby"
				>
					Return to Lobby ({secondsLeft}s)
				</Button>
			}
		>
			{sorted.length > 0 ? (
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<caption className="sr-only">Match results leaderboard</caption>
						<thead>
							<tr className="bg-stone-800/60 text-stone-300 text-xs uppercase tracking-wider">
								<th className="px-3 py-2 text-left">#</th>
								<th className="px-3 py-2 text-left">Player</th>
								<th className="px-3 py-2 text-left">Class</th>
								<th className="px-3 py-2 text-right">Kills</th>
								<th className="px-3 py-2 text-right">Deaths</th>
								<th className="px-3 py-2 text-right">Dmg Dealt</th>
								<th className="px-3 py-2 text-right">Dmg Taken</th>
							</tr>
						</thead>
						<tbody>
							{sorted.map((p) => {
								const isLocal = p.player_id === localPlayerId;
								const isFirst = p.placement === 1;
								return (
									<tr
										key={p.player_id}
										aria-current={isLocal ? 'true' : undefined}
										className={
											isLocal
												? 'bg-gold-400/10 border-l-2 border-l-gold-400 border-b border-stone-700/50'
												: 'border-b border-stone-700/50'
										}
									>
										<td
											className={`px-3 py-2 font-bold ${isFirst ? 'text-gold-400' : 'text-stone-300'}`}
										>
											{p.placement}
										</td>
										<td className="px-3 py-2 text-stone-200 font-medium">
											{p.name}
											{isLocal && (
												<span className="ml-1.5 text-xs text-gold-400">
													(you)
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-stone-300 capitalize">
											{p.character_class}
										</td>
										<td className="px-3 py-2 text-right text-stone-200">
											{p.kills}
										</td>
										<td className="px-3 py-2 text-right text-stone-200">
											{p.deaths}
										</td>
										<td className="px-3 py-2 text-right text-stone-200">
											{Math.round(p.damage_dealt)}
										</td>
										<td className="px-3 py-2 text-right text-stone-200">
											{Math.round(p.damage_taken)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			) : (
				<p className="text-stone-300 text-center py-6">Match complete!</p>
			)}
			{secondsLeft === 10 && (
				<span className="sr-only" role="alert">
					Returning to lobby in 10 seconds
				</span>
			)}
		</Modal>
	);
}
