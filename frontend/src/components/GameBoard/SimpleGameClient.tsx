// Simple game client - uses window.BABYLON and window.TOOLKIT
// set by the toolkit scripts loaded in index.html
import type { Engine, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import type * as BabylonType from '@babylonjs/core';
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import type { GameEvent, GameStateSnapshot, Vector3D } from '../../game/types';
import { AnimatedCharacter, loadCharacter } from '@/game/AnimatedCharacter';
import { CHARACTER_CONFIGS, DEFAULT_CHARACTER } from '@/game/characterConfigs';
import type { CharacterConfig } from '@/game/characterConfigs';
import { GameAudioEngine } from '@/audio/AudioEngine';
import { SoundBank } from '@/audio/SoundBank';
import { AudioEventSystem } from '@/audio/AudioEventSystem';

declare const BABYLON: typeof BabylonType;
declare const TOOLKIT: { SceneManager: { InitializeRuntime(engine: Engine): Promise<void> } };

// ============ COPIED FROM simple_client.ts ============

interface CharacterSnapshot {
	player_id: number;
	position: Vector3D;
	velocity: Vector3D;
	yaw: number;
	state: number;
	health: number;
	max_health: number;
	// Cooldown data
	ability1_timer: number;
	ability1_cooldown: number;
	ability2_timer: number;
	ability2_cooldown: number;
	swing_progress: number;
}

interface InputState {
	movementDirection: Vector3D;
	isAttacking: boolean;
	isJumping: boolean;
	isSprinting: boolean;
}

const CharacterState = {
	Idle: 0,
	Moving: 1,
	Attacking: 2,
	Stunned: 4,
	Dead: 5,
} as const;
type CharacterState = (typeof CharacterState)[keyof typeof CharacterState];

// Isometric camera: 35.264° elevation, 45° rotation, orthographic
const ISO_CAM_DIST = 80; // distance from target (doesn't affect size in ortho, just clipping)
const ISO_CAM_HEIGHT = ISO_CAM_DIST * 0.7071; // tan(35.264°) ≈ 0.7071
const ISO_CAM_OFFSET = { x: ISO_CAM_DIST, y: ISO_CAM_HEIGHT, z: -ISO_CAM_DIST };
const ISO_ORTHO_SIZE = 10; //  controls zoom level (80 would be full world in view)

const AnimationNames = {
	idle: 'Idle_A',
	walk: 'Walking_B',
	run: 'Running_B',
	jumpStart: 'Jump_Start',
	jumpIdle: 'Jump_Idle',
	jumpLand: 'Jump_Land',
	attack: 'Melee_1H_Attack_Slice_Horizontal',
	hit: 'Hit_A',
	death: 'Death_A',
	spawn: 'Spawn_Air',
};

const JumpState = {
	GROUNDED: 'grounded',
	JUMP_START: 'jump_start',
	AIRBORNE: 'airborne',
	LANDING: 'landing',
} as const;
type JumpState = (typeof JumpState)[keyof typeof JumpState];

// Shared jump state machine for both local and remote characters.
function tickJumpState(
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

class GameClient {
	private scene: Scene;
	private localPlayerID: number;
	private characters: Map<number, AnimatedCharacter> = new Map();
	private loadingCharacters: Set<number> = new Set();
	private localCharacter: AnimatedCharacter | null = null;
	private position: Vector3 = new BABYLON.Vector3(0, 1, 0);
	private camera: UniversalCamera;
	private currentAnimState: string = 'idle';
	private jumpState: JumpState = JumpState.GROUNDED;
	private remoteJumpStates: Map<number, JumpState> = new Map();
	private characterConfig: CharacterConfig;
	private characterClassesRef: RefObject<Map<number, string>>;
	// Audio
	private audioEngine: GameAudioEngine | null = null;
	private soundBank: SoundBank | null = null;
	private audioEventSystem: AudioEventSystem | null = null;
	private ambientSound: import('@babylonjs/core/AudioV2').StaticSound | null = null;
	// HUD
	private gui: any = null;
	private enemyBars: Map<number, { bg: any; fill: any }> = new Map();
	private localHealthFill: any = null;
	private cooldownBars: { attack: any; ability1: any; ability2: any } | null = null;

	constructor(
		scene: Scene,
		localPlayerID: number,
		camera: UniversalCamera,
		characterConfig: CharacterConfig = CHARACTER_CONFIGS[DEFAULT_CHARACTER],
		characterClassesRef: RefObject<Map<number, string>> = { current: new Map() },
	) {
		this.scene = scene;
		this.localPlayerID = localPlayerID;
		this.camera = camera;
		this.characterConfig = characterConfig;
		this.characterClassesRef = characterClassesRef;
		this.initAudio();
		this.setupHUD();
	}

	private async initAudio(): Promise<void> {
		try {
			const audioEngine = new GameAudioEngine();
			const soundBank = new SoundBank();
			await audioEngine.initialize();
			await soundBank.loadAll(audioEngine);
			audioEngine.attachListenerToCamera(this.camera);
			this.audioEngine = audioEngine;
			this.soundBank = soundBank;
			const aes = new AudioEventSystem(audioEngine, soundBank);
			aes.setLocalPlayerId(this.localPlayerID);
			this.audioEventSystem = aes;

			// Start ambient loop
			const ambientSound = soundBank.getRandomSound('amb_forest');
			if (ambientSound) {
				const ambDef = soundBank.getDefinition('amb_forest');
				if (ambDef) {
					ambientSound.volume = ambDef.volume.min + Math.random() * (ambDef.volume.max - ambDef.volume.min);
				}
				(ambientSound as any).loop = true;
				ambientSound.play();
				this.ambientSound = ambientSound;
			}

			console.log('[Audio] Game audio initialized');
		} catch (err) {
			console.warn('[Audio] Failed to initialize game audio:', err);
		}
	}

	disposeAudio(): void {
		(this.ambientSound as any)?.stop?.();
		this.ambientSound = null;
		this.audioEngine?.dispose();
		this.audioEngine = null;
		this.soundBank = null;
		this.audioEventSystem = null;
	}

	private setupHUD(): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const GUI = (BABYLON as any).GUI;
		this.gui = GUI.AdvancedDynamicTexture.CreateFullscreenUI('HUD', true, this.scene);

		// Update enemy bar positions every frame by projecting world-space position
		this.scene.onBeforeRenderObservable.add(() => {
			for (const [playerID, bar] of this.enemyBars.entries()) {
				const char = this.characters.get(playerID);
				if (!char) continue;
				const pos = char.rootNode.getAbsolutePosition();
				bar.bg.moveToVector3(new BABYLON.Vector3(pos.x, pos.y + 2.4, pos.z), this.scene);
			}
		});

		// Local player health bar — bottom center
		const localBg = new GUI.Rectangle('local-hp-bg');
		localBg.width = '200px';
		localBg.height = '14px';
		localBg.cornerRadius = 3;
		localBg.color = '#00000099';
		localBg.thickness = 1;
		localBg.background = '#1a1a1a';
		localBg.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
		localBg.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
		localBg.top = '-28px';
		this.gui.addControl(localBg);

		const localFill = new GUI.Rectangle('local-hp-fill');
		localFill.width = '100%';
		localFill.height = '100%';
		localFill.cornerRadius = 0;
		localFill.color = 'transparent';
		localFill.thickness = 0;
		localFill.background = '#c0392b';
		localFill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		localBg.addControl(localFill);

		this.localHealthFill = localFill;

		// Cooldown bars — row below health bar
		const cdContainer = new GUI.StackPanel('cd-container');
		cdContainer.isVertical = false;
		cdContainer.height = '12px';
		cdContainer.width = '200px';
		cdContainer.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
		cdContainer.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
		cdContainer.top = '-10px';
		cdContainer.spacing = 4;
		this.gui.addControl(cdContainer);

		const makeCdBar = (name: string, color: string) => {
			const bg = new GUI.Rectangle(`cd-bg-${name}`);
			bg.width = '62px';
			bg.height = '10px';
			bg.cornerRadius = 2;
			bg.color = '#00000099';
			bg.thickness = 1;
			bg.background = '#1a1a1a';
			cdContainer.addControl(bg);

			const fill = new GUI.Rectangle(`cd-fill-${name}`);
			fill.width = '0%';
			fill.height = '100%';
			fill.cornerRadius = 0;
			fill.color = 'transparent';
			fill.thickness = 0;
			fill.background = color;
			fill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
			bg.addControl(fill);

			return fill;
		};

		this.cooldownBars = {
			attack:   makeCdBar('attack',   '#e67e22'),
			ability1: makeCdBar('ability1', '#3498db'),
			ability2: makeCdBar('ability2', '#9b59b6'),
		};
	}

	private createEnemyBar(playerID: number): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const GUI = (BABYLON as any).GUI;

		const bg = new GUI.Rectangle(`enemy-hp-bg-${playerID}`);
		bg.width = '54px';
		bg.height = '5px';
		bg.cornerRadius = 2;
		bg.color = 'transparent';
		bg.thickness = 0;
		bg.background = '#1a1a1a';
		bg.isPointerBlocker = false;
		this.gui.addControl(bg);

		const fill = new GUI.Rectangle(`enemy-hp-fill-${playerID}`);
		fill.width = '100%';
		fill.height = '100%';
		fill.cornerRadius = 0;
		fill.color = 'transparent';
		fill.thickness = 0;
		fill.background = '#c0392b';
		fill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
		bg.addControl(fill);

		this.enemyBars.set(playerID, { bg, fill });
	}

	async initLocalPlayer(): Promise<void> {
		this.localCharacter = new AnimatedCharacter(this.scene);
		await loadCharacter(this.localCharacter, this.characterConfig);

		this.localCharacter.setPosition(this.position);
		this.localCharacter.playAnimation('Spawn_Air', false);
		setTimeout(() => {
			this.currentAnimState = '';
			this.playAnimation('idle');
		}, 1500);
	}

	private playAnimation(state: string, loop: boolean = true): void {
		if (this.currentAnimState === state) return;
		const animName = AnimationNames[state as keyof typeof AnimationNames];
		if (animName && this.localCharacter) {
			this.localCharacter.playAnimation(animName, loop);
			this.currentAnimState = state;
		}
	}

	processSnapshot(snapshot: GameStateSnapshot) {
		const activePlayerIDs = new Set<number>();

		for (const char of snapshot.characters) {
			activePlayerIDs.add(char.player_id);

			if (char.player_id === this.localPlayerID) {
				const serverPos = new BABYLON.Vector3(
					char.position.x,
					char.position.y,
					char.position.z,
				);
				this.position.copyFrom(serverPos);
				if (this.localCharacter) {
					this.localCharacter.setPosition(this.position);
					this.localCharacter.setRotation(char.yaw);
				}

				if (this.localHealthFill) {
					const pct = char.max_health > 0 ? char.health / char.max_health : 0;
					this.localHealthFill.width = `${(Math.max(0, Math.min(1, pct)) * 100).toFixed(1)}%`;
				}

				// Update cooldown bars
				if (this.cooldownBars) {
					this.cooldownBars.attack.width =
						`${(Math.max(0, Math.min(1, char.swing_progress)) * 100).toFixed(1)}%`;

					const cd1 = char.ability1_cooldown > 0
						? char.ability1_timer / char.ability1_cooldown : 0;
					this.cooldownBars.ability1.width =
						`${(Math.max(0, Math.min(1, cd1)) * 100).toFixed(1)}%`;

					const cd2 = char.ability2_cooldown > 0
						? char.ability2_timer / char.ability2_cooldown : 0;
					this.cooldownBars.ability2.width =
						`${(Math.max(0, Math.min(1, cd2)) * 100).toFixed(1)}%`;
				}

				// Update camera to follow player
				this.camera.position = new BABYLON.Vector3(
					this.position.x + ISO_CAM_OFFSET.x,
					this.position.y + ISO_CAM_OFFSET.y,
					this.position.z + ISO_CAM_OFFSET.z,
				);
				this.camera.setTarget(this.position);
			} else {
				const remoteChar = this.characters.get(char.player_id);
				if (!remoteChar && !this.loadingCharacters.has(char.player_id)) {
					this.createRemoteCharacter(char.player_id, char);
				} else if (remoteChar) {
					const pos = new BABYLON.Vector3(
						char.position.x,
						char.position.y,
						char.position.z,
					);
					remoteChar.setPosition(pos);
					remoteChar.setRotation(char.yaw);
					this.updateRemoteAnimation(char.player_id, remoteChar, char);

					const bar = this.enemyBars.get(char.player_id);
					if (bar) {
						const pct = char.max_health > 0 ? char.health / char.max_health : 0;
						bar.fill.width = `${(Math.max(0, Math.min(1, pct)) * 100).toFixed(1)}%`;
					}
				}
			}
		}

		const disconnectedPlayers: number[] = [];
		for (const [playerID, character] of this.characters.entries()) {
			if (!activePlayerIDs.has(playerID)) {
				disconnectedPlayers.push(playerID);
				character.dispose();
			}
		}
		for (const playerID of disconnectedPlayers) {
			this.characters.delete(playerID);
			this.loadingCharacters.delete(playerID);
			this.remoteJumpStates.delete(playerID);
			const bar = this.enemyBars.get(playerID);
			if (bar) {
				bar.bg.dispose();
				this.enemyBars.delete(playerID);
			}
		}
	}

	private async createRemoteCharacter(
		playerID: number,
		charData: CharacterSnapshot,
	): Promise<void> {
		this.loadingCharacters.add(playerID);
		const remoteChar = new AnimatedCharacter(this.scene);
		try {
			const cls = this.characterClassesRef.current?.get(playerID);
			const config =
				(cls ? CHARACTER_CONFIGS[cls as keyof typeof CHARACTER_CONFIGS] : undefined) ??
				CHARACTER_CONFIGS[DEFAULT_CHARACTER];
			await loadCharacter(remoteChar, config);

			if (playerID === this.localPlayerID) {
				remoteChar.dispose();
				this.loadingCharacters.delete(playerID);
				return;
			}
			remoteChar.setPosition(
				new BABYLON.Vector3(charData.position.x, charData.position.y, charData.position.z),
			);
			remoteChar.setRotation(charData.yaw);
			this.characters.set(playerID, remoteChar);
			this.remoteJumpStates.set(playerID, JumpState.GROUNDED);
			remoteChar.playAnimation(AnimationNames.idle, true);
			this.createEnemyBar(playerID);
		} catch (error) {
			console.error(`Failed to load remote character ${playerID}:`, error);
		} finally {
			this.loadingCharacters.delete(playerID);
		}
	}

	private updateRemoteAnimation(
		playerID: number,
		character: AnimatedCharacter,
		charData: CharacterSnapshot,
	): void {
		const isGrounded = charData.position.y <= 1.1;
		const speed = Math.sqrt(
			charData.velocity.x * charData.velocity.x + charData.velocity.z * charData.velocity.z,
		);

		const jumpState = tickJumpState(
			character,
			this.remoteJumpStates.get(playerID) ?? JumpState.GROUNDED,
			isGrounded,
			false,
		);
		this.remoteJumpStates.set(playerID, jumpState);
		if (jumpState !== JumpState.GROUNDED) return;

		switch (charData.state) {
			case CharacterState.Attacking:
				character.playAnimation(AnimationNames.attack, true);
				break;
			case CharacterState.Stunned:
				character.playAnimation(AnimationNames.hit, false);
				break;
			case CharacterState.Dead:
				character.playAnimation(AnimationNames.death, false);
				break;
			case CharacterState.Moving:
				character.playAnimation(
					speed > 10 ? AnimationNames.run : AnimationNames.walk,
					true,
				);
				break;
			case CharacterState.Idle:
			default:
				character.playAnimation(AnimationNames.idle, true);
				break;
		}
	}

	updateLocalAnimation(input: InputState): void {
		if (!this.localCharacter) return;

		const isGrounded = this.position.y <= 1.1;
		const isMoving = input.movementDirection.x !== 0 || input.movementDirection.z !== 0;

		// Trigger audio for local player input
		this.audioEventSystem?.onLocalInput(
			{
				movementDirection: input.movementDirection,
				isAttacking: input.isAttacking,
				isJumping: input.isJumping,
				isSprinting: input.isSprinting,
				isGrounded,
			},
			{ x: this.position.x, y: this.position.y, z: this.position.z },
		);

		this.jumpState = tickJumpState(
			this.localCharacter,
			this.jumpState,
			isGrounded,
			input.isJumping,
		);
		if (this.jumpState !== JumpState.GROUNDED) return;

		const attackAnim = this.localCharacter.animations.get(AnimationNames.attack);
		const isAttackPlaying = attackAnim?.isPlaying ?? false;

		// Reset state tracker when attack animation finishes naturally so it can replay
		if (this.currentAnimState === 'attack' && !isAttackPlaying) {
			this.currentAnimState = '';
		}

		if (isAttackPlaying && isMoving) {
			// Movement cancels the attack animation
			this.playAnimation(input.isSprinting ? 'run' : 'walk');
		} else if (isAttackPlaying) {
			// Attack animation is playing — let it finish, pressing attack again keeps it going
		} else if (input.isAttacking) {
			this.playAnimation('attack', false); // non-looped: play once to completion
		} else if (isMoving) {
			this.playAnimation(input.isSprinting ? 'run' : 'walk');
		} else {
			this.playAnimation('idle');
		}
	}

	/** Process a batch of game events drained from the event queue. */
	processEvents(events: GameEvent[]) {
		for (const event of events) {
			switch (event.type) {
				case 'Death':
					console.debug('[Game] Death: killer=%d victim=%d', event.killer, event.victim);
					// TODO: play death animation on victim, show kill feed
					break;
				case 'Damage':
					console.debug('[Game] Damage: %d → %d (%.1f)', event.attacker, event.victim, event.damage);
					// TODO: spawn floating damage number above victim
					break;
				case 'Spawn':
					console.debug('[Game] Spawn: player=%d', event.player_id);
					// TODO: play spawn effect / reset character state
					break;
				case 'StateChange':
					console.debug('[Game] StateChange: player=%d state=%d', event.player_id, event.state);
					// TODO: trigger state-specific animation
					break;
				case 'MatchEnd':
					console.debug('[Game] MatchEnd');
					// TODO: show match-end screen
					break;
			}
		}
	}
}

// ============ MINIMAL REACT WRAPPER ============

interface Props {
	/** Ref to the latest GameStateSnapshot. Read in the Babylon render loop — NOT React state. */
	snapshotRef: RefObject<GameStateSnapshot | null>;
	/** Ref mapping player_id → character_class string. Populated from PlayerJoined messages. */
	characterClassesRef: RefObject<Map<number, string>>;
	/** Ref containing queued game events. Drained each frame by the Babylon render loop. */
	eventsRef: RefObject<GameEvent[]>;
	onSendInput: (
		movement: Vector3D,
		lookDirection: Vector3D,
		attacking: boolean,
		jumping: boolean,
		sprinting: boolean,
	) => void;
	localPlayerId: number;
	characterConfig?: CharacterConfig;
}

export default function SimpleGameClient({
	snapshotRef,
	characterClassesRef,
	eventsRef,
	onSendInput,
	localPlayerId,
	characterConfig,
}: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const gameClientRef = useRef<GameClient | null>(null);
	const engineRef = useRef<Engine | null>(null);

	useEffect(() => {
		if (!canvasRef.current || !localPlayerId) return;

		const canvas = canvasRef.current;
		let disposed = false;
		let sceneInstance: Scene | null = null;

		canvas.focus();
		canvas.tabIndex = 1;
		const onFocus = () => canvas.focus();
		window.addEventListener('focus', onFocus);
		let onKeydown: ((event: KeyboardEvent) => void) | null = null;
		let onResize: (() => void) | null = null;

		(async () => {
			const engine = new BABYLON.Engine(canvas, true);
			engineRef.current = engine;

			await TOOLKIT.SceneManager.InitializeRuntime(engine);
			if (disposed) {
				engine.dispose();
				return;
			}

			const scene = new BABYLON.Scene(engine);
			sceneInstance = scene;

			// True isometric camera: 35.264° elevation, 45° horizontal rotation, orthographic
			const arenaCenter = new BABYLON.Vector3(0, 0, 0);
			const camera = new BABYLON.UniversalCamera(
				'camera',
				new BABYLON.Vector3(
					arenaCenter.x + ISO_CAM_OFFSET.x,
					arenaCenter.y + ISO_CAM_OFFSET.y,
					arenaCenter.z + ISO_CAM_OFFSET.z,
				),
				scene,
			);
			camera.setTarget(arenaCenter);
			camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
			const aspect = engine.getRenderWidth() / engine.getRenderHeight();
			camera.orthoLeft = -ISO_ORTHO_SIZE * aspect;
			camera.orthoRight = ISO_ORTHO_SIZE * aspect;
			camera.orthoTop = ISO_ORTHO_SIZE;
			camera.orthoBottom = -ISO_ORTHO_SIZE;
			camera.minZ = 0.1;
			camera.maxZ = 500;

			scene.onReadyObservable.addOnce(() => {
				console.log(
					'[Scene] cameras:',
					scene.cameras.map((c) => `${c.name} (${c.getClassName()})`),
				);
				scene.activeCamera = camera;
			});

			// Load the forest scene. The gltf is already centred at origin — no offset needed.
			// Use Append (not ImportMeshAsync) to avoid triggering Babylon's embedded-camera
			// activation. The onSuccess callback re-asserts our camera as a safety net and
			// adds a large ground plane to hide the backdrop past the terrain edges.
			BABYLON.SceneLoader.Append(
				'/scenes/Export/scenes/',
				'Forest.gltf',
				scene,
				() => {
					scene.activeCamera = camera;
					// Extend ground far beyond the playable area so the backdrop is never
					// visible when a player approaches the terrain edge (±25 units).
					const bgGround = BABYLON.MeshBuilder.CreateGround(
						'bg-ground', { width: 1000, height: 1000 }, scene,
					);
					bgGround.position.y = -0.01;
					const bgMat = new BABYLON.StandardMaterial('bg-ground-mat', scene);
					bgMat.diffuseColor = new BABYLON.Color3(0.15, 0.35, 0.1);
					bgMat.specularColor = BABYLON.Color3.Black();
					bgGround.material = bgMat;

					// --- Arena boundary walls ---
					// Inner face at ±25 (terrain edge); wall centre at ±(25 + WALL_T/2) so
					// the wall sits fully outside the playable area.
					// N/S walls are wider by WALL_T on each side to close the corners.
					const TERRAIN_EDGE = 25.0;
					const WALL_H = 1.2;
					const WALL_T = 0.8;
					const WALL_POS = TERRAIN_EDGE + WALL_T / 2; // 25.4
					const WALL_SPAN = TERRAIN_EDGE * 2 + WALL_T * 2; // 51.6 — closes corners
					const wallMat = new BABYLON.StandardMaterial('wall-mat', scene);
					wallMat.diffuseColor = new BABYLON.Color3(0.35, 0.25, 0.15);
					wallMat.specularColor = BABYLON.Color3.Black();

					const wallDefs = [
						['wall-n', WALL_SPAN, WALL_H, WALL_T,      0,        WALL_H / 2,  WALL_POS ],
						['wall-s', WALL_SPAN, WALL_H, WALL_T,      0,        WALL_H / 2, -WALL_POS ],
						['wall-e', WALL_T,    WALL_H, WALL_SPAN,   WALL_POS, WALL_H / 2,  0        ],
						['wall-w', WALL_T,    WALL_H, WALL_SPAN,  -WALL_POS, WALL_H / 2,  0        ],
					] as const;

					for (const [name, w, h, d, x, y, z] of wallDefs) {
						const wall = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
						wall.position.set(x, y, z);
						wall.material = wallMat;
					}

					},
				undefined,
				(_s, message, exception) => {
					console.error('Failed to load Forest scene:', message, exception);
				},
			);

			// Enable Inspector with Ctrl+Shift+I
			let inspectorLoaded = false;
			onKeydown = async (event: KeyboardEvent) => {
				if (event.ctrlKey && event.shiftKey && event.key === 'I') {
					event.preventDefault();
					if (!inspectorLoaded) {
						await import('@babylonjs/inspector');
						inspectorLoaded = true;
					}
					if (scene.debugLayer.isVisible()) {
						scene.debugLayer.hide();
					} else {
						await scene.debugLayer.show({
							embedMode: false,
							overlay: true,
							globalRoot: document.body,
						});
					}
				}
			};
			window.addEventListener('keydown', onKeydown);

			const gameClient = new GameClient(
				scene,
				localPlayerId,
				camera,
				characterConfig,
				characterClassesRef,
			);
			gameClientRef.current = gameClient;
			gameClient
				.initLocalPlayer()
				.catch((e) => console.error('[GameClient] Failed to load local player:', e));

			const input: InputState = {
				movementDirection: { x: 0, y: 0, z: 0 },
				isAttacking: false,
				isJumping: false,
				isSprinting: false,
			};
			const keysPressed = new Set<string>();

			scene.onKeyboardObservable.add((kbInfo) => {
				if (kbInfo.type === 1) {
					keysPressed.add(kbInfo.event.key.toLowerCase());
					// Attack is a one-shot trigger (keydown only, ignore keyboard repeat)
					if (kbInfo.event.key.toLowerCase() === 'e' && !(kbInfo.event as KeyboardEvent).repeat)
						input.isAttacking = true;
				} else if (kbInfo.type === 2) {
					keysPressed.delete(kbInfo.event.key.toLowerCase());
				}
			});

			// Precomputed isometric directions (camera rotated 45° around Y)
			// Key: bitmask WASD (W=8, A=4, S=2, D=1), Value: [worldX, worldZ] normalized
			const S = 0.7071;
			const isoDir: Record<number, [number, number]> = {
				0: [0, 0], // no input
				8: [-S, S], // W
				2: [S, -S], // S
				4: [-S, -S], // A
				1: [S, S], // D
				9: [0, 1], // W+D
				12: [-1, 0], // W+A
				3: [1, 0], // S+D
				6: [0, -1], // S+A
				10: [0, 0], // W+S (cancel)
				5: [0, 0], // A+D (cancel)
				15: [0, 0], // all (cancel)
				14: [-S, -S], // W+A+S
				13: [-S, S], // W+A+D
				11: [S, S], // W+S+D
				7: [S, -S], // A+S+D
			};
			scene.onBeforeRenderObservable.add(() => {
				const bits =
					(keysPressed.has('w') ? 8 : 0) |
					(keysPressed.has('a') ? 4 : 0) |
					(keysPressed.has('s') ? 2 : 0) |
					(keysPressed.has('d') ? 1 : 0);
				const dir = isoDir[bits] || [0, 0];
				input.movementDirection.x = dir[0];
				input.movementDirection.z = dir[1];
				input.isJumping = keysPressed.has(' ');
				input.isSprinting = keysPressed.has('shift');

				gameClient.updateLocalAnimation(input);
				input.isAttacking = false; // clear one-shot trigger after processing
			});

			// Track last movement direction so character keeps facing that way when idle
			const lastLookDir = { x: 0, y: 0, z: 1 };

			// Render loop — hard-capped at 60 fps.
			//
			// Babylon.js's engine.runRenderLoop() uses requestAnimationFrame, which
			// runs at the display's native refresh rate (60, 120, 144 Hz, etc.).
			// The game server produces snapshots at exactly 60 Hz, so rendering
			// faster than 60 fps provides no visual benefit and wastes GPU.
			//
			// We skip frames until at least TARGET_FRAME_MS have elapsed, giving us
			// a steady ~60 fps on any display without tearing or busy-waits.
			// The server game loop runs at exactly 60 Hz and reads the latest input
			// each tick.  Sending at the same rate ensures input lag is at most one
			// server tick (~16.67 ms) instead of up to three ticks at 20 Hz (50 ms).
			const TARGET_FRAME_MS = 1000 / 60; // ≈16.667 ms

			let lastFrameTime = 0;

			engine.runRenderLoop(() => {
				const now = performance.now();

				// Frame-rate cap: skip if not enough time has passed for a full frame.
				if (now - lastFrameTime < TARGET_FRAME_MS - 0.5) {
					return;
				}
				// Advance by one frame interval; clamp to `now` if more than 2 frames
				// behind to avoid a catch-up burst after a pause.
				lastFrameTime =
					now - lastFrameTime > TARGET_FRAME_MS * 2
						? now
						: lastFrameTime + TARGET_FRAME_MS;

				// Drain queued game events (Death, Damage, Spawn, etc.) before the snapshot
				// so animations/effects start before the authoritative state update.
				const events = eventsRef.current.splice(0);
				if (events.length > 0) {
					gameClient.processEvents(events);
				}

				// Apply the latest snapshot from the server (consumed once per frame).
				const snap = snapshotRef.current;
				if (snap !== null) {
					gameClient.processSnapshot(snap);
					snapshotRef.current = null;
				}

				// Send input at 60 Hz — matches the server's game-loop tick rate.
				if (input.movementDirection.x !== 0 || input.movementDirection.z !== 0) {
					lastLookDir.x = input.movementDirection.x;
					lastLookDir.z = input.movementDirection.z;
				}
				const lookDir = lastLookDir;
				onSendInput(
					input.movementDirection,
					lookDir,
					input.isAttacking,
					input.isJumping,
					input.isSprinting,
				);

				scene.render();
			});

			onResize = () => {
				engine.resize();
				const a = engine.getRenderWidth() / engine.getRenderHeight();
				camera.orthoLeft = -ISO_ORTHO_SIZE * a;
				camera.orthoRight = ISO_ORTHO_SIZE * a;
				camera.orthoTop = ISO_ORTHO_SIZE;
				camera.orthoBottom = -ISO_ORTHO_SIZE;
			};
			window.addEventListener('resize', onResize);
		})();

		return () => {
			disposed = true;
			window.removeEventListener('focus', onFocus);
			if (onKeydown) window.removeEventListener('keydown', onKeydown);
			if (onResize) window.removeEventListener('resize', onResize);
			gameClientRef.current?.disposeAudio();
			gameClientRef.current = null;
			engineRef.current?.stopRenderLoop();
			sceneInstance?.dispose();
			engineRef.current?.dispose();
			engineRef.current = null;
		};
	}, [localPlayerId]); // eslint-disable-line react-hooks/exhaustive-deps

	return <canvas ref={canvasRef} style={{ width: '100%', height: '100vh', display: 'block' }} />;
}
