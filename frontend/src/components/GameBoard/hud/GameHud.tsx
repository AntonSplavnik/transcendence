import type { RefObject } from 'react';
import type { GameStateSnapshot } from '@/game/types';
import { CharacterState } from '@/game/constants';
import { useHudState } from './useHudState';
import ResourceBar from './ResourceBar';
import AbilityBar from './AbilityBar';
import './hud.css';

interface GameHudProps {
	snapshotRef: RefObject<GameStateSnapshot | null>;
	localPlayerId: number;
}

export default function GameHud({ snapshotRef, localPlayerId }: GameHudProps) {
	const hud = useHudState(snapshotRef, localPlayerId);
	if (!hud) return null;

	const isDead = hud.state === CharacterState.Dead;

	return (
		<div
			className="absolute bottom-5 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center"
			style={{ opacity: isDead ? 0.3 : 1, transition: 'opacity 300ms ease' }}
			data-testid="game-hud"
		>
			<div className="mb-2">
				<AbilityBar hud={hud} />
			</div>
			<div className="mb-1">
				<ResourceBar type="health" current={hud.health} max={hud.maxHealth} />
			</div>
			<ResourceBar
				type="stamina"
				current={hud.stamina}
				max={hud.maxStamina}
				exhausted={hud.exhausted}
			/>
		</div>
	);
}
