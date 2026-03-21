// Simple game client - adapted from simple_client.ts with minimal React wrapper
import * as BabylonModule from '@babylonjs/core';
import {
	AbstractMesh,
	AnimationGroup,
	Engine,
	Scene,
	SceneLoader,
	TransformNode,
	UniversalCamera,
	Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import '@babylonjs/materials'; // Required for SkyMaterial and other materials
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import type { GameStateSnapshot, Vector3D } from '../../game/types';
import { measureModel } from '../../utils/measureModel';

// Make BABYLON available globally for Inspector (must be extensible object)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).BABYLON = Object.assign({}, BabylonModule);

// Import game assets
import combatMeleeAnims from '@/assets/Rig_Medium/Rig_Medium_CombatMelee.glb';
import generalModel from '@/assets/Rig_Medium/Rig_Medium_General.glb';
import movementBasicAnims from '@/assets/Rig_Medium/Rig_Medium_MovementBasic.glb';
import knightModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Knight.glb';


// ============ COPIED FROM simple_client.ts ============

interface CharacterSnapshot {
	player_id: number;
	position: Vector3D;
	velocity: Vector3D;
	yaw: number;
	state: number;
	health: number;
	max_health: number;
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
const ISO_CAM_OFFSET = new Vector3(ISO_CAM_DIST, ISO_CAM_HEIGHT, -ISO_CAM_DIST);
const ISO_ORTHO_SIZE = 30; //  controls zoom level (80 would be full world in view)

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
	GROUNDED: 'grounded', // On ground, normal animations
	JUMP_START: 'jump_start', // Playing jump start animation
	AIRBORNE: 'airborne', // In air, playing jump idle loop
	LANDING: 'landing', // Playing landing animation
} as const;
type JumpState = (typeof JumpState)[keyof typeof JumpState];

class AnimatedCharacter {
	public rootNode: TransformNode;
	public meshes: AbstractMesh[] = [];
	public animations: Map<string, AnimationGroup> = new Map();
	private currentAnimation: AnimationGroup | null = null;
	private currentAnimationName: string = '';
	private scene: Scene;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private skeleton: any = null; // Store this character's skeleton

	constructor(scene: Scene) {
		this.scene = scene;
		this.rootNode = new TransformNode('character_root', scene);
	}

	async loadModel(assetUrl: string): Promise<void> {
		const result = await SceneLoader.ImportMeshAsync('', '', assetUrl, this.scene);
		result.meshes.forEach((mesh) => {
			if (!mesh.parent) mesh.parent = this.rootNode;
			this.meshes.push(mesh);
		});
		result.animationGroups.forEach((anim) => {
			this.animations.set(anim.name, anim);
			anim.stop();
		});
		// Store this character's skeleton
		if (result.skeletons && result.skeletons.length > 0) {
			this.skeleton = result.skeletons[0];
		}
	}

	async loadAnimations(assetUrl: string): Promise<void> {
		const result = await SceneLoader.ImportMeshAsync('', '', assetUrl, this.scene);
		// Use THIS character's skeleton, not scene.skeletons[0]!
		if (!this.skeleton) return;

		result.animationGroups.forEach((anim) => {
			anim.targetedAnimations.forEach((ta) => {
				const targetName = ta.target?.name;
				if (targetName) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const mainBone = this.skeleton.bones.find((b: any) => b.name === targetName);
					if (mainBone) ta.target = mainBone.getTransformNode() || mainBone;
				}
			});
			this.animations.set(anim.name, anim);
			anim.stop();
		});

		result.meshes.forEach((mesh) => {
			mesh.isVisible = false;
			mesh.setEnabled(false);
		});
	}

	playAnimation(name: string, loop: boolean = true): void {
		if (this.currentAnimationName === name) return;
		const anim = this.animations.get(name);
		if (!anim) {
			console.warn(`[playAnimation] "${name}" not found. Available:`, [...this.animations.keys()]);
			return;
		}
		if (this.currentAnimation) this.currentAnimation.stop();
		anim.start(loop);
		this.currentAnimation = anim;
		this.currentAnimationName = name;
	}

	setPosition(pos: Vector3): void {
		this.rootNode.position.copyFrom(pos);
	}

	setRotation(yaw: number): void {
		this.rootNode.rotation.y = yaw;
	}

	dispose(): void {
		this.animations.forEach((anim) => anim.stop());
		this.meshes.forEach((mesh) => mesh.dispose());
		this.rootNode.dispose();
	}
}

// Shared jump state machine for both local and remote characters.
// Pass isJumping=true only for the local player (driven by input); remote
// players use false — we can't distinguish a jump from a fall for them.
// Returns the new JumpState. Grounded animations should only run when
// the returned state is JumpState.GROUNDED.
function tickJumpState(
	character: AnimatedCharacter,
	state: JumpState,
	isGrounded: boolean,
	isJumping: boolean,
): JumpState {
	// GROUNDED → JUMP_START (local player only)
	if (state === JumpState.GROUNDED && !isGrounded && isJumping) {
		character.playAnimation(AnimationNames.jumpStart, false);
		return JumpState.JUMP_START;
	}
	// GROUNDED → AIRBORNE (fell off edge, or remote player left the ground)
	if (state === JumpState.GROUNDED && !isGrounded) {
		character.playAnimation(AnimationNames.jumpIdle, true);
		return JumpState.AIRBORNE;
	}
	// JUMP_START → AIRBORNE (start animation finished)
	if (state === JumpState.JUMP_START) {
		const anim = character.animations.get(AnimationNames.jumpStart);
		if (anim && !anim.isPlaying) {
			character.playAnimation(AnimationNames.jumpIdle, true);
			return JumpState.AIRBORNE;
		}
		return JumpState.JUMP_START;
	}
	// AIRBORNE: keep jump-idle playing
	if (state === JumpState.AIRBORNE && !isGrounded) {
		character.playAnimation(AnimationNames.jumpIdle, true);
		return JumpState.AIRBORNE;
	}
	// AIRBORNE → LANDING
	if (state === JumpState.AIRBORNE && isGrounded) {
		character.playAnimation(AnimationNames.jumpLand, false);
		return JumpState.LANDING;
	}
	// LANDING → GROUNDED (wait for animation to finish)
	if (state === JumpState.LANDING) {
		const anim = character.animations.get(AnimationNames.jumpLand);
		if (anim && !anim.isPlaying) return JumpState.GROUNDED;
		return JumpState.LANDING;
	}
	return state; // already GROUNDED
}

class GameClient {
	private scene: Scene;
	private localPlayerID: number;
	private characters: Map<number, AnimatedCharacter> = new Map();
	private loadingCharacters: Set<number> = new Set();
	private localCharacter: AnimatedCharacter | null = null;
	private position: Vector3 = new Vector3(0, 1, 0);
	private velocity: Vector3 = new Vector3(0, 0, 0);
	private camera: UniversalCamera;
	private currentAnimState: string = 'idle';
	private jumpState: JumpState = JumpState.GROUNDED;
	private remoteJumpStates: Map<number, JumpState> = new Map();

	constructor(scene: Scene, localPlayerID: number, camera: UniversalCamera) {
		this.scene = scene;
		this.localPlayerID = localPlayerID;
		this.camera = camera;
	}

	async initLocalPlayer(): Promise<void> {
		this.localCharacter = new AnimatedCharacter(this.scene);
		await this.localCharacter.loadModel(knightModel);
		await this.localCharacter.loadAnimations(generalModel);
		await this.localCharacter.loadAnimations(movementBasicAnims);
		await this.localCharacter.loadAnimations(combatMeleeAnims);

		// Scale character up 3x to make it more visible
		this.localCharacter.rootNode.scaling.setAll(3);

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

	// Legacy method - kept for applyInput (currently disabled)
	private updateAnimation(input: InputState): void {
		if (!this.localCharacter) return;
		const isMoving = input.movementDirection.x !== 0 || input.movementDirection.z !== 0;
		const speed = Math.sqrt(
			this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z,
		);

		if (input.isAttacking) {
			this.playAnimation('attack', false);
			return;
		}

		if (isMoving) {
			this.playAnimation(speed > 3.0 ? 'run' : 'walk');
			if (this.velocity.x !== 0 || this.velocity.z !== 0) {
				const targetRotation = Math.atan2(this.velocity.x, this.velocity.z);
				this.localCharacter.setRotation(targetRotation);
			}
		} else {
			this.playAnimation('idle');
		}
	}

	// Legacy method - currently disabled (prediction disabled)
	// applyInput(input: InputState, deltaTime: number) {
	// 	const moveSpeed = 5.0;
	//
	// 	if (input.movementDirection.x !== 0 || input.movementDirection.z !== 0) {
	// 		const cameraForward = this.camera.getTarget().subtract(this.camera.position);
	// 		cameraForward.y = 0;
	// 		cameraForward.normalize();
	// 		const cameraRight = Vector3.Cross(Vector3.Up(), cameraForward).normalize();
	// 		const worldMoveDir = cameraForward
	// 			.scale(input.movementDirection.z)
	// 			.add(cameraRight.scale(input.movementDirection.x));
	//
	// 		if (worldMoveDir.length() > 0) {
	// 			worldMoveDir.normalize();
	// 			this.velocity.x = worldMoveDir.x * moveSpeed;
	// 			this.velocity.z = worldMoveDir.z * moveSpeed;
	// 		}
	// 	} else {
	// 		this.velocity.x = 0;
	// 		this.velocity.z = 0;
	// 	}
	//
	// 	if (input.isJumping && this.position.y <= 1.1) {
	// 		this.velocity.y = 8.0;
	// 	}
	//
	// 	if (this.position.y > 1.0) {
	// 		this.velocity.y -= 20.0 * deltaTime;
	// 	} else {
	// 		this.position.y = 1.0;
	// 		this.velocity.y = 0;
	// 	}
	//
	// 	this.position.addInPlace(this.velocity.scale(deltaTime));
	// 	this.position.x = Math.max(-49, Math.min(49, this.position.x));
	// 	this.position.z = Math.max(-49, Math.min(49, this.position.z));
	//
	// 	if (this.localCharacter) this.localCharacter.setPosition(this.position);
	// 	this.updateAnimation(input);
	//
	// 	this.camera.position = this.position.add(ISO_CAM_OFFSET);
	// 	this.camera.setTarget(this.position);
	// }

	processSnapshot(snapshot: GameStateSnapshot) {
		const activePlayerIDs = new Set<number>();

		for (const char of snapshot.characters) {
			activePlayerIDs.add(char.player_id);

			if (char.player_id === this.localPlayerID) {
				// PREDICTION DISABLED - Always use server position
				const serverPos = new Vector3(char.position.x, char.position.y, char.position.z);
				this.position.copyFrom(serverPos);
				if (this.localCharacter) {
					this.localCharacter.setPosition(this.position);
					this.localCharacter.setRotation(char.yaw); // Use server rotation
				}

				// Update camera to follow player
				this.camera.position = this.position.add(ISO_CAM_OFFSET);
				this.camera.setTarget(this.position);
			} else {
				const remoteChar = this.characters.get(char.player_id);
				if (!remoteChar && !this.loadingCharacters.has(char.player_id)) {
					this.createRemoteCharacter(char.player_id, char);
				} else if (remoteChar) {
					const pos = new Vector3(char.position.x, char.position.y, char.position.z);
					remoteChar.setPosition(pos);
					remoteChar.setRotation(char.yaw);
					this.updateRemoteAnimation(char.player_id, remoteChar, char);
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
		}
	}

	private async createRemoteCharacter(
		playerID: number,
		charData: CharacterSnapshot,
	): Promise<void> {
		this.loadingCharacters.add(playerID);
		const remoteChar = new AnimatedCharacter(this.scene);
		try {
			await remoteChar.loadModel(knightModel);
			await remoteChar.loadAnimations(generalModel);
			await remoteChar.loadAnimations(movementBasicAnims);
			await remoteChar.loadAnimations(combatMeleeAnims);

			// Scale character up 3x to make it more visible
			remoteChar.rootNode.scaling.setAll(3);

			if (playerID === this.localPlayerID) {
				remoteChar.dispose();
				this.loadingCharacters.delete(playerID);
				return;
			}
			remoteChar.setPosition(
				new Vector3(charData.position.x, charData.position.y, charData.position.z),
			);
			remoteChar.setRotation(charData.yaw);
			this.characters.set(playerID, remoteChar);
			// Initialize jump state for remote player
			this.remoteJumpStates.set(playerID, JumpState.GROUNDED);
			remoteChar.playAnimation(AnimationNames.idle, true);
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
				character.playAnimation(speed > 10 ? AnimationNames.run : AnimationNames.walk, true);
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

		this.jumpState = tickJumpState(this.localCharacter, this.jumpState, isGrounded, input.isJumping);
		if (this.jumpState !== JumpState.GROUNDED) return;

		if (input.isAttacking) {
			this.playAnimation('attack', true);
		} else if (isMoving) {
			this.playAnimation(input.isSprinting ? 'run' : 'walk');
		} else {
			this.playAnimation('idle');
		}
	}
}

// ============ MINIMAL REACT WRAPPER ============

interface Props {
	/** Ref to the latest GameStateSnapshot. Read in the Babylon render loop — NOT React state. */
	snapshotRef: RefObject<GameStateSnapshot | null>;
	onSendInput: (
		movement: Vector3D,
		lookDirection: Vector3D,
		attacking: boolean,
		jumping: boolean,
		sprinting: boolean,
	) => void;
	localPlayerId: number;
}

export default function SimpleGameClient({ snapshotRef, onSendInput, localPlayerId }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const gameClientRef = useRef<GameClient | null>(null);
	const engineRef = useRef<Engine | null>(null);

	// Initialize once — snapshotRef and onSendInput are stable refs/callbacks,
	// intentionally omitted from deps to avoid re-mounting the Babylon scene.

	useEffect(() => {
		if (!canvasRef.current || !localPlayerId) return;

		const canvas = canvasRef.current;
		canvas.focus();
		canvas.tabIndex = 1;
		const onFocus = () => canvas.focus();
		window.addEventListener('focus', onFocus);

		const engine = new Engine(canvas, true);
		const scene = new Scene(engine);
		engineRef.current = engine;

		// Measure character model to understand original scale
		measureModel(generalModel).then((dims) => {
			console.log('📏 === CHARACTER MODEL MEASUREMENTS ===');
			console.log(`   Height: ${dims.height.toFixed(3)} units (original scale)`);
			console.log(`   Width:  ${dims.width.toFixed(3)} units`);
			console.log(`   Depth:  ${dims.depth.toFixed(3)} units`);
			console.log(`   `);
			console.log(`   For 1.75m tall human (standard):`);
			console.log(`   Scale factor needed: ${(1.75 / dims.height).toFixed(2)}x`);
			console.log('📏 ====================================');
		});

		// True isometric camera: 35.264° elevation, 45° horizontal rotation, orthographic
		const arenaCenter = new Vector3(50, 0, 50);
		const camera = new UniversalCamera('camera', arenaCenter.add(ISO_CAM_OFFSET), scene);
		camera.setTarget(arenaCenter);
		camera.mode = UniversalCamera.ORTHOGRAPHIC_CAMERA;
		const aspect = engine.getRenderWidth() / engine.getRenderHeight();
		camera.orthoLeft = -ISO_ORTHO_SIZE * aspect;
		camera.orthoRight = ISO_ORTHO_SIZE * aspect;
		camera.orthoTop = ISO_ORTHO_SIZE;
		camera.orthoBottom = -ISO_ORTHO_SIZE;
		camera.minZ = 0.1;
		camera.maxZ = 500;

		// Load arena scene from Babylon.js Editor
		// The scene file references binary mesh data in the "example" folder
		SceneLoader.Append(
			'/scenes/',
			'arena.babylon',
			scene,
			(loadedScene) => {
				console.log('Arena scene loaded!');
				console.log('Loaded meshes:', loadedScene.meshes.length);

				// The editor scene is huge (spread over ~2000 units), but our game arena is 100x100
				// We need to scale it down and position it correctly
				const SCALE_FACTOR = 0.05; // Scale down to 5% of original size
				const ROTATION_Y = Math.PI / 1.5; // Rotate 90 degrees (adjust as needed: Math.PI = 180°, Math.PI/2 = 90°, etc.)

				// Create a root transform node for the entire scene
				const sceneRoot = new TransformNode('sceneRoot', scene);
				sceneRoot.position = new Vector3(50, 0, 50); // Center at game coordinates
				sceneRoot.scaling.setAll(SCALE_FACTOR);
				sceneRoot.rotation.y = ROTATION_Y; // Rotate the scene

				// Parent all root meshes to the scene root
				loadedScene.meshes.forEach((mesh) => {
					if (mesh.name !== '__root__' && !mesh.parent) {
						mesh.parent = sceneRoot;
					}
				});

				console.log(`Scene scaled to ${SCALE_FACTOR * 100}% and centered at (50, 0, 50)`);

				// Keep using game camera (not camera from the editor)
				loadedScene.activeCamera = camera;
			},
			undefined,
			(_s, message, exception) => {
				console.error('Failed to load arena scene:', message, exception);
			},
		);

		// Enable Inspector with Ctrl+Shift+I
		let inspectorLoaded = false;
		window.addEventListener('keydown', async (event) => {
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
		});

		// Game client
		const gameClient = new GameClient(scene, localPlayerId, camera);
		gameClientRef.current = gameClient;
		gameClient.initLocalPlayer();

		// Input
		const input: InputState = {
			movementDirection: { x: 0, y: 0, z: 0 },
			isAttacking: false,
			isJumping: false,
			isSprinting: false,
		};
		const keysPressed = new Set<string>();

		scene.onKeyboardObservable.add((kbInfo) => {
			if (kbInfo.type === 1) keysPressed.add(kbInfo.event.key.toLowerCase());
			else if (kbInfo.type === 2) keysPressed.delete(kbInfo.event.key.toLowerCase());
		});

		// Precomputed isometric directions (camera rotated 45° around Y)
		// Key: bitmask WASD (W=8, A=4, S=2, D=1), Value: [worldX, worldZ] normalized
		const S = 0.7071;
		const isoDir: Record<number, [number, number]> = {
			0:  [0, 0],           // no input
			8:  [-S, S],          // W
			2:  [S, -S],          // S
			4:  [-S, -S],         // A
			1:  [S, S],           // D
			9:  [0, 1],           // W+D
			12: [-1, 0],          // W+A
			3:  [1, 0],           // S+D
			6:  [0, -1],          // S+A
			10: [0, 0],           // W+S (cancel)
			5:  [0, 0],           // A+D (cancel)
			15: [0, 0],           // all (cancel)
			14: [-S, -S],         // W+A+S
			13: [-S, S],          // W+A+D
			11: [S, S],           // W+S+D
			7:  [S, -S],          // A+S+D
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
			input.isAttacking = keysPressed.has('e');
			input.isSprinting = keysPressed.has('shift'); // Hold Shift to sprint

			// Update animations based on input
			gameClient.updateLocalAnimation(input);
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
				now - lastFrameTime > TARGET_FRAME_MS * 2 ? now : lastFrameTime + TARGET_FRAME_MS;

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

		window.addEventListener('resize', () => {
			engine.resize();
			const a = engine.getRenderWidth() / engine.getRenderHeight();
			camera.orthoLeft = -ISO_ORTHO_SIZE * a;
			camera.orthoRight = ISO_ORTHO_SIZE * a;
			camera.orthoTop = ISO_ORTHO_SIZE;
			camera.orthoBottom = -ISO_ORTHO_SIZE;
		});

		return () => {
			window.removeEventListener('focus', onFocus);
			engine.stopRenderLoop();
			scene.dispose();
			engine.dispose();
		};
	}, [localPlayerId]); // eslint-disable-line react-hooks/exhaustive-deps

	return <canvas ref={canvasRef} style={{ width: '100%', height: '100vh', display: 'block' }} />;
}
