import { CHARACTER_CONFIGS } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';
import ModelPreview from './ModelPreview';

export type { CharacterChoice };

export interface CharacterPickerProps {
	value: CharacterChoice | null;
	onChange: (character: CharacterChoice) => void;
}

export default function CharacterPicker({ value, onChange }: CharacterPickerProps) {
	const characters = Object.entries(CHARACTER_CONFIGS) as [CharacterChoice, typeof CHARACTER_CONFIGS[CharacterChoice]][];

	return (
		<section aria-label="Character selection" className="mb-4">
			<h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
				Choose Your Champion
			</h2>
			<div className="flex gap-3">
				{characters.map(([id, cfg]) => (
					<button
						key={id}
						type="button"
						aria-label={`Select ${cfg.label}`}
						aria-pressed={value === id}
						className={`
							flex-1 flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all duration-200 cursor-pointer border-2 bg-stone-900/60
							${value === id
								? 'border-gold-400 shadow-[0_0_16px_2px_rgba(217,119,6,0.35)]'
								: 'border-stone-700 hover:border-stone-500'
							}
						`}
						onClick={() => onChange(id)}
					>
						<div className="w-full h-[140px] rounded overflow-hidden">
							<ModelPreview
								modelUrl={cfg.model}
								characterConfig={cfg}
								bgColor={cfg.previewBgColor}
							/>
						</div>
						<span className={`text-sm font-semibold tracking-wide transition-colors duration-200 ${
							value === id ? 'text-gold-400' : 'text-stone-400'
						}`}>
							{cfg.label}
						</span>
					</button>
				))}
			</div>
		</section>
	);
}
