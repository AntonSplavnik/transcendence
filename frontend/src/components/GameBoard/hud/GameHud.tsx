import { useState, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GameStateSnapshot } from '@/game/types';
import { CharacterState } from '@/game/constants';
import { extractHudState, hudStateEqual, type HudState } from './types';
import ResourceBar from './ResourceBar';
import AbilityBar from './AbilityBar';
import './hud.css';

export function useHudState(
	snapshotRef: RefObject<GameStateSnapshot | null>,
	localPlayerId: number,
): HudState | null {
	const [hud, setHud] = useState<HudState | null>(null);
	const lastUpdate = useRef(0);

	useEffect(() => {
		let raf: number;
		const poll = (now: number) => {
			if (now - lastUpdate.current >= 66) {
				const snap = snapshotRef.current;
				const char = snap?.characters.find((c) => c.player_id === localPlayerId);
				if (char) {
					const next = extractHudState(char);
					setHud((prev) => (prev && hudStateEqual(prev, next) ? prev : next));
				}
				lastUpdate.current = now;
			}
			raf = requestAnimationFrame(poll);
		};
		raf = requestAnimationFrame(poll);
		return () => cancelAnimationFrame(raf);
	}, [snapshotRef, localPlayerId]);

	return hud;
}

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
