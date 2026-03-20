import { ArcRotateCamera, Engine, Scene, SceneSerializer } from '@babylonjs/core';
import { useEffect, useRef } from 'react';

import Tree1A from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_1_A_Color1.gltf';
import Tree2A from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_2_A_Color1.gltf';
import Tree3A from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_3_A_Color1.gltf';
import Tree4A from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_4_A_Color1.gltf';
import { measureModel } from '@/utils/measureModel';
import { arenaScene, CAM_ALPHA, CAM_BETA, CAM_RADIUS, CAM_TARGET } from './BabylonCanvas';

function serializeScene(scene: Scene) {
	const name = prompt('Save as:', 'forest');
	if (!name) return;
	const serialized = SceneSerializer.Serialize(scene);
	const json = JSON.stringify(serialized, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `${name}.babylon`;
	a.click();
	URL.revokeObjectURL(a.href);
}

export default function DevScene() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (!canvasRef.current) return;
		const engine = new Engine(canvasRef.current, true);
		const scene = new Scene(engine);

		const camera = new ArcRotateCamera('devCam', CAM_ALPHA, CAM_BETA, CAM_RADIUS, CAM_TARGET, scene);
		camera.attachControl(canvasRef.current, true);

		arenaScene(scene, camera);

		// Measure tree types at scale 1 — check console for sizes
		Promise.all([
			measureModel(Tree1A).then((d) => console.log(`Tree_1_A — h:${d.height.toFixed(2)} w:${d.width.toFixed(2)} d:${d.depth.toFixed(2)}`)),
			measureModel(Tree2A).then((d) => console.log(`Tree_2_A — h:${d.height.toFixed(2)} w:${d.width.toFixed(2)} d:${d.depth.toFixed(2)}`)),
			measureModel(Tree3A).then((d) => console.log(`Tree_3_A — h:${d.height.toFixed(2)} w:${d.width.toFixed(2)} d:${d.depth.toFixed(2)}`)),
			measureModel(Tree4A).then((d) => console.log(`Tree_4_A — h:${d.height.toFixed(2)} w:${d.width.toFixed(2)} d:${d.depth.toFixed(2)}`)),
		]);

		engine.runRenderLoop(() => scene.render());
		window.addEventListener('resize', () => engine.resize());

		// Enable Inspector with Ctrl+Shift+I
		let inspectorLoaded = false;
		const onKeyDown = async (event: KeyboardEvent) => {
			if (event.ctrlKey && event.shiftKey && (event.key === 'S' || event.key === 's')) {
				event.preventDefault();
				console.log('serialize triggered');
				serializeScene(scene);
			}
			if (event.ctrlKey && event.shiftKey && event.key === 'I') {
				event.preventDefault();
				if (!inspectorLoaded) {
					await import('@babylonjs/inspector');
					inspectorLoaded = true;
				}
				if (scene.debugLayer.isVisible()) {
					scene.debugLayer.hide();
				} else {
					await scene.debugLayer.show({ embedMode: false, overlay: true, globalRoot: document.body });
				}
			}
		};
		window.addEventListener('keydown', onKeyDown);

		return () => {
			window.removeEventListener('keydown', onKeyDown);
			engine.stopRenderLoop();
			scene.dispose();
			engine.dispose();
		};
	}, []);

	return <canvas ref={canvasRef} style={{ width: '100%', height: '100vh', display: 'block' }} />;
}
