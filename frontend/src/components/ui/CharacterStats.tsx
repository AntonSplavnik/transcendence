import { CHARACTER_CONFIGS } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';

export interface CharacterStatsProps {
	character: CharacterChoice | null;
}

const STAT_BARS = [
	{ key: 'attack' as const, label: 'Attack', barClass: 'from-gold-400 to-gold-300' },
	{ key: 'defense' as const, label: 'Defense', barClass: 'from-info to-info-light' },
	{ key: 'speed' as const, label: 'Speed', barClass: 'from-success to-success-light' },
	{ key: 'health' as const, label: 'Health', barClass: 'from-danger to-danger-light' },
];

export default function CharacterStats({ character }: CharacterStatsProps) {
	const cfg = character ? CHARACTER_CONFIGS[character] : null;

	if (!cfg) {
		return (
			<div
				className="flex items-center justify-center bg-stone-900 border-l border-stone-800"
				style={{ flex: '8 1 0%' }}
			>
				<p className="text-sm text-stone-600 italic">Select a champion</p>
			</div>
		);
	}

	return (
		<div
			className="flex flex-col gap-4 p-5 bg-stone-900 border-l border-stone-800 overflow-y-auto"
			style={{ flex: '8 1 0%' }}
		>
			{/* Name + class */}
			<div>
				<h2 className="text-2xl font-black text-gold-400 uppercase tracking-wide leading-tight">
					{cfg.label}
				</h2>
				<p className="text-xs text-stone-400 uppercase tracking-widest mt-1">
					{cfg.characterClass}
				</p>
			</div>

			<div className="h-px bg-gradient-to-r from-gold-400 to-transparent opacity-25" />

			{/* Stat bars */}
			<div className="flex flex-col gap-3">
				{STAT_BARS.map(({ key, label, barClass }) => (
					<div key={key}>
						<span className="text-[10px] text-stone-500 uppercase tracking-widest">
							{label}
						</span>
						<div className="mt-1 h-[7px] rounded bg-stone-950 border border-stone-800">
							<div
								className={`h-full rounded bg-gradient-to-r ${barClass} transition-all duration-300`}
								style={{ width: `${cfg.stats[key] * 10}%` }}
							/>
						</div>
					</div>
				))}
			</div>

			<div className="h-px bg-stone-800" />

			{/* Weapons */}
			<div>
				<span className="text-[9px] text-stone-500 uppercase tracking-widest block mb-2">
					Equipment
				</span>
				<div className="flex flex-col gap-1">
					{cfg.weapons.map((w) => (
						<span key={w} className="text-sm text-stone-300">
							{w}
						</span>
					))}
				</div>
			</div>

			{/* Playstyle */}
			<div>
				<span className="text-[9px] text-stone-500 uppercase tracking-widest block mb-2">
					Playstyle
				</span>
				<p className="text-sm text-stone-400 leading-relaxed">{cfg.description}</p>
			</div>
		</div>
	);
}
