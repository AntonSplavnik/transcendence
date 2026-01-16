import React from "react";
import Card from "./../ui/Card";

interface GameHistoryItem {
	id: number;
	kills: number;
	time_played: number;
	played_at: string;
}

interface GameHistoryProps {
	history: GameHistoryItem[];
}

/**
 * Display recent game history with kills and time played
 */
export default function GameHistory({ history }: GameHistoryProps) {
	// Format time from seconds to "2m 34s" or "1h 5m"
	const formatTime = (seconds: number): string => {
		const hours = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = seconds % 60;
		
		if (hours > 0) {
			return `${hours}h ${mins}m`;
		}
		return `${mins}m ${secs}s`;
	};

	return (
		<Card>
			<h2 className="text-xl font-bold mb-2 text-wood-100">Recent History</h2>
			{history.length === 0 ? (
				<div className="bg-wood-900 rounded p-4 text-center text-wood-400 text-sm italic">
					No battles recorded yet.
				</div>
			) : (
				<div className="bg-wood-900 rounded max-h-40 overflow-y-auto">
					<div className="space-y-2 p-3">
						{history.map((game) => (
							<div
								key={game.id}
								className="flex justify-between items-center text-sm border-b border-wood-800 pb-2 last:border-0"
							>
								<span className="text-wood-300 text-xs">
									{new Date(game.played_at).toLocaleString('en-US', {
										month: '2-digit',
										day: '2-digit',
										hour: '2-digit',
										minute: '2-digit',
									})}
								</span>
								<div className="flex gap-4 text-wood-400">
									<span className="font-medium">{game.kills} kills</span>
									<span>{formatTime(game.time_played)}</span>
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</Card>
	);
}
