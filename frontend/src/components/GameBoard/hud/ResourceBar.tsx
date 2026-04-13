import './hud.css';

interface ResourceBarProps {
	type: 'health' | 'stamina';
	current: number;
	max: number;
	exhausted?: boolean;
}

const CONFIG = {
	health: {
		icon: '❤️',
		iconBg: 'rgba(46,204,113,0.15)',
		fillColor: '#2ecc71',
		lowColor: '#2ecc71',
		width: 200,
		height: 14,
		radius: 4,
	},
	stamina: {
		icon: '⚡',
		iconBg: 'rgba(224,160,48,0.15)',
		fillColor: '#e0a030',
		lowColor: '#d35400',
		width: 160,
		height: 9,
		radius: 3,
	},
} as const;

export default function ResourceBar({ type, current, max, exhausted = false }: ResourceBarProps) {
	const cfg = CONFIG[type];
	const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) * 100 : 0;

	const isStamina = type === 'stamina';
	const fillColor = isStamina && pct < 20 ? cfg.lowColor : cfg.fillColor;
	const isExhausted = isStamina && exhausted;

	return (
		<div
			className={`flex items-center gap-1 ${isExhausted ? 'hud-stamina-exhausted' : ''}`}
			data-testid="resource-bar"
		>
			<div
				className="flex items-center justify-center rounded-[5px] hud-bar-icon"
				style={{
					width: 20,
					height: 20,
					backgroundColor: cfg.iconBg,
					opacity: isExhausted ? 0.4 : 1,
				}}
				data-testid="resource-icon"
			>
				<span className="text-xs leading-none">{cfg.icon}</span>
			</div>
			<div
				className={`relative overflow-hidden ${isExhausted ? 'hud-exhaust-bg' : ''}`}
				style={{
					width: cfg.width,
					height: cfg.height,
					borderRadius: cfg.radius,
					backgroundColor: 'rgba(0,0,0,0.4)',
				}}
				data-testid="resource-bg"
			>
				<div
					className="absolute left-0 top-0 h-full hud-bar-fill"
					style={{
						width: `${pct}%`,
						backgroundColor: fillColor,
						borderRadius: cfg.radius,
					}}
					data-testid="resource-fill"
				/>
			</div>
		</div>
	);
}
