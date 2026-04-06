export interface PlayerAvatarRowProps {
	players: ReadonlyMap<number, { nickname: string; ready: boolean }>;
	hostId: number;
}

export default function PlayerAvatarRow({ players, hostId }: PlayerAvatarRowProps) {
	const readyCount = [...players.values()].filter((p) => p.ready).length;

	return (
		<div className="flex flex-col items-center gap-1.5">
			<span className="text-[9px] text-stone-500 uppercase tracking-widest">
				Players {players.size} · {readyCount} ready
			</span>
			<div className="flex items-end gap-1.5">
				{[...players.entries()].map(([uid, p]) => {
					const initials = p.nickname.slice(0, 2).toUpperCase();
					const isHost = uid === hostId;
					const borderClass = isHost
						? 'border-gold-400'
						: p.ready
							? 'border-success'
							: 'border-warning';
					return (
						<div key={uid} className="flex flex-col items-center gap-0.5">
							<div
								data-testid={`avatar-${uid}`}
								className={`w-8 h-8 rounded-full border-2 ${borderClass} bg-stone-900 flex items-center justify-center text-xs font-bold text-stone-200`}
							>
								{initials}
							</div>
							<span className="text-[9px] text-stone-500 max-w-[36px] truncate text-center leading-none">
								{p.nickname}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
