export interface PlayerAvatarRowProps {
	players: ReadonlyMap<number, { nickname: string; ready: boolean }>;
	hostId: number;
}

export default function PlayerAvatarRow({ players, hostId }: PlayerAvatarRowProps) {
	const readyCount = [...players.values()].filter((p) => p.ready).length;

	return (
		<div className="flex flex-col items-center" style={{ gap: '6px' }}>
			<span className="uppercase" style={{ fontSize: '10px', color: '#4a6080', letterSpacing: '0.1em' }}>
				Players {players.size} · {readyCount} ready
			</span>
			<div className="flex items-center" style={{ gap: '10px' }}>
				{[...players.entries()].map(([uid, p]) => {
					const initials = p.nickname.slice(0, 2).toUpperCase();
					const isHost = uid === hostId;
					const borderColor = p.ready ? '#4ade80' : isHost ? '#d97706' : '#fb923c';
					const bgColor = isHost ? '#1e2a1a' : '#1a1a2a';
					const initialsColor = isHost ? '#d97706' : '#a8a29e';
					const nameColor = isHost ? '#d97706' : '#4a6070';
					return (
						<div key={uid} className="flex flex-col items-center" style={{ gap: '4px' }}>
							<div
								data-testid={`avatar-${uid}`}
								data-ready-state={isHost ? 'host' : p.ready ? 'ready' : 'waiting'}
								className="w-12 h-12 rounded-full flex items-center justify-center font-bold"
								style={{
									border: `2px solid ${borderColor}`,
									background: bgColor,
									fontSize: '15px',
									color: initialsColor,
								}}
							>
								{initials}
							</div>
							<span
								className="max-w-[52px] truncate text-center"
								style={{ fontSize: '10px', color: nameColor, whiteSpace: 'nowrap' }}
							>
								{p.nickname}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
