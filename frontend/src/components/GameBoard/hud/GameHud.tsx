import { useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { GameStateSnapshot } from '@/game/types';
import { CharacterState } from '@/game/constants';
import { useHudState } from './useHudState';
import ResourceBar from './ResourceBar';
import AbilityBar from './AbilityBar';
import './hud.css';

/** Reference width for scale=1. HUD scales up above this, stays fixed below. */
const BASE_WIDTH = 1920;

function subscribeToResize(cb: () => void) {
	window.addEventListener('resize', cb);
	return () => window.removeEventListener('resize', cb);
}

function getHudScale() {
	return Math.max(1, window.innerWidth / BASE_WIDTH);
}

function useHudScale() {
	return useSyncExternalStore(subscribeToResize, getHudScale);
}

interface GameHudProps {
	snapshotRef: RefObject<GameStateSnapshot | null>;
	localPlayerId: number;
	abilityIcons?: [string, string];
	abilityColors?: [string, string];
}

export default function GameHud({
	snapshotRef,
	localPlayerId,
	abilityIcons,
	abilityColors,
}: GameHudProps) {
	const hud = useHudState(snapshotRef, localPlayerId);
	const scale = useHudScale();
	if (!hud) return null;

	const isDead = hud.state === CharacterState.Dead;

	return (
		<div
			className="absolute bottom-5 left-1/2 pointer-events-none flex flex-col items-center"
			style={{
				opacity: isDead ? 0.3 : 1,
				transition: 'opacity 300ms ease',
				transform: `translateX(-50%) scale(${scale})`,
				transformOrigin: 'bottom center',
			}}
			data-testid="game-hud"
		>
			<div className="mb-1">
				<AbilityBar hud={hud} abilityIcons={abilityIcons} abilityColors={abilityColors} />
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
