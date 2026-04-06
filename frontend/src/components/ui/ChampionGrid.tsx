import { CHARACTER_CONFIGS } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';

export interface ChampionGridProps {
	value: CharacterChoice | null;
	onChange: (character: CharacterChoice) => void;
}

export default function ChampionGrid({ value, onChange }: ChampionGridProps) {
	const characters = Object.entries(CHARACTER_CONFIGS) as [
		CharacterChoice,
		(typeof CHARACTER_CONFIGS)[CharacterChoice],
	][];

	return (
		<div
			className="flex flex-col gap-3 p-4 bg-stone-900 border-r border-stone-800 overflow-hidden"
			style={{ flex: '8 1 0%' }}
		>
			<span className="text-[9px] text-stone-500 uppercase tracking-widest">Champions</span>
			<div className="grid grid-cols-3 gap-2 content-start">
				{characters.map(([id, cfg]) => {
					const selected = value === id;
					return (
						<button
							key={id}
							type="button"
							aria-label={`Select ${cfg.label}`}
							aria-pressed={selected}
							onClick={() => onChange(id)}
							className={`aspect-square rounded-lg border-2 relative overflow-hidden transition-all duration-200 cursor-pointer ${
								selected
									? 'border-gold-400 shadow-[0_0_14px_2px_rgba(224,160,48,0.45)]'
									: 'border-stone-700 opacity-60 hover:opacity-80 hover:border-stone-600'
							}`}
							style={{
								background: `linear-gradient(to bottom, ${cfg.previewBgColor}, #0e0e10)`,
							}}
						>
							<div className="absolute inset-0 bg-gradient-to-t from-stone-950 to-transparent opacity-60" />
							<span
								className={`absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-bold tracking-wide ${
									selected ? 'text-gold-400' : 'text-stone-400'
								}`}
							>
								{cfg.label}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
