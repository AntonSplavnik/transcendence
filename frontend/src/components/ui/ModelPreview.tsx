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

		if (characterConfig) {
			// Full character preview: weapons + idle animation.
			// Only load the first animation set (General) — it contains the idle animation.
			// Skipping MovementBasic + CombatMelee cuts GLB fetches from 3 to 1.
			const previewConfig = {
				...characterConfig,
				animationSets: [characterConfig.animationSets[0]],
			};
			const char = new AnimatedCharacter(scene);
			loadCharacter(char, previewConfig).then(() => {
				// Scale the root down for preview — in-game config.scale (3) is too large
				char.rootNode.scaling.setAll(0.6);
				char.playAnimation(characterConfig.idleAnimation.name, true, characterConfig.idleAnimation.speed ?? 1.0);

				if (rotationSpeed !== 0) {
					scene.onBeforeRenderObservable.add(() => {
						char.rootNode.rotation.y += rotationSpeed;
					});
				}
			});
		} else {
			// Simple static fallback
			SceneLoader.ImportMeshAsync('', '', modelUrl, scene).then((result) => {
				const root = new TransformNode('modelRoot', scene);
				result.meshes.forEach((mesh) => {
					if (!mesh.parent) mesh.parent = root;
				});
				root.scaling.setAll(1);

				if (rotationSpeed !== 0) {
					scene.onBeforeRenderObservable.add(() => {
						root.rotation.y += rotationSpeed;
					});
				}
			});
		}

		engine.runRenderLoop(() => scene.render());

		const handleResize = () => engine.resize();
		window.addEventListener('resize', handleResize);
		setTimeout(() => engine.resize(), 50);

		return () => {
			window.removeEventListener('resize', handleResize);
			engine.stopRenderLoop();
			scene.dispose();
			engine.dispose();
		};
	}, [modelUrl, characterConfig, bgColor, rotationSpeed]);

	return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
