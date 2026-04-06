import { useEffect, useRef } from 'react';
import {
	Color4,
	Engine,
	HemisphericLight,
	Scene,
	SceneLoader,
	TransformNode,
	UniversalCamera,
	Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { CharacterConfig } from '@/game/characterConfigs';
import { AnimatedCharacter, loadCharacter } from '@/game/AnimatedCharacter';

export interface ModelPreviewProps {
	/** Vite-imported model URL. */
	modelUrl: string;
	/** When provided, loads the full character with equipment and plays idle animation. */
	characterConfig?: CharacterConfig;
	/** Background colour as a hex string (e.g. "#582880"). */
	bgColor?: string;
	/** Rotation speed in radians per frame. 0 to disable. Defaults to 0.008. */
	rotationSpeed?: number;
	/**
	 * When true, the user can drag horizontally on the canvas to rotate the model.
	 * Auto-rotation pauses while dragging and resumes 1.5s after the drag ends.
	 */
	draggable?: boolean;
}

function hexToColor4(hex: string): Color4 {
	const h = hex.replace('#', '');
	const r = parseInt(h.slice(0, 2), 16) / 255;
	const g = parseInt(h.slice(2, 4), 16) / 255;
	const b = parseInt(h.slice(4, 6), 16) / 255;
	return new Color4(r, g, b, 1);
}

export default function ModelPreview({
	modelUrl,
	characterConfig,
	bgColor = '#582880',
	rotationSpeed = 0.008,
	draggable = false,
}: ModelPreviewProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
		const scene = new Scene(engine);

		scene.clearColor = hexToColor4(bgColor);

		const camera = new UniversalCamera('cam', new Vector3(0, 1.0, 2.5), scene);
		camera.setTarget(new Vector3(0, 0.7, 0));
		camera.minZ = 0.1;

		const light = new HemisphericLight('light', new Vector3(0.3, 1, 0.5), scene);
		light.intensity = 1.2;

		// Shared mutable state for drag + auto-rotation
		let rootNode: TransformNode | null = null;
		let autoRotating = true;
		let resumeTimer: ReturnType<typeof setTimeout> | null = null;

		const onBeforeRender = () => {
			if (autoRotating && rootNode && rotationSpeed !== 0) {
				rootNode.rotation.y += rotationSpeed;
			}
		};
		scene.onBeforeRenderObservable.add(onBeforeRender);

		if (characterConfig) {
			const previewConfig = {
				...characterConfig,
				animationSets: [characterConfig.animationSets[0]],
			};
			const char = new AnimatedCharacter(scene);
			loadCharacter(char, previewConfig).then(() => {
				char.rootNode.scaling.setAll(0.6);
				char.playAnimation(characterConfig.idleAnimation, true);
				rootNode = char.rootNode;
			});
		} else {
			SceneLoader.ImportMeshAsync('', '', modelUrl, scene).then((result) => {
				const root = new TransformNode('modelRoot', scene);
				result.meshes.forEach((mesh) => {
					if (!mesh.parent) mesh.parent = root;
				});
				rootNode = root;
			});
		}

		engine.runRenderLoop(() => scene.render());

		// ── Drag-to-rotate ────────────────────────────────────────────────────
		let isDragging = false;
		let lastX = 0;
		const SENSITIVITY = 0.01;

		const onPointerDown = (e: PointerEvent) => {
			isDragging = true;
			lastX = e.clientX;
			canvas.setPointerCapture(e.pointerId);
			if (resumeTimer !== null) {
				clearTimeout(resumeTimer);
				resumeTimer = null;
			}
			autoRotating = false;
		};

		const onPointerMove = (e: PointerEvent) => {
			if (!isDragging || !rootNode) return;
			const delta = e.clientX - lastX;
			lastX = e.clientX;
			rootNode.rotation.y += delta * SENSITIVITY;
		};

		const stopDrag = () => {
			if (!isDragging) return;
			isDragging = false;
			resumeTimer = setTimeout(() => {
				autoRotating = true;
				resumeTimer = null;
			}, 1500);
		};

		if (draggable) {
			canvas.addEventListener('pointerdown', onPointerDown);
			canvas.addEventListener('pointermove', onPointerMove);
			canvas.addEventListener('pointerup', stopDrag);
			canvas.addEventListener('pointerleave', stopDrag);
		}

		const handleResize = () => engine.resize();
		window.addEventListener('resize', handleResize);
		setTimeout(() => engine.resize(), 50);

		return () => {
			if (resumeTimer !== null) clearTimeout(resumeTimer);
			window.removeEventListener('resize', handleResize);
			if (draggable) {
				canvas.removeEventListener('pointerdown', onPointerDown);
				canvas.removeEventListener('pointermove', onPointerMove);
				canvas.removeEventListener('pointerup', stopDrag);
				canvas.removeEventListener('pointerleave', stopDrag);
			}
			engine.stopRenderLoop();
			scene.dispose();
			engine.dispose();
		};
	}, [modelUrl, characterConfig, bgColor, rotationSpeed, draggable]);

	return (
		<canvas
			ref={canvasRef}
			style={{
				width: '100%',
				height: '100%',
				display: 'block',
				cursor: draggable ? 'grab' : 'default',
			}}
		/>
	);
}
