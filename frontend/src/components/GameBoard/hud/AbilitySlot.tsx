import './hud.css';

interface AbilitySlotProps {
	icon: string;
	label: string;
	timer: number;
	cooldown: number;
	color: string;
	isImage?: boolean;
}

export default function AbilitySlot({
	icon,
	label,
	timer,
	cooldown,
	color,
	isImage = false,
}: AbilitySlotProps) {
	const fillPct = cooldown > 0 ? Math.max(0, Math.min(1, timer / cooldown)) * 100 : 0;

	return (
		<div className="flex flex-col items-center gap-0.5">
			<div
				className="relative flex items-center justify-center overflow-hidden"
				style={{
					width: 38,
					height: 38,
					borderRadius: 8,
					backgroundColor: 'rgba(0,0,0,0.45)',
				}}
			>
				{isImage ? (
					<img
						src={icon}
						alt={label}
						className="w-full h-full object-cover rounded-[8px]"
					/>
				) : (
					<span className="text-sm z-10 leading-none">{icon}</span>
				)}
				{fillPct > 0 && (
					<div
						className="absolute bottom-0 left-0 w-full z-20 hud-cooldown-fill"
						style={{ height: `${fillPct}%`, backgroundColor: color, opacity: 0.5 }}
						data-testid="cooldown-fill"
					/>
				)}
			</div>
			<span className="text-[10px] font-bold leading-none" style={{ color: '#c8a84e' }}>
				{label}
			</span>
		</div>
	);
}
