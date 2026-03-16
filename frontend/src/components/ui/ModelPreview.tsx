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

export interface ModelPreviewProps {
	/** Directory containing the model file (must end with /). */
	modelDir: string;
	/** Filename of the .glb/.gltf model. */
	modelFile: string;
	/** Background colour as a hex string (e.g. "#582880"). Defaults to accent-purple. */
	bgColor?: string;
	/** Uniform scale applied to the loaded model. Defaults to 1.2. */
	scale?: number;
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
	modelDir,
	modelFile,
	bgColor = '#582880',
	scale = 0.6,
	rotationSpeed = 0.008,
}: ModelPreviewProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const engineRef = useRef<Engine | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
		engineRef.current = engine;
		const scene = new Scene(engine);

		scene.clearColor = hexToColor4(bgColor);

		const camera = new UniversalCamera('cam', new Vector3(0, 1.0, 2.5), scene);
		camera.setTarget(new Vector3(0, 0.7, 0));
		camera.minZ = 0.1;

		const light = new HemisphericLight('light', new Vector3(0.3, 1, 0.5), scene);
		light.intensity = 1.2;

		SceneLoader.ImportMeshAsync(null, modelDir, modelFile, scene).then((result) => {
			const root = new TransformNode('modelRoot', scene);
			result.meshes.forEach((mesh) => {
				if (!mesh.parent) mesh.parent = root;
			});
			root.scaling.setAll(scale);

			if (rotationSpeed !== 0) {
				scene.onBeforeRenderObservable.add(() => {
					root.rotation.y += rotationSpeed;
				});
			}
		});

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
	}, [modelDir, modelFile, bgColor, scale, rotationSpeed]);

	return (
		<canvas
			ref={canvasRef}
			style={{ width: '100%', height: '100%', display: 'block' }}
		/>
	);
}
