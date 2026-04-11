import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { GameAudioEngine } from './AudioEngine';
import type { SoundBank } from './SoundBank';
import type { Vector3D, CharacterSnapshot, GameEvent } from '../game/types';
import {
	LOCAL_INPUT_TRIGGERS,
	LOCAL_CONTINUOUS_TRIGGERS,
	REMOTE_SNAPSHOT_TRIGGERS,
	GAME_EVENT_TRIGGERS,
} from './triggerTables';
import type { InputState, GameEventContext } from './triggerTables';

export type { InputState, GameEventContext };

function randomRange(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

export class AudioEventSystem {
	private engine: GameAudioEngine;
	private soundBank: SoundBank;
	private lastPlayTimes = new Map<string, number>();
	private characterClass: string | null = null;
	// Pipeline 1: edge-detection state — auto-initialised from LOCAL_INPUT_TRIGGERS
	private prevInputState: Record<string, boolean> = {};
	// Pipeline 2: per-player adaptive footstep timers
	private footstepTimers = new Map<number, number>();
	// Pipeline 1b: continuous trigger timers (local player)
	private continuousTimers = new Map<string, number>();
	// Pending delayed sounds — tracked so they can be cancelled on dispose
	private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
	private disposed = false;

	constructor(engine: GameAudioEngine, soundBank: SoundBank) {
		this.engine = engine;
		this.soundBank = soundBank;
		for (const trigger of LOCAL_INPUT_TRIGGERS) {
			this.prevInputState[trigger.field] = trigger.initialValue ?? false;
		}
	}

	setCharacterClass(cls: string): void {
		this.characterClass = cls;
	}

	/**
	 * Resolve a generic sound ID to a class-specific one if available.
	 * e.g. "player_footstep" + class "knight" → "knight_footstep" (if loaded),
	 * otherwise falls back to "player_footstep".
	 */
	private resolveSoundId(baseSoundId: string, characterClass?: string | null): string {
		const raw = characterClass ?? this.characterClass;
		if (!raw) return baseSoundId;
		const cls = raw.toLowerCase();

		// "player_footstep" → "footstep", "player_attack_swing" → "attack_swing"
		const suffix = baseSoundId.replace(/^player_/, '');
		const classSpecificId = `${cls}_${suffix}`;

		// Use class-specific only if real sound files were loaded (not just procedural fallbacks)
		if (this.soundBank.hasLoadedFiles(classSpecificId)) {
			return classSpecificId;
		}
		return baseSoundId;
	}

	/** Pipeline 1: local player input (0 ms, same trigger as updateLocalAnimation) */
	onLocalInput(input: InputState, position: Vector3D): void {
		if (!this.engine.isInitialized()) return;

		for (const trigger of LOCAL_INPUT_TRIGGERS) {
			const current = input[trigger.field] as boolean;
			const previous = this.prevInputState[trigger.field];
			const fired = trigger.edge === 'rising' ? current && !previous : !current && previous;

			if (fired) {
				const resolved = this.resolveSoundId(trigger.soundId);
				if (trigger.delayMs) {
					const vol = trigger.volume;
					const timer = setTimeout(() => {
						this.pendingTimers.delete(timer);
						if (!this.disposed) this.playSoundAt(resolved, position, vol);
					}, trigger.delayMs);
					this.pendingTimers.add(timer);
				} else {
					this.playSoundAt(resolved, position, trigger.volume);
				}
			}
		}
		// Update previous state after all triggers have been evaluated
		for (const trigger of LOCAL_INPUT_TRIGGERS) {
			this.prevInputState[trigger.field] = input[trigger.field] as boolean;
		}

		// Pipeline 1b: continuous triggers (e.g. footsteps while walking)
		for (const trigger of LOCAL_CONTINUOUS_TRIGGERS) {
			if (!trigger.predicate(input)) continue;

			const now = performance.now();
			const last = this.continuousTimers.get(trigger.soundId) ?? 0;
			if (now - last < trigger.intervalMs) continue;

			this.continuousTimers.set(trigger.soundId, now);
			this.playSoundAt(this.resolveSoundId(trigger.soundId), position, trigger.volume);
		}
	}

	/** Pipeline 2: remote players via snapshot delta (same trigger as updateRemoteAnimation) */
	onRemoteSnapshot(
		prev: CharacterSnapshot,
		cur: CharacterSnapshot,
		characterClass?: string | null,
	): void {
		if (!this.engine.isInitialized()) return;

		for (const trigger of REMOTE_SNAPSHOT_TRIGGERS) {
			if (!trigger.predicate(prev, cur)) continue;

			if (trigger.throttled) {
				const speedXZ = Math.sqrt(cur.velocity.x ** 2 + cur.velocity.z ** 2);
				const interval = Math.max(200, 500 - speedXZ * 15);
				const now = performance.now();
				const lastFootstep = this.footstepTimers.get(cur.player_id) ?? 0;
				if (now - lastFootstep < interval) continue;
				this.footstepTimers.set(cur.player_id, now);
			}

			const volume = trigger.volumeMapper?.(prev, cur);
			const resolved = this.resolveSoundId(trigger.soundId, characterClass);
			this.playSoundAt(resolved, cur.position, volume);
		}
	}

	/**
	 * Explicit one-shot tied to a local animation/state transition.
	 * Use this for actions that must be heard only when the animation actually starts.
	 */
	onLocalAnimationEvent(
		soundId: string,
		position: Vector3D,
		overrideVolume?: number,
		delayMs?: number,
	): void {
		if (!this.engine.isInitialized()) return;
		const resolved = this.resolveSoundId(soundId);
		if (delayMs && delayMs > 0) {
			const timer = setTimeout(() => {
				this.pendingTimers.delete(timer);
				if (!this.disposed) this.playSoundAt(resolved, position, overrideVolume);
			}, delayMs);
			this.pendingTimers.add(timer);
			return;
		}
		this.playSoundAt(resolved, position, overrideVolume);
	}

	/**
	 * Pipeline 3: discrete gameplay events from the server (Damage, Death, Spawn…).
	 *
	 * Single dispatcher — each sound is one row in GAME_EVENT_TRIGGERS. Adding a
	 * new one never touches this method: declarative trigger table only.
	 */
	onGameEvents(events: GameEvent[], ctx: GameEventContext): void {
		if (!this.engine.isInitialized()) return;

		for (const event of events) {
			for (const trigger of GAME_EVENT_TRIGGERS) {
				if (event.type !== trigger.type) continue;
				if (trigger.predicate && !trigger.predicate(event, ctx)) continue;

				const position = trigger.position(event, ctx);
				if (!position) continue;

				const volume = trigger.volumeMapper?.(event);
				// Resolve class-specific sound for the player that emitted this event
				const charClass = trigger.playerId
					? (ctx.characterClasses.get(trigger.playerId(event)) ?? null)
					: null;
				const resolved = this.resolveSoundId(trigger.soundId, charClass);
				this.playSoundAt(resolved, position, volume);
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const timer of this.pendingTimers) clearTimeout(timer);
		this.pendingTimers.clear();
	}

	private playSoundAt(
		soundId: string,
		position: Vector3D,
		overrideVolume?: number,
		overridePitch?: number,
	): void {
		const def = this.soundBank.getDefinition(soundId);
		if (!def) return;

		const now = performance.now();
		const lastPlay = this.lastPlayTimes.get(soundId) ?? 0;
		if (now - lastPlay < def.cooldown) return;
		this.lastPlayTimes.set(soundId, now);

		const sound = this.soundBank.getRandomSound(soundId);
		if (!sound) return;

		sound.volume = overrideVolume ?? randomRange(def.volume.min, def.volume.max);
		sound.playbackRate = overridePitch ?? randomRange(def.pitch.min, def.pitch.max);

		if (def.spatial) {
			sound.spatial.position = new Vector3(position.x, position.y, position.z);
		}

		sound.play();
	}
}
