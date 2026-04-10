import { AnimatedCharacter } from './AnimatedCharacter';
import { AnimationNames } from './constants';

// ── AnimPhase ───────────────────────────────────────────────────────────────

export const AnimPhase = {
	Idle: 'idle',
	Spawn: 'spawn',
	Attack: 'attack',
	Skill: 'skill',
} as const;
export type AnimPhase = (typeof AnimPhase)[keyof typeof AnimPhase];

// ── AnimationStateMachine ───────────────────────────────────────────────────

export class AnimationStateMachine {
	private _phase: AnimPhase = AnimPhase.Idle;

	get phase(): AnimPhase {
		return this._phase;
	}

	enter(phase: AnimPhase): void {
		this._phase = phase;
	}

	/**
	 * Called each frame. Returns true if the phase just transitioned to Idle.
	 */
	tick(isAnimPlaying: boolean, isMoving: boolean): boolean {
		switch (this._phase) {
			case AnimPhase.Idle:
				return false;

			case AnimPhase.Spawn:
				if (!isAnimPlaying) {
					this._phase = AnimPhase.Idle;
					return true;
				}
				return false;

			case AnimPhase.Attack:
				if (!isAnimPlaying || isMoving) {
					this._phase = AnimPhase.Idle;
					return true;
				}
				return false;

			case AnimPhase.Skill:
				if (!isAnimPlaying) {
					this._phase = AnimPhase.Idle;
					return true;
				}
				return false;

			default:
				return false;
		}
	}

	reset(): void {
		this._phase = AnimPhase.Idle;
	}
}

// ── JumpState ───────────────────────────────────────────────────────────────

export const JumpState = {
	GROUNDED: 'grounded',
	JUMP_START: 'jump_start',
	AIRBORNE: 'airborne',
	LANDING: 'landing',
} as const;
export type JumpState = (typeof JumpState)[keyof typeof JumpState];

// ── tickJumpState ───────────────────────────────────────────────────────────

export function tickJumpState(
	character: AnimatedCharacter,
	state: JumpState,
	isGrounded: boolean,
	isJumping: boolean,
): JumpState {
	if (state === JumpState.GROUNDED && !isGrounded && isJumping) {
		character.playAnimation(AnimationNames.jumpStart, false);
		return JumpState.JUMP_START;
	}
	if (state === JumpState.GROUNDED && !isGrounded) {
		character.playAnimation(AnimationNames.jumpIdle, true);
		return JumpState.AIRBORNE;
	}
	if (state === JumpState.JUMP_START) {
		const anim = character.animations.get(AnimationNames.jumpStart);
		if (anim && !anim.isPlaying) {
			character.playAnimation(AnimationNames.jumpIdle, true);
			return JumpState.AIRBORNE;
		}
		return JumpState.JUMP_START;
	}
	if (state === JumpState.AIRBORNE && !isGrounded) {
		character.playAnimation(AnimationNames.jumpIdle, true);
		return JumpState.AIRBORNE;
	}
	if (state === JumpState.AIRBORNE && isGrounded) {
		character.playAnimation(AnimationNames.jumpLand, false);
		return JumpState.LANDING;
	}
	if (state === JumpState.LANDING) {
		const anim = character.animations.get(AnimationNames.jumpLand);
		if (anim && !anim.isPlaying) return JumpState.GROUNDED;
		return JumpState.LANDING;
	}
	return state;
}
