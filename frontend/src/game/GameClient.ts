import type { Scene, UniversalCamera } from '@babylonjs/core';
import type { RefObject } from 'react';
import type { GameEvent, GameStateSnapshot } from './types';
import type { CharacterConfig } from './characterConfigs';
import { CharacterManager } from './CharacterManager';
import { GameHUD } from './HUD';
import { SnapshotProcessor, DirectPositionStrategy } from './SnapshotProcessor';
import { processEvents } from './EventProcessor';
import { AnimPhase, tickJumpState } from './AnimationStateMachine';
import { GROUND_Y_THRESHOLD } from './constants';
import type { InputState } from './constants';

/**
 * Top-level game client that wires together the sub-systems:
 * CharacterManager, HUD, SnapshotProcessor, EventProcessor.
 */
export class GameClient {
	private mgr: CharacterManager;
	private hud: GameHUD;
	private snapshotProcessor: SnapshotProcessor;
	private camera: UniversalCamera;
	private characterConfig: CharacterConfig;

	constructor(
		scene: Scene,
		localPlayerID: number,
		camera: UniversalCamera,
		characterConfig: CharacterConfig,
		characterClassesRef: RefObject<Map<number, string>>,
	) {
		this.camera = camera;
		this.characterConfig = characterConfig;

		this.mgr = new CharacterManager(scene, localPlayerID);
		this.hud = new GameHUD(
			scene,
			localPlayerID,
			(id) => this.mgr.getChar(id)?.rootNode.getAbsolutePosition() ?? null,
		);
		this.snapshotProcessor = new SnapshotProcessor(
			new DirectPositionStrategy(),
			characterClassesRef,
		);
	}

	async initLocalPlayer(): Promise<void> {
		await this.mgr.initLocalPlayer(this.characterConfig);
	}

	processSnapshot(snapshot: GameStateSnapshot): void {
		this.snapshotProcessor.processSnapshot(snapshot, this.mgr, this.hud, this.camera);
	}

	processEvents(events: GameEvent[]): void {
		processEvents(events, this.mgr);
	}

	updateLocalAnimation(input: InputState): void {
		if (!this.mgr.localCharacter || this.mgr.localIsDead) return;

		const isGrounded = this.mgr.position.y <= GROUND_Y_THRESHOLD;
		this.mgr.localJumpState = tickJumpState(
			this.mgr.localCharacter, this.mgr.localJumpState, isGrounded, input.isJumping,
		);
		if (this.mgr.localJumpState !== 'grounded') return;

		const isPlaying = this.mgr.localCharacter.currentAnimation?.isPlaying ?? false;
		const isMoving = input.movementDirection.x !== 0 || input.movementDirection.z !== 0;

		const transitioned = this.mgr.localAnimSM.tick(isPlaying, isMoving);

		// If attack was cancelled by movement, immediately start the move animation
		if (transitioned && this.mgr.localAnimSM.phase === AnimPhase.Idle && isMoving) {
			const m = input.isSprinting ? this.characterConfig.runAnimation : this.characterConfig.walkAnimation;
			this.mgr.localCharacter.playAnimation(m.name, true, m.speed ?? 1.0);
			return;
		}

		// Priority animation still playing — wait
		if (this.mgr.localAnimSM.phase !== AnimPhase.Idle) return;

		// Normal movement/idle
		if (isMoving) {
			const m = input.isSprinting ? this.characterConfig.runAnimation : this.characterConfig.walkAnimation;
			this.mgr.localCharacter.playAnimation(m.name, true, m.speed ?? 1.0);
		} else {
			const idle = this.characterConfig.idleAnimation;
			this.mgr.localCharacter.playAnimation(idle.name, true, idle.speed ?? 1.0);
		}
	}

	dispose(): void {
		this.mgr.dispose();
		this.hud.dispose();
	}
}
