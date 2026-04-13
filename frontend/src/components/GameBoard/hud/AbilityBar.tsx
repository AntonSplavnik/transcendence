import AbilitySlot from './AbilitySlot';
import type { HudState } from './types';

interface AbilityBarProps {
	hud: HudState;
	abilityIcons?: [string, string];
	abilityColors?: [string, string];
}

export default function AbilityBar({ hud, abilityIcons, abilityColors }: AbilityBarProps) {
	return (
		<div className="flex gap-8" data-testid="ability-bar">
			<AbilitySlot
				icon={abilityIcons?.[0] ?? '💠'}
				label="Q"
				timer={hud.ability1Timer}
				cooldown={hud.ability1Cooldown}
				color={abilityColors?.[0] ?? 'rgba(52,152,219,1)'}
				isImage={!!abilityIcons?.[0]}
			/>
			<AbilitySlot
				icon={abilityIcons?.[1] ?? '🔮'}
				label="F"
				timer={hud.ability2Timer}
				cooldown={hud.ability2Cooldown}
				color={abilityColors?.[1] ?? 'rgba(155,89,182,1)'}
				isImage={!!abilityIcons?.[1]}
			/>
		</div>
	);
}
