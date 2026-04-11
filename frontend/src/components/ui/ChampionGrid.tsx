import { Lock } from 'lucide-react';
import { CHARACTER_CONFIGS } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';
import ModelPreview from './ModelPreview';

const GRID_CAM_POS: [number, number, number] = [0, 1, 1.3];
const GRID_CAM_TARGET: [number, number, number] = [0, 1, 0];

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
			<span className="text-xs text-stone-350 uppercase tracking-widest">Champions</span>
			<div
				className="grid grid-cols-3 gap-3 content-start"
				role="radiogroup"
				aria-label="Champion selection"
			>
				{characters.map(([id, cfg]) => {
					const locked = cfg.locked === true;
					const selected = !locked && value === id;
					return (
						<button
							key={id}
							type="button"
							aria-label={locked ? `${cfg.label} (locked)` : `Select ${cfg.label}`}
							role="radio"
							aria-checked={selected}
							disabled={locked}
							onClick={() => {
								if (!locked) onChange(id);
							}}
							className={`aspect-square rounded-2xl border-2 relative overflow-hidden transition-all duration-200 ${
								locked
									? 'border-stone-700/50 cursor-not-allowed grayscale'
									: selected
										? 'border-gold-400 shadow-[0_0_18px_3px_rgba(224,160,48,0.5)] scale-105 z-10 cursor-pointer'
										: 'border-stone-700 opacity-50 hover:opacity-75 hover:border-stone-600 cursor-pointer'
							}`}
							style={{
								background: `linear-gradient(to bottom, ${cfg.previewBgColor}, #0e0e10)`,
							}}
						>
							<ModelPreview
								modelUrl={cfg.model}
								characterConfig={cfg}
								bgColor={cfg.previewBgColor}
								rotationSpeed={0}
								initialRotationY={0}
								cameraPosition={GRID_CAM_POS}
								cameraTarget={GRID_CAM_TARGET}
							/>
							<div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-transparent to-transparent" />
							{locked && (
								<div className="absolute inset-0 bg-stone-950/70 flex items-center justify-center">
									<Lock className="w-5 h-5 text-stone-600" aria-hidden="true" />
								</div>
							)}
							<span
								className={`absolute bottom-2 left-0 right-0 text-center text-[11px] font-bold tracking-wide ${
									locked
										? 'text-stone-600'
										: selected
											? 'text-gold-400'
											: 'text-stone-300'
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
