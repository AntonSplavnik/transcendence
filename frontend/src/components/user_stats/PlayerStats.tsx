import React from "react";
import Card from "./../ui/Card";

interface UserStats {
	games_played: number;
	total_kills: number;
	total_time_played: number;
	last_game_kills: number;
	last_game_time: number;
	last_game_at: string | null;
}

interface PlayerStatsProps {
	stats: UserStats | null;
}

/**
 * Display player statistics in a large card
 */
export default function PlayerStats({ stats }: PlayerStatsProps) {
	return (
		<section>
			<Card>
				<h2 className="text-2xl font-bold mb-6 text-primary">Player Statistics</h2>
				<div className="bg-gradient-to-br from-wood-800 to-wood-900 p-8 rounded-lg border border-wood-700">
					<div className="flex items-center justify-center gap-8">
						<div className="text-center">
							<p className="text-6xl font-bold text-blue-400">
								{stats?.games_played ?? 0}
							</p>
							<p className="text-wood-300 mt-3 text-lg">Games Played</p>
						</div>
					</div>
				</div>
			</Card>
		</section>
	);
}
