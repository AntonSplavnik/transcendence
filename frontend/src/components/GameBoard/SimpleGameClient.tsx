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
import * as CANNON from 'cannon-es'; // Required for physics
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import type { GameStateSnapshot, Vector3D } from '../../game/types';
import { measureModel } from '../../utils/measureModel';

// Make BABYLON available globally for Inspector (must be extensible object)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).BABYLON = Object.assign({}, BabylonModule);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).CANNON = CANNON;

// Import game assets
import combatMeleeAnims from '@/assets/Rig_Medium/Rig_Medium_CombatMelee.glb';
import generalModel from '@/assets/Rig_Medium/Rig_Medium_General.glb';
import movementBasicAnims from '@/assets/Rig_Medium/Rig_Medium_MovementBasic.glb';

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

const AnimationNames = {
	idle: 'Idle_A',
	walk: 'Walking_B',
	run: 'Running_B',
	jumpStart: 'Jump_Start',
	jumpIdle: 'Jump_Idle',
	jumpLand: 'Jump_Land',
	attack: 'Melee_2H_Attack_Spinning',
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
		if (!anim) return;
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
	// Track jump state for remote players
	private remoteJumpStates: Map<number, JumpState> = new Map();
	private remoteWasGrounded: Map<number, boolean> = new Map();

	constructor(scene: Scene, localPlayerID: number, camera: UniversalCamera) {
		this.scene = scene;
		this.localPlayerID = localPlayerID;
		this.camera = camera;
	}

	async initLocalPlayer(): Promise<void> {
		this.localCharacter = new AnimatedCharacter(this.scene);
		await this.localCharacter.loadModel(generalModel);
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
	applyInput(input: InputState, deltaTime: number) {
		const moveSpeed = 5.0;

		if (input.movementDirection.x !== 0 || input.movementDirection.z !== 0) {
			const cameraForward = this.camera.getTarget().subtract(this.camera.position);
			cameraForward.y = 0;
			cameraForward.normalize();
			const cameraRight = Vector3.Cross(Vector3.Up(), cameraForward).normalize();
			const worldMoveDir = cameraForward
				.scale(input.movementDirection.z)
				.add(cameraRight.scale(input.movementDirection.x));

			if (worldMoveDir.length() > 0) {
				worldMoveDir.normalize();
				this.velocity.x = worldMoveDir.x * moveSpeed;
				this.velocity.z = worldMoveDir.z * moveSpeed;
			}
		} else {
			this.velocity.x = 0;
			this.velocity.z = 0;
		}

		if (input.isJumping && this.position.y <= 1.1) {
			this.velocity.y = 8.0;
		}

		if (this.position.y > 1.0) {
			this.velocity.y -= 20.0 * deltaTime;
		} else {
			this.position.y = 1.0;
			this.velocity.y = 0;
		}

		this.position.addInPlace(this.velocity.scale(deltaTime));
		this.position.x = Math.max(-49, Math.min(49, this.position.x));
		this.position.z = Math.max(-49, Math.min(49, this.position.z));

		if (this.localCharacter) this.localCharacter.setPosition(this.position);
		this.updateAnimation(input);

		const cameraOffset = new Vector3(30, 60, -30);
		this.camera.position = this.position.add(cameraOffset);
		this.camera.setTarget(this.position);
	}

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

				// Update camera to follow player (adjusted for scaled characters)
				const cameraOffset = new Vector3(30, 40, -30);
				this.camera.position = this.position.add(cameraOffset);
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
			this.remoteWasGrounded.delete(playerID);
		}
	}

	private async createRemoteCharacter(
		playerID: number,
		charData: CharacterSnapshot,
	): Promise<void> {
		this.loadingCharacters.add(playerID);
		const remoteChar = new AnimatedCharacter(this.scene);
		try {
			await remoteChar.loadModel(generalModel);
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
			this.remoteWasGrounded.set(playerID, true);
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
		const position = new Vector3(charData.position.x, charData.position.y, charData.position.z);
		const velocity = charData.velocity;
		const state = charData.state;

		// Get or initialize jump state for this player
		let jumpState = this.remoteJumpStates.get(playerID) || JumpState.GROUNDED;

		// Check if character is grounded based on Y position
		const isGrounded = position.y <= 1.1;
		const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

		// ===== JUMP STATE MACHINE (same logic as local player) =====

		// TRANSITION: GROUNDED → AIRBORNE (became airborne)
		if (jumpState === JumpState.GROUNDED && !isGrounded) {
			// We can't distinguish between jump and fall for remote players, so just go to airborne
			jumpState = JumpState.AIRBORNE;
			character.playAnimation(AnimationNames.jumpIdle, true);
			this.remoteWasGrounded.set(playerID, false);
			this.remoteJumpStates.set(playerID, jumpState);
			return;
		}

		// STATE: AIRBORNE (ensure jump idle is playing)
		if (jumpState === JumpState.AIRBORNE && !isGrounded) {
			character.playAnimation(AnimationNames.jumpIdle, true);
			return;
		}

		// TRANSITION: AIRBORNE → LANDING (touched ground)
		if (jumpState === JumpState.AIRBORNE && isGrounded) {
			jumpState = JumpState.LANDING;
			character.playAnimation(AnimationNames.jumpLand, false);
			this.remoteWasGrounded.set(playerID, true);
			this.remoteJumpStates.set(playerID, jumpState);
			return;
		}

		// TRANSITION: LANDING → GROUNDED (landing animation finished)
		if (jumpState === JumpState.LANDING) {
			const landAnim = character.animations.get(AnimationNames.jumpLand);
			if (landAnim && !landAnim.isPlaying) {
				jumpState = JumpState.GROUNDED;
				this.remoteJumpStates.set(playerID, jumpState);
				// Fall through to ground animations
			} else {
				return; // Still playing landing animation
			}
		}

		// ===== GROUNDED ANIMATIONS =====
		if (jumpState === JumpState.GROUNDED) {
			switch (state) {
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
					// Use run animation if speed > 10 (sprinting), walk otherwise
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
	}

	// Jump animation state machine
	updateLocalAnimation(input: InputState): void {
		if (!this.localCharacter) return;

		// Check ground state based on Y position (server authoritative)
		const isGrounded = this.position.y <= 1.1;
		const isMoving = input.movementDirection.x !== 0 || input.movementDirection.z !== 0;

		// ===== STATE MACHINE =====

		// TRANSITION: GROUNDED → JUMP_START (initiated jump)
		if (this.jumpState === JumpState.GROUNDED && !isGrounded && input.isJumping) {
			this.jumpState = JumpState.JUMP_START;
			this.playAnimation('jumpStart', false);
			return;
		}

		// TRANSITION: GROUNDED → AIRBORNE (fell off edge)
		if (this.jumpState === JumpState.GROUNDED && !isGrounded && !input.isJumping) {
			this.jumpState = JumpState.AIRBORNE;
			this.playAnimation('jumpIdle', true);
			return;
		}

		// TRANSITION: JUMP_START → AIRBORNE (start animation finished)
		if (this.jumpState === JumpState.JUMP_START) {
			const jumpStartAnim = this.localCharacter.animations.get(AnimationNames.jumpStart);
			if (jumpStartAnim && !jumpStartAnim.isPlaying) {
				this.jumpState = JumpState.AIRBORNE;
				this.playAnimation('jumpIdle', true);
			}
			return; // Stay in jump sequence
		}

		// STATE: AIRBORNE (ensure jump idle is playing)
		if (this.jumpState === JumpState.AIRBORNE && !isGrounded) {
			this.playAnimation('jumpIdle', true);
			return;
		}

		// TRANSITION: AIRBORNE → LANDING (touched ground)
		if (this.jumpState === JumpState.AIRBORNE && isGrounded) {
			this.jumpState = JumpState.LANDING;
			this.playAnimation('jumpLand', false);
			return;
		}

		// TRANSITION: LANDING → GROUNDED (landing animation finished)
		if (this.jumpState === JumpState.LANDING) {
			const landAnim = this.localCharacter.animations.get(AnimationNames.jumpLand);
			if (landAnim && !landAnim.isPlaying) {
				this.jumpState = JumpState.GROUNDED;
				// Fall through to ground animations
			} else {
				return; // Still playing landing animation
			}
		}

		// ===== GROUNDED ANIMATIONS =====
		if (this.jumpState === JumpState.GROUNDED) {
			if (input.isAttacking) {
				this.playAnimation('attack', true);
				return;
			}

			if (isMoving) {
				this.playAnimation(input.isSprinting ? 'run' : 'walk');
			} else {
				this.playAnimation('idle');
			}
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

		// Setup camera - FIXED: Look at arena center (50, 0, 50)
		// Adjusted closer for better view of scaled-up characters
		const camera = new UniversalCamera('camera', new Vector3(80, 60, 20), scene);
		camera.setTarget(new Vector3(50, 0, 50));
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

		// Enable Inspector with Ctrl+Shift+I (lazy-loaded from npm package)
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

		scene.onBeforeRenderObservable.add(() => {
			input.movementDirection.x = 0;
			input.movementDirection.z = 0;
			if (keysPressed.has('w')) input.movementDirection.z = 1;
			if (keysPressed.has('s')) input.movementDirection.z = -1;
			if (keysPressed.has('a')) input.movementDirection.x = -1;
			if (keysPressed.has('d')) input.movementDirection.x = 1;
			input.isJumping = keysPressed.has(' ');
			input.isAttacking = keysPressed.has('e');
			input.isSprinting = keysPressed.has('shift'); // Hold Shift to sprint

			// Update animations based on input
			gameClient.updateLocalAnimation(input);
		});

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
			const lookDir =
				input.movementDirection.x !== 0 || input.movementDirection.z !== 0
					? input.movementDirection
					: { x: 0, y: 0, z: 1 };
			onSendInput(
				input.movementDirection,
				lookDir,
				input.isAttacking,
				input.isJumping,
				input.isSprinting,
			);

			scene.render();
		});

		window.addEventListener('resize', () => engine.resize());

		return () => {
			engine.stopRenderLoop();
			scene.dispose();
			engine.dispose();
		};
	}, [localPlayerId]); // eslint-disable-line react-hooks/exhaustive-deps

	return <canvas ref={canvasRef} style={{ width: '100%', height: '100vh', display: 'block' }} />;
}
