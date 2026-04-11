import type { UniversalCamera } from '@babylonjs/core';
import type { RefObject } from 'react';
import type { CharacterSnapshot, GameStateSnapshot, Vector3D } from './types';
import type { CharacterConfig } from './characterConfigs';
import type { AnimatedCharacter } from './AnimatedCharacter';
import type { CharacterManager } from './CharacterManager';
import type { GameHUD } from './HUD';
import { AnimPhase, JumpState, tickJumpState } from './AnimationStateMachine';
import { AnimationNames, CharacterState, ISO_CAM_OFFSET } from './constants';

// ── Position strategy (interpolation injection point) ───────────────

/**
 * Abstraction over how server positions become visual positions.
 *
 * Default: DirectPositionStrategy (current behavior — no smoothing).
 * To add interpolation later, implement this interface with a buffer
 * that lerps between snapshots, then swap it in at construction.
 */
export interface PositionStrategy {
	/** Record a new authoritative position from the server. */
	pushServerState(
		playerId: number,
		position: Vector3D,
		velocity: Vector3D,
		yaw: number,
		timestamp: number,
	): void;

	/** Get the visual position/yaw to render this frame. */
	getVisualState(
		playerId: number,
		renderTime: number,
	): { position: Vector3D; yaw: number };

	/** Stop tracking a player. */
	remove(playerId: number): void;
}

/** Direct assignment — no interpolation or smoothing. */
export class DirectPositionStrategy implements PositionStrategy {
	private states = new Map<number, { position: Vector3D; yaw: number }>();

	pushServerState(playerId: number, position: Vector3D, _velocity: Vector3D, yaw: number): void {
		this.states.set(playerId, { position, yaw });
	}

	getVisualState(playerId: number): { position: Vector3D; yaw: number } {
		return this.states.get(playerId) ?? { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
	}

	remove(playerId: number): void {
		this.states.delete(playerId);
	}
}

// ── Snapshot processor ──────────────────────────────────────────────

export class SnapshotProcessor {
	private positionStrategy: PositionStrategy;
	private characterClassesRef: RefObject<Map<number, string>>;

	constructor(
		positionStrategy: PositionStrategy,
		characterClassesRef: RefObject<Map<number, string>>,
	) {
		this.positionStrategy = positionStrategy;
		this.characterClassesRef = characterClassesRef;
	}

	processSnapshot(
		snapshot: GameStateSnapshot,
		mgr: CharacterManager,
		hud: GameHUD,
		camera: UniversalCamera,
	): void {
		const activePlayerIDs = new Set<number>();

		for (const charData of snapshot.characters) {
			activePlayerIDs.add(charData.player_id);

			// Push authoritative state into the position strategy
			this.positionStrategy.pushServerState(
				charData.player_id,
				charData.position,
				charData.velocity,
				charData.yaw,
				snapshot.timestamp,
			);

			if (charData.player_id === mgr.localPlayerID) {
				this.processLocalPlayer(charData, snapshot.timestamp, mgr, hud, camera);
			} else {
				this.processRemotePlayer(charData, snapshot.timestamp, mgr, hud);
			}
		}

		// Clean up disconnected players
		const disconnected: number[] = [];
		for (const playerID of mgr.characters.keys()) {
			if (!activePlayerIDs.has(playerID)) {
				disconnected.push(playerID);
			}
		}
		for (const playerID of disconnected) {
			mgr.removeRemote(playerID);
			hud.removeEnemyBar(playerID);
			this.positionStrategy.remove(playerID);
		}
	}

	private processLocalPlayer(
		charData: CharacterSnapshot,
		_timestamp: number,
		mgr: CharacterManager,
		hud: GameHUD,
		camera: UniversalCamera,
	): void {
		const visual = this.positionStrategy.getVisualState(charData.player_id, _timestamp);
		mgr.position.copyFromFloats(visual.position.x, visual.position.y, visual.position.z);
		mgr.localIsGrounded = charData.is_grounded;
		mgr.localState = charData.state as CharacterState;

		if (mgr.localCharacter) {
			mgr.localCharacter.setPosition(mgr.position);
			mgr.localCharacter.setRotation(visual.yaw);
			mgr.localCharacter.trail?.update(
				mgr.localCharacter.getWeaponWorldPos(),
				charData.swing_progress,
			);
		}

		// Health
		const healthPct = charData.max_health > 0 ? charData.health / charData.max_health : 0;
		hud.updateLocalHealth(healthPct);

		// Stamina
		const staminaPct = charData.max_stamina > 0 ? charData.stamina / charData.max_stamina : 0;
		hud.updateLocalStamina(staminaPct);

		// Death
		if (charData.state === CharacterState.Dead && !mgr.localIsDead && mgr.localCharacter) {
			mgr.localIsDead = true;
			const deathAnim = mgr.localCharacter.animations.get(AnimationNames.death);
			mgr.localCharacter.playAnimation(AnimationNames.death, false);
			if (deathAnim) {
				deathAnim.onAnimationGroupEndObservable.addOnce(() => {
					mgr.localCharacter?.playAnimation(AnimationNames.deathPose, false);
				});
			}
			mgr.localAnimSM.enter(AnimPhase.Death);
		}

		// Cooldowns
		const cd1 = charData.ability1_cooldown > 0
			? charData.ability1_timer / charData.ability1_cooldown : 0;
		const cd2 = charData.ability2_cooldown > 0
			? charData.ability2_timer / charData.ability2_cooldown : 0;
		hud.updateCooldowns(charData.swing_progress, cd1, cd2);

		// Camera follow
		camera.position.copyFromFloats(
			mgr.position.x + ISO_CAM_OFFSET.x,
			mgr.position.y + ISO_CAM_OFFSET.y,
			mgr.position.z + ISO_CAM_OFFSET.z,
		);
		camera.setTarget(mgr.position);
	}

	private processRemotePlayer(
		charData: CharacterSnapshot,
		_timestamp: number,
		mgr: CharacterManager,
		hud: GameHUD,
	): void {
		const remoteChar = mgr.characters.get(charData.player_id);

		if (!remoteChar && !mgr.isLoading(charData.player_id)) {
			mgr.createRemoteCharacter(charData.player_id, charData, this.characterClassesRef);
			hud.createEnemyBar(charData.player_id);
			return;
		}

		if (!remoteChar) return;

		// Position via strategy
		const visual = this.positionStrategy.getVisualState(charData.player_id, _timestamp);
		remoteChar.setPositionFromFloats(visual.position.x, visual.position.y, visual.position.z);
		remoteChar.setRotation(visual.yaw);

		// Jump state
		const jumpState = mgr.getRemoteJumpState(charData.player_id);
		const newJumpState = tickJumpState(remoteChar, jumpState, charData.is_grounded, false);
		mgr.setRemoteJumpState(charData.player_id, newJumpState);

		// Fallback animation (snapshot-driven)
		const config = mgr.getConfig(charData.player_id);
		if (config) {
			this.updateSnapshotFallbackAnimation(
				charData.player_id, remoteChar, charData, config, newJumpState, mgr,
			);
		}

		// Trail
		remoteChar.trail?.update(remoteChar.getWeaponWorldPos(), charData.swing_progress);

		// Enemy health bar
		hud.updateEnemyHealth(
			charData.player_id,
			charData.max_health > 0 ? charData.health / charData.max_health : 0,
			charData.state === CharacterState.Dead,
		);
	}

	private updateSnapshotFallbackAnimation(
		playerID: number,
		char: AnimatedCharacter,
		charData: CharacterSnapshot,
		config: CharacterConfig,
		jumpState: JumpState,
		mgr: CharacterManager,
	): void {
		if (jumpState !== JumpState.GROUNDED) return;

		// Guard: event-driven animation still playing
		const animSM = mgr.getRemoteAnimSM(playerID);
		const isPlaying = char.currentAnimation?.isPlaying ?? false;
		const isMoving = charData.state === CharacterState.Walking
			|| charData.state === CharacterState.Sprinting;
		const transitioned = animSM.tick(isPlaying, isMoving);

		// If attack/skill was cancelled by movement, immediately start move animation
		if (transitioned && animSM.phase === AnimPhase.Idle && isMoving) {
			const m = charData.state === CharacterState.Sprinting
				? config.runAnimation : config.walkAnimation;
			char.playAnimation(m.name, true, m.speed ?? 1.0);
			return;
		}

		if (!transitioned && animSM.phase !== 'idle') return;

		switch (charData.state) {
			case CharacterState.Attacking: {
				const a = config.attackAnimations[0];
				if (a && !char.currentAnimation?.isPlaying)
					char.playAnimation(a.name, true, a.speed ?? 1.0);
				break;
			}
			case CharacterState.Casting: {
				const s = config.skillAnimations[0];
				if (s && !char.currentAnimation?.isPlaying)
					char.playAnimation(s.name, true, s.speed ?? 1.0);
				break;
			}
			case CharacterState.Dead:
				mgr.getRemoteAnimSM(playerID).enter(AnimPhase.Death);
				if (char.animationName !== AnimationNames.death &&
					char.animationName !== AnimationNames.deathPose) {
					const deathAnim = char.animations.get(AnimationNames.death);
					char.playAnimation(AnimationNames.death, false);
					if (deathAnim) {
						deathAnim.onAnimationGroupEndObservable.addOnce(() => {
							char.playAnimation(AnimationNames.deathPose, false);
						});
					}
				}
				break;
			case CharacterState.Stunned:
				char.playAnimation(AnimationNames.hit, false);
				break;
			case CharacterState.Walking:
				char.playAnimation(config.walkAnimation.name, true, config.walkAnimation.speed ?? 1.0);
				break;
			case CharacterState.Sprinting:
				char.playAnimation(config.runAnimation.name, true, config.runAnimation.speed ?? 1.0);
				break;
			default:
				char.playAnimation(config.idleAnimation.name, true, config.idleAnimation.speed ?? 1.0);
				break;
		}
	}
}
