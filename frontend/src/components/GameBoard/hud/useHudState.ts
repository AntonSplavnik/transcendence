import { useState, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { GameStateSnapshot } from '@/game/types';
import { extractHudState, hudStateEqual, type HudState } from './types';

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
