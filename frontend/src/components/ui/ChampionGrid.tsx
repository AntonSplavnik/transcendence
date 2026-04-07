import { Lock } from 'lucide-react';
import { CHARACTER_CONFIGS } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';
import ModelPreview from './ModelPreview';

const TOTAL_SLOTS = 6;
const GRID_CAM_POS: [number, number, number] = [0, 1.15, 1.6];
const GRID_CAM_TARGET: [number, number, number] = [0, 1.05, 0];

export interface ChampionGridProps {
	value: CharacterChoice | null;
	onChange: (character: CharacterChoice) => void;
}

export default function ChampionGrid({ value, onChange }: ChampionGridProps) {
	const characters = Object.entries(CHARACTER_CONFIGS) as [
		CharacterChoice,
		(typeof CHARACTER_CONFIGS)[CharacterChoice],
	][];

	const lockedCount = TOTAL_SLOTS - characters.length;

	return (
		<div
			className="flex flex-col gap-3 p-4 bg-stone-900 border-r border-stone-800 overflow-hidden"
			style={{ flex: '8 1 0%' }}
		>
			<span className="text-xs text-stone-500 uppercase tracking-widest">Champions</span>
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
							className={`aspect-square rounded-2xl border-2 relative overflow-hidden transition-all duration-200 cursor-pointer ${
								selected
									? 'border-gold-400 shadow-[0_0_14px_2px_rgba(224,160,48,0.45)]'
									: 'border-stone-700 opacity-60 hover:opacity-80 hover:border-stone-600'
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
							<span
								className={`absolute bottom-2 left-0 right-0 text-center text-[11px] font-bold tracking-wide ${
									selected ? 'text-gold-400' : 'text-stone-400'
								}`}
							>
								{cfg.label}
							</span>
						</button>
					);
				})}

				{Array.from({ length: lockedCount }).map((_, i) => (
					<div
						key={`locked-${i}`}
						className="aspect-square rounded-2xl border-2 border-dashed border-stone-700/50 relative flex items-center justify-center bg-stone-950/40"
					>
						<Lock className="w-6 h-6 text-stone-600" />
					</div>
				))}
			</div>
		</div>
	);
}
