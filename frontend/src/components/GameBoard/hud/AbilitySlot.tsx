import './hud.css';

interface AbilitySlotProps {
	icon: string;
	label: string;
	timer: number;
	cooldown: number;
	color: string;
}

export default function AbilitySlot({ icon, label, timer, cooldown, color }: AbilitySlotProps) {
	const fillPct = cooldown > 0 ? Math.max(0, Math.min(1, timer / cooldown)) * 100 : 0;

	return (
		<div className="flex flex-col items-center gap-0.5">
			<div
				className="relative flex items-center justify-center overflow-hidden"
				style={{
					width: 32,
					height: 32,
					borderRadius: 8,
					backgroundColor: 'rgba(0,0,0,0.35)',
				}}
			>
				<span className="text-sm z-10 leading-none">{icon}</span>
				{fillPct > 0 && (
					<div
						className="absolute bottom-0 left-0 w-full hud-cooldown-fill"
						style={{ height: `${fillPct}%`, backgroundColor: color }}
						data-testid="cooldown-fill"
					/>
				)}
			</div>
			<span className="text-[9px] font-semibold leading-none" style={{ color: '#888' }}>
				{label}
			</span>
		</div>
	);
}
