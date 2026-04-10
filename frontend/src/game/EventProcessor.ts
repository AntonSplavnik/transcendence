import type { GameEvent } from './types';
import type { CharacterManager } from './CharacterManager';
import { AnimPhase } from './AnimationStateMachine';
import { AnimationNames, COMBAT_BLEND_DURATION } from './constants';

/**
 * Processes discrete game events (AttackStarted, SkillUsed, Spawn, etc.)
 * drained from the event queue each frame.
 *
 * Events drive one-shot animation triggers; snapshot fallback handles the
 * steady-state (walk/idle/etc.).
 */
export function processEvents(events: GameEvent[], mgr: CharacterManager): void {
	for (const event of events) {
		switch (event.type) {
			case 'Death':
				break;
			case 'Damage':
				break;
			case 'Spawn':
				mgr.getChar(event.player_id)?.playAnimation(AnimationNames.spawn, false);
				if (event.player_id === mgr.localPlayerID) {
					mgr.localIsDead = false;
					mgr.localAnimSM.enter(AnimPhase.Spawn);
				} else {
					mgr.getRemoteAnimSM(event.player_id).enter(AnimPhase.Spawn);
				}
				break;
			case 'StateChange':
				break;
			case 'AttackStarted': {
				const config = mgr.getConfig(event.player_id);
				const entry = config?.attackAnimations[event.chain_stage];
				if (entry) {
					const char = mgr.getChar(event.player_id);
					const speed = entry.speed ?? 1.0;
					if (event.chain_stage > 0) {
						char?.crossFadeTo(entry.name, false, speed, COMBAT_BLEND_DURATION);
					} else {
						char?.playAnimation(entry.name, false, speed);
					}
				}
				if (event.player_id === mgr.localPlayerID) {
					mgr.localAnimSM.enter(AnimPhase.Attack);
				} else {
					mgr.getRemoteAnimSM(event.player_id).enter(AnimPhase.Attack);
				}
				break;
			}
			case 'SkillUsed': {
				const config = mgr.getConfig(event.player_id);
				const entry = config?.skillAnimations[event.skill_slot - 1];
				if (entry) {
					mgr.getChar(event.player_id)?.playAnimation(entry.name, false, entry.speed ?? 1.0);
				}
				if (event.player_id === mgr.localPlayerID) {
					mgr.localAnimSM.enter(AnimPhase.Skill);
				} else {
					mgr.getRemoteAnimSM(event.player_id).enter(AnimPhase.Skill);
				}
				break;
			}
			case 'MatchEnd':
				break;
		}
	}
}
