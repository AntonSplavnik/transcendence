import { CHARACTER_CONFIGS } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';

export interface CharacterStatsProps {
	character: CharacterChoice | null;
}

const STAT_BARS = [
	{
		key: 'attack' as const,
		label: 'Attack',
		gradient: 'linear-gradient(to right, #d97706, #f59e0b)',
	},
	{
		key: 'defense' as const,
		label: 'Defense',
		gradient: 'linear-gradient(to right, #3b82f6, #60a5fa)',
	},
	{
		key: 'speed' as const,
		label: 'Speed',
		gradient: 'linear-gradient(to right, #10b981, #34d399)',
	},
	{
		key: 'health' as const,
		label: 'Health',
		gradient: 'linear-gradient(to right, #ef4444, #f87171)',
	},
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
			className="flex flex-col overflow-y-auto bg-stone-900 border-l border-stone-800"
			style={{ flex: '8 1 0%', gap: '14px', padding: '20px 22px' }}
		>
			{/* Name + class */}
			<div>
				<h2 className="text-3xl font-black text-gold-400 uppercase tracking-wide leading-tight">
					{cfg.label}
				</h2>
				<p
					className="uppercase tracking-widest mt-1 text-stone-300"
					style={{ fontSize: '13px' }}
				>
					{cfg.characterClass}
				</p>
			</div>

			<div className="h-px bg-gradient-to-r from-gold-400 to-transparent opacity-25" />

			{/* Stat bars */}
			<div className="flex flex-col" style={{ gap: '11px' }}>
				{STAT_BARS.map(({ key, label, gradient }) => (
					<div key={key}>
						<div
							className="uppercase text-stone-350"
							style={{ fontSize: '12px', marginBottom: '5px' }}
						>
							{label}
						</div>
						<div
							className="border border-stone-800"
							style={{ height: '11px', background: '#0e0e10', borderRadius: '3px' }}
						>
							<div
								style={{
									height: '100%',
									width: `${cfg.stats[key] * 10}%`,
									background: gradient,
									borderRadius: '3px',
									transition: 'width 300ms',
								}}
							/>
						</div>
					</div>
				))}
			</div>

			<div className="h-px bg-stone-800" />

			{/* Weapons */}
			<div>
				<div
					className="uppercase text-stone-350 block"
					style={{ fontSize: '11px', marginBottom: '6px', letterSpacing: '0.12em' }}
				>
					Equipment
				</div>
				<div className="flex flex-col gap-1.5">
					{cfg.weapons.map((w) => (
						<span key={w} className="text-stone-300" style={{ fontSize: '14px' }}>
							{w}
						</span>
					))}
				</div>
			</div>

			{/* Playstyle */}
			<div>
				<div
					className="uppercase text-stone-350 block"
					style={{ fontSize: '11px', marginBottom: '6px', letterSpacing: '0.12em' }}
				>
					Playstyle
				</div>
				<p
					className="text-stone-300"
					style={{ fontSize: '14px', margin: 0, lineHeight: '1.5' }}
				>
					{cfg.description}
				</p>
			</div>
		</div>
	);
}
