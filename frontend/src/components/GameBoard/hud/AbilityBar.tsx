import AbilitySlot from './AbilitySlot';
import type { HudState } from './types';

interface AbilityBarProps {
	hud: HudState;
}

export default function AbilityBar({ hud }: AbilityBarProps) {
	return (
		<div className="flex gap-2" data-testid="ability-bar">
			<AbilitySlot
				icon="💠"
				label="Q"
				timer={hud.ability1Timer}
				cooldown={hud.ability1Cooldown}
				color="rgba(52,152,219,1)"
			/>
			<AbilitySlot
				icon="🔮"
				label="F"
				timer={hud.ability2Timer}
				cooldown={hud.ability2Cooldown}
				color="rgba(155,89,182,1)"
			/>
		</div>
	);
}
