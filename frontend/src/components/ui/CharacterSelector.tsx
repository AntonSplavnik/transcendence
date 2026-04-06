import { CHARACTER_CONFIGS } from '@/game/characterConfigs';
import type { CharacterChoice } from '@/game/characterConfigs';
import ChampionGrid from './ChampionGrid';
import CharacterStats from './CharacterStats';
import ModelPreview from './ModelPreview';

export interface CharacterSelectorProps {
	value: CharacterChoice | null;
	onChange: (character: CharacterChoice) => void;
}

export default function CharacterSelector({ value, onChange }: CharacterSelectorProps) {
	const cfg = value ? CHARACTER_CONFIGS[value] : null;

	return (
		<div className="flex min-h-0 flex-1 overflow-hidden">
			{/* Left: portrait grid */}
			<ChampionGrid value={value} onChange={onChange} />

			{/* Center: 3D preview */}
			<div
				className="flex flex-col bg-stone-950 overflow-hidden"
				style={{ flex: '12 1 0%' }}
			>
				<div className="flex-1 min-h-0 relative">
					{cfg && (
						<ModelPreview
							modelUrl={cfg.model}
							characterConfig={cfg}
							bgColor={cfg.previewBgColor}
							rotationSpeed={0.006}
							draggable
						/>
					)}
				</div>
				<p className="shrink-0 py-2 text-center text-[10px] text-stone-700 tracking-wider select-none">
					↺ drag to rotate ↻
				</p>
			</div>

			{/* Right: stats */}
			<CharacterStats character={value} />
		</div>
	);
}
