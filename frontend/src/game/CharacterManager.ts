import type { Scene, Vector3 } from '@babylonjs/core';
import type { RefObject } from 'react';
import type { Vector3D } from './types';
import { AnimatedCharacter, loadCharacter } from './AnimatedCharacter';
import { CHARACTER_CONFIGS, DEFAULT_CHARACTER } from './characterConfigs';
import type { CharacterConfig } from './characterConfigs';
import { AnimationStateMachine, AnimPhase, JumpState } from './AnimationStateMachine';
import { AnimationNames } from './constants';

export class CharacterManager {
	// ── Public fields ───────────────────────────────────────────────────
	public characters: Map<number, AnimatedCharacter> = new Map();
	public localCharacter: AnimatedCharacter | null = null;
	public localAnimSM: AnimationStateMachine = new AnimationStateMachine();
	public localJumpState: JumpState = JumpState.GROUNDED;
	public localIsDead: boolean = false;
	public localIsGrounded: boolean = true;
	public position: Vector3 = new BABYLON.Vector3(0, 1, 0);
	public readonly localPlayerID: number;

	// ── Private fields ──────────────────────────────────────────────────
	private scene: Scene;
	private loadingCharacters: Set<number> = new Set();
	private characterConfigMap: Map<number, CharacterConfig> = new Map();
	private remoteJumpStates: Map<number, JumpState> = new Map();
	private remoteAnimSMs: Map<number, AnimationStateMachine> = new Map();

	constructor(scene: Scene, localPlayerID: number) {
		this.scene = scene;
		this.localPlayerID = localPlayerID;
	}

	// ── Accessors ───────────────────────────────────────────────────────

	getChar(playerId: number): AnimatedCharacter | null {
		if (playerId === this.localPlayerID) return this.localCharacter;
		return this.characters.get(playerId) ?? null;
	}

	getConfig(playerId: number): CharacterConfig | undefined {
		return this.characterConfigMap.get(playerId);
	}

	getRemoteJumpState(playerId: number): JumpState {
		return this.remoteJumpStates.get(playerId) ?? JumpState.GROUNDED;
	}

	setRemoteJumpState(playerId: number, state: JumpState): void {
		this.remoteJumpStates.set(playerId, state);
	}

	getRemoteAnimSM(playerId: number): AnimationStateMachine {
		let sm = this.remoteAnimSMs.get(playerId);
		if (!sm) {
			sm = new AnimationStateMachine();
			this.remoteAnimSMs.set(playerId, sm);
		}
		return sm;
	}

	// ── Local player ────────────────────────────────────────────────────

	async initLocalPlayer(config: CharacterConfig): Promise<void> {
		this.localCharacter = new AnimatedCharacter(this.scene);
		await loadCharacter(this.localCharacter, config);
		this.characterConfigMap.set(this.localPlayerID, config);
		this.localCharacter.initTrail(config);
		this.localCharacter.setPosition(this.position);
	}

	playLocalSpawn(): void {
		if (!this.localCharacter) return;
		this.localCharacter.playAnimation(AnimationNames.spawn, false);
		this.localAnimSM.enter(AnimPhase.Spawn);
	}

	// ── Remote characters ───────────────────────────────────────────────

	async createRemoteCharacter(
		playerId: number,
		charData: { position: Vector3D; yaw: number },
		characterClassesRef: RefObject<Map<number, string>>,
	): Promise<void> {
		if (this.loadingCharacters.has(playerId)) return;
		this.loadingCharacters.add(playerId);

		try {
			const char = new AnimatedCharacter(this.scene);

			const cls = characterClassesRef.current?.get(playerId);
			const config =
				CHARACTER_CONFIGS[cls as keyof typeof CHARACTER_CONFIGS] ??
				CHARACTER_CONFIGS[DEFAULT_CHARACTER];
			this.characterConfigMap.set(playerId, config);

			await loadCharacter(char, config);
			char.initTrail(config);

			// Race-condition guard: if the local player was assigned this id
			// while we were loading, discard the duplicate.
			if (playerId === this.localPlayerID) {
				char.dispose();
				return;
			}

			char.setPosition(
				new BABYLON.Vector3(charData.position.x, charData.position.y, charData.position.z),
			);
			char.setRotation(charData.yaw);

			this.characters.set(playerId, char);
			this.remoteJumpStates.set(playerId, JumpState.GROUNDED);

			const sm = this.getRemoteAnimSM(playerId);
			sm.enter(AnimPhase.Spawn);
			char.playAnimation(AnimationNames.spawn, false);
		} catch (err) {
			console.error(`[CharacterManager] Failed to create remote character ${playerId}:`, err);
		} finally {
			this.loadingCharacters.delete(playerId);
		}
	}

	removeRemote(playerId: number): void {
		const char = this.characters.get(playerId);
		if (char) char.dispose();
		this.characters.delete(playerId);
		this.loadingCharacters.delete(playerId);
		this.remoteJumpStates.delete(playerId);
		this.remoteAnimSMs.delete(playerId);
		this.characterConfigMap.delete(playerId);
	}

	isLoading(playerId: number): boolean {
		return this.loadingCharacters.has(playerId);
	}

	// ── Cleanup ─────────────────────────────────────────────────────────

	dispose(): void {
		for (const char of this.characters.values()) {
			char.dispose();
		}
		if (this.localCharacter) {
			this.localCharacter.dispose();
			this.localCharacter = null;
		}
		this.characters.clear();
		this.loadingCharacters.clear();
		this.characterConfigMap.clear();
		this.remoteJumpStates.clear();
		this.remoteAnimSMs.clear();
	}
}
