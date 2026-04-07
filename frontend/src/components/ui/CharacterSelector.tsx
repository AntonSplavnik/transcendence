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
		<div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl">
			{/* Left: portrait grid */}
			<ChampionGrid value={value} onChange={onChange} />

			{/* Center: 3D preview */}
			<div
				className="flex flex-col overflow-hidden"
				style={{
					flex: '12 1 0%',
					background: cfg
						? `radial-gradient(ellipse at 50% 30%, ${cfg.previewBgColor}10 0%, ${cfg.previewBgColor}15 5%, #070b0a 80%)`
						: '#070b0a',
					transition: 'background 0.4s ease',
				}}
			>
				<div className="flex-1 min-h-0 relative">
					{cfg && (
						<>
							<ModelPreview
								key={value}
								modelUrl={cfg.model}
								characterConfig={cfg}
								bgColor={cfg.previewBgColor}
								rotationSpeed={0.006}
								draggable
								transparent
							/>
							{/* Floor glow */}
							<div
								style={{
									position: 'absolute',
									bottom: '24%',
									left: '50%',
									transform: 'translateX(-50%)',
									width: '48%',
									height: '16px',
									background: `radial-gradient(ellipse, ${cfg.previewBgColor}cc 10%, transparent 70%)`,
									filter: 'blur(10px)',
									pointerEvents: 'none',
								}}
							/>
						</>
					)}
				</div>
				<p className="shrink-0 py-2 text-center text-xs text-stone-700 tracking-wider select-none">
					↺ drag to rotate ↻
				</p>
			</div>

			{/* Right: stats */}
			<CharacterStats character={value} />
		</div>
	);
}
