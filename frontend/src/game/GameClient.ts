import type { Scene, UniversalCamera } from '@babylonjs/core';
import type { RefObject } from 'react';
import type { CharacterSnapshot, GameEvent, GameStateSnapshot } from './types';
import type { CharacterConfig } from './characterConfigs';
import { CharacterManager } from './CharacterManager';
import { EnemyHealthBars } from './EnemyHealthBars';
import { SnapshotProcessor, DirectPositionStrategy } from './SnapshotProcessor';
import { processEvents } from './EventProcessor';
import { AnimPhase, JumpState, tickJumpState } from './AnimationStateMachine';
import { CharacterState, type InputState } from './constants';
import type { GameAudioEngine } from '../audio/AudioEngine';
import type { SoundBank } from '../audio/SoundBank';
import { AudioEventSystem } from '../audio/AudioEventSystem';

/**
 * Top-level game client that wires together the sub-systems:
 * CharacterManager, HUD, SnapshotProcessor, EventProcessor.
 */
export class GameClient {
	private mgr: CharacterManager;
	private hud: EnemyHealthBars;
	private snapshotProcessor: SnapshotProcessor;
	private camera: UniversalCamera;
	private characterConfig: CharacterConfig;
	private audioEventSystem: AudioEventSystem | null = null;
	private audioEngine: GameAudioEngine | null = null;
	private characterClassesRef: RefObject<Map<number, string>>;
	private localAbility1Timer: number = 0;
	private localAbility2Timer: number = 0;
	private prevRemoteSnapshots = new Map<number, CharacterSnapshot>();

	constructor(
		scene: Scene,
		localPlayerID: number,
		camera: UniversalCamera,
		characterConfig: CharacterConfig,
		characterClassesRef: RefObject<Map<number, string>>,
		audioEngine?: GameAudioEngine | null,
		soundBank?: SoundBank | null,
	) {
		this.camera = camera;
		this.characterConfig = characterConfig;
		this.characterClassesRef = characterClassesRef;

		this.mgr = new CharacterManager(scene, localPlayerID);
		this.hud = new EnemyHealthBars(
			scene,
			localPlayerID,
			(id) => this.mgr.getChar(id)?.rootNode.getAbsolutePosition() ?? null,
		);
		this.snapshotProcessor = new SnapshotProcessor(
			new DirectPositionStrategy(),
			characterClassesRef,
		);

		if (audioEngine && soundBank) {
			this.audioEngine = audioEngine;
			const aes = new AudioEventSystem(audioEngine, soundBank);
			aes.setCharacterClass(characterConfig.label.toLowerCase());
			this.audioEventSystem = aes;
		}
	}

	async initLocalPlayer(): Promise<void> {
		await this.mgr.initLocalPlayer(this.characterConfig);
		// Attach audio listener to the player (not the camera) so spatial
		// sounds are relative to the player's position -- standard for isometric games.
		if (this.audioEngine && this.mgr.localCharacter) {
			this.audioEngine.attachListener(this.mgr.localCharacter.rootNode);
		}
	}

	playSpawnAnimation(): void {
		this.mgr.playLocalSpawn();
	}

	processSnapshot(snapshot: GameStateSnapshot): void {
		this.snapshotProcessor.processSnapshot(snapshot, this.mgr, this.hud, this.camera);

		for (const char of snapshot.characters) {
			if (char.player_id === this.mgr.localPlayerID) {
				// Cache local player cooldown timers for audio gating
				this.localAbility1Timer = char.ability1_timer;
				this.localAbility2Timer = char.ability2_timer;
			} else if (this.audioEventSystem) {
				// Pipeline 2: remote player audio from snapshot deltas
				const prev = this.prevRemoteSnapshots.get(char.player_id);
				if (prev) {
					const charClass = this.characterClassesRef.current.get(char.player_id) ?? null;
					this.audioEventSystem.onRemoteSnapshot(prev, char, charClass);
				}
				this.prevRemoteSnapshots.set(char.player_id, char);
			}
		}

		// Clean up prev snapshots for disconnected players
		for (const id of this.prevRemoteSnapshots.keys()) {
			if (!snapshot.characters.some((c) => c.player_id === id)) {
				this.prevRemoteSnapshots.delete(id);
			}
		}
	}

	processEvents(events: GameEvent[]): void {
		if (this.audioEventSystem && events.length > 0) {
			this.audioEventSystem.onGameEvents(events, {
				localPlayerId: this.mgr.localPlayerID,
				localPosition: {
					x: this.mgr.position.x,
					y: this.mgr.position.y,
					z: this.mgr.position.z,
				},
				remotePositions: this.snapshotProcessor.remotePositions,
				characterClasses: this.characterClassesRef.current,
			});
		}
		processEvents(events, this.mgr);
	}

	updateLocalAnimation(input: InputState): void {
		if (!this.mgr.localCharacter || this.mgr.localIsDead) return;

		// Trigger audio — abilities on cooldown are masked so no sound plays,
		// but the raw input is still sent to the server (server is authoritative).
		this.audioEventSystem?.onLocalInput(
			{
				movementDirection: input.movementDirection,
				isAttacking: input.isAttacking,
				isJumping: input.isJumping,
				isSprinting: input.isSprinting,
				isGrounded: this.mgr.localIsGrounded,
				isUsingAbility1: input.isUsingAbility1 && this.localAbility1Timer <= 0,
				isUsingAbility2: input.isUsingAbility2 && this.localAbility2Timer <= 0,
			},
			{ x: this.mgr.position.x, y: this.mgr.position.y, z: this.mgr.position.z },
		);

		const previousJumpState = this.mgr.localJumpState;
		this.mgr.localJumpState = tickJumpState(
			this.mgr.localCharacter,
			this.mgr.localJumpState,
			this.mgr.localIsGrounded,
			input.isJumping,
		);
		if (
			this.audioEventSystem &&
			previousJumpState !== JumpState.JUMP_START &&
			this.mgr.localJumpState === JumpState.JUMP_START
		) {
			this.audioEventSystem.onLocalAnimationEvent('player_jump', {
				x: this.mgr.position.x,
				y: this.mgr.position.y,
				z: this.mgr.position.z,
			});
		}
		if (this.mgr.localJumpState !== 'grounded') return;

		const isPlaying = this.mgr.localCharacter.currentAnimation?.isPlaying ?? false;
		const serverState = this.mgr.localState;
		const isMoving =
			serverState === CharacterState.Walking || serverState === CharacterState.Sprinting;
		const isSprinting = serverState === CharacterState.Sprinting;

		const transitioned = this.mgr.localAnimSM.tick(isPlaying, isMoving);

		// If attack was cancelled by movement, immediately start the move animation
		if (transitioned && this.mgr.localAnimSM.phase === AnimPhase.Idle && isMoving) {
			const m = isSprinting
				? this.characterConfig.runAnimation
				: this.characterConfig.walkAnimation;
			this.mgr.localCharacter.playAnimation(m.name, true, m.speed ?? 1.0);
			return;
		}

		// Priority animation still playing — wait
		if (this.mgr.localAnimSM.phase !== AnimPhase.Idle) return;

		// Normal movement/idle
		if (isMoving) {
			const m = isSprinting
				? this.characterConfig.runAnimation
				: this.characterConfig.walkAnimation;
			this.mgr.localCharacter.playAnimation(m.name, true, m.speed ?? 1.0);
		} else {
			const idle = this.characterConfig.idleAnimation;
			this.mgr.localCharacter.playAnimation(idle.name, true, idle.speed ?? 1.0);
		}
	}

	dispose(): void {
		this.audioEventSystem?.dispose();
		this.audioEventSystem = null;
		this.mgr.dispose();
		this.hud.dispose();
	}
}
