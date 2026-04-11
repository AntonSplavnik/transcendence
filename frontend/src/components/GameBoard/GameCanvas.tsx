import type { Engine, Scene, UniversalCamera } from '@babylonjs/core';
import type * as BabylonType from '@babylonjs/core';
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import type { GameEvent, GameStateSnapshot, Vector3D } from '../../game/types';
import type { CharacterConfig } from '@/game/characterConfigs';
import { CHARACTER_CONFIGS, DEFAULT_CHARACTER } from '@/game/characterConfigs';
import { ISO_CAM_OFFSET, ISO_ORTHO_SIZE, ISO_DIRECTIONS } from '@/game/constants';
import type { InputState } from '@/game/constants';
import { GameClient } from '@/game/GameClient';
import type { GameAudioHandle } from '@/audio/AudioProvider';

declare const BABYLON: typeof BabylonType;
declare const TOOLKIT: { SceneManager: { InitializeRuntime(engine: Engine): Promise<void> } };

// ── Scene setup ─────────────────────────────────────────────────────

async function createArenaScene(canvas: HTMLCanvasElement): Promise<{
	engine: Engine;
	scene: Scene;
	camera: UniversalCamera;
	sceneLoaded: Promise<void>;
}> {
	const engine = new BABYLON.Engine(canvas, true);
	await TOOLKIT.SceneManager.InitializeRuntime(engine);

	const scene = new BABYLON.Scene(engine);

	// Isometric camera: 35.264deg elevation, 45deg rotation, orthographic
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
		scene.activeCamera = camera;
	});

	// Manage loading screen manually — prevent SceneLoader from auto-hiding it
	BABYLON.SceneLoader.ShowLoadingScreen = false;

	// Load the forest scene (wrapped in a promise so callers can await completion)
	const sceneLoaded = new Promise<void>((resolve, reject) => {
		BABYLON.SceneLoader.Append(
			'/scenes/Export/scenes/',
			'Forest.gltf',
			scene,
			() => {
				scene.activeCamera = camera;

				// Extended ground plane to hide backdrop past terrain edges
				const bgGround = BABYLON.MeshBuilder.CreateGround(
					'bg-ground',
					{ width: 1000, height: 1000 },
					scene,
				);
				bgGround.position.y = -0.01;
				const bgMat = new BABYLON.StandardMaterial('bg-ground-mat', scene);
				bgMat.diffuseColor = new BABYLON.Color3(0.15, 0.35, 0.1);
				bgMat.specularColor = BABYLON.Color3.Black();
				bgGround.material = bgMat;

				// Arena boundary walls
				const TERRAIN_EDGE = 25.0;
				const WALL_H = 1.2;
				const WALL_T = 0.8;
				const WALL_POS = TERRAIN_EDGE + WALL_T / 2;
				const WALL_SPAN = TERRAIN_EDGE * 2 + WALL_T * 2;
				const wallMat = new BABYLON.StandardMaterial('wall-mat', scene);
				wallMat.diffuseColor = new BABYLON.Color3(0.35, 0.25, 0.15);
				wallMat.specularColor = BABYLON.Color3.Black();

				const wallDefs = [
					['wall-n', WALL_SPAN, WALL_H, WALL_T, 0, WALL_H / 2, WALL_POS],
					['wall-s', WALL_SPAN, WALL_H, WALL_T, 0, WALL_H / 2, -WALL_POS],
					['wall-e', WALL_T, WALL_H, WALL_SPAN, WALL_POS, WALL_H / 2, 0],
					['wall-w', WALL_T, WALL_H, WALL_SPAN, -WALL_POS, WALL_H / 2, 0],
				] as const;

				for (const [name, w, h, d, x, y, z] of wallDefs) {
					const wall = BABYLON.MeshBuilder.CreateBox(
						name,
						{ width: w, height: h, depth: d },
						scene,
					);
					wall.position.set(x, y, z);
					wall.material = wallMat;
				}

				resolve();
			},
			undefined,
			(_s, message, exception) => {
				console.error('Failed to load Forest scene:', message, exception);
				reject(new Error(String(message)));
			},
		);
	});

	return { engine, scene, camera, sceneLoaded };
}

// ── Input setup ─────────────────────────────────────────────────────

function setupInput(scene: Scene): { input: InputState; cleanup: () => void } {
	const input: InputState = {
		movementDirection: { x: 0, y: 0, z: 0 },
		isAttacking: false,
		isJumping: false,
		isSprinting: false,
		isGrounded: false,
		isUsingAbility1: false,
		isUsingAbility2: false,
	};
	const keysPressed = new Set<string>();

	scene.onKeyboardObservable.add((kbInfo) => {
		if (kbInfo.type === 1) {
			keysPressed.add(kbInfo.event.key.toLowerCase());
			if (kbInfo.event.key.toLowerCase() === 'e' && !(kbInfo.event as KeyboardEvent).repeat)
				input.isAttacking = true;
			if (kbInfo.event.key.toLowerCase() === 'q' && !(kbInfo.event as KeyboardEvent).repeat)
				input.isUsingAbility1 = true;
			if (kbInfo.event.key.toLowerCase() === 'f' && !(kbInfo.event as KeyboardEvent).repeat)
				input.isUsingAbility2 = true;
		} else if (kbInfo.type === 2) {
			keysPressed.delete(kbInfo.event.key.toLowerCase());
		}
	});

	scene.onBeforeRenderObservable.add(() => {
		const bits =
			(keysPressed.has('w') ? 8 : 0) |
			(keysPressed.has('a') ? 4 : 0) |
			(keysPressed.has('s') ? 2 : 0) |
			(keysPressed.has('d') ? 1 : 0);
		const dir = ISO_DIRECTIONS[bits] || [0, 0];
		input.movementDirection.x = dir[0];
		input.movementDirection.z = dir[1];
		input.isJumping = keysPressed.has(' ');
		input.isSprinting = keysPressed.has('shift');
	});

	return { input, cleanup: () => {} };
}

// ── Inspector toggle ────────────────────────────────────────────────

function setupInspector(scene: Scene): (event: KeyboardEvent) => void {
	let inspectorLoaded = false;
	return async (event: KeyboardEvent) => {
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
}

// ── React component ─────────────────────────────────────────────────

interface Props {
	snapshotRef: RefObject<GameStateSnapshot | null>;
	characterClassesRef: RefObject<Map<number, string>>;
	eventsRef: RefObject<GameEvent[]>;
	onSendInput: (
		movement: Vector3D,
		lookDirection: Vector3D,
		attacking: boolean,
		jumping: boolean,
		sprinting: boolean,
		ability1: boolean,
		ability2: boolean,
	) => void;
	localPlayerId: number;
	characterConfig?: CharacterConfig;
	gameAudio?: GameAudioHandle;
}

export default function GameCanvas({
	snapshotRef,
	characterClassesRef,
	eventsRef,
	onSendInput,
	localPlayerId,
	characterConfig = CHARACTER_CONFIGS[DEFAULT_CHARACTER],
	gameAudio,
}: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (!canvasRef.current || !localPlayerId) return;

		const canvas = canvasRef.current;
		let disposed = false;
		let sceneInstance: Scene | null = null;
		let engineInstance: Engine | null = null;
		let gameClientInstance: GameClient | null = null;

		canvas.focus();
		canvas.tabIndex = 1;
		const onFocus = () => canvas.focus();
		window.addEventListener('focus', onFocus);
		let onKeydown: ((event: KeyboardEvent) => void) | null = null;
		let onResize: (() => void) | null = null;

		(async () => {
			const { engine, scene, camera, sceneLoaded } = await createArenaScene(canvas);
			if (disposed) {
				engine.dispose();
				return;
			}
			engineInstance = engine;
			sceneInstance = scene;

			// Keep loading screen visible while map + character assets load
			engine.displayLoadingUI();

			// Inspector toggle
			onKeydown = setupInspector(scene);
			window.addEventListener('keydown', onKeydown);

			// Game client
			const gameClient = new GameClient(
				scene,
				localPlayerId,
				camera,
				characterConfig,
				characterClassesRef,
				gameAudio?.engine,
				gameAudio?.soundBank,
			);
			gameClientInstance = gameClient;

			// Start loading character (awaited below together with scene)
			const playerReady = gameClient
				.initLocalPlayer()
				.catch((e) => console.error('[GameClient] Failed to load local player:', e));

			// Input
			const { input } = setupInput(scene);

			// Pre-render: update local animation then clear one-shot triggers
			scene.onBeforeRenderObservable.add(() => {
				gameClient.updateLocalAnimation(input);
				input.isAttacking = false;
				input.isUsingAbility1 = false;
				input.isUsingAbility2 = false;
			});

			// Track last look direction
			const lastLookDir = { x: 0, y: 0, z: 1 };

			// Render loop — 60 fps cap
			const TARGET_FRAME_MS = 1000 / 60;
			let lastFrameTime = 0;

			engine.runRenderLoop(() => {
				const now = performance.now();
				if (now - lastFrameTime < TARGET_FRAME_MS - 0.5) return;
				lastFrameTime =
					now - lastFrameTime > TARGET_FRAME_MS * 2
						? now
						: lastFrameTime + TARGET_FRAME_MS;

				// Events first, then snapshot
				const events = eventsRef.current.splice(0);
				if (events.length > 0) gameClient.processEvents(events);

				const snap = snapshotRef.current;
				if (snap !== null) {
					gameClient.processSnapshot(snap);
					snapshotRef.current = null;
				}

				// Send input
				if (input.movementDirection.x !== 0 || input.movementDirection.z !== 0) {
					lastLookDir.x = input.movementDirection.x;
					lastLookDir.z = input.movementDirection.z;
				}
				onSendInput(
					input.movementDirection,
					lastLookDir,
					input.isAttacking,
					input.isJumping,
					input.isSprinting,
					input.isUsingAbility1,
					input.isUsingAbility2,
				);

				scene.render();
			});

			// Wait for map, character, and all textures before revealing the scene
			await Promise.all([sceneLoaded.catch(() => {}), playerReady]);
			await scene.whenReadyAsync();

			// Render a few warm-up frames behind the loading screen to compile shaders
			await new Promise<void>((resolve) => {
				let frames = 0;
				const obs = scene.onAfterRenderObservable.add(() => {
					if (++frames >= 3) {
						scene.onAfterRenderObservable.remove(obs);
						resolve();
					}
				});
			});

			if (!disposed) {
				engine.hideLoadingUI();
				gameClient.playSpawnAnimation();
				gameAudio?.playSceneAmbient('amb_forest');
				gameAudio?.playMusicPlaylist();
			}

			// Resize handler
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
			gameAudio?.stopSceneAmbient();
			gameAudio?.stopMusicPlaylist();
			window.removeEventListener('focus', onFocus);
			if (onKeydown) window.removeEventListener('keydown', onKeydown);
			if (onResize) window.removeEventListener('resize', onResize);
			gameClientInstance?.dispose();
			engineInstance?.stopRenderLoop();
			sceneInstance?.dispose();
			engineInstance?.dispose();
		};
	}, [localPlayerId]); // eslint-disable-line react-hooks/exhaustive-deps

	return <canvas ref={canvasRef} style={{ width: '100%', height: '100vh', display: 'block' }} />;
}
