import { useEffect, useRef } from "react";
import {
	Engine,
	Scene,
	ArcRotateCamera,
	HemisphericLight,
	Vector3,
	SceneLoader,
	Color4
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

export default function LandingScene() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const backgroundRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!canvasRef.current) return;

		const engine = new Engine(canvasRef.current, true);
		const scene = new Scene(engine);
		scene.clearColor = new Color4(0, 0, 0, 0);

		// Camera
		const camera = new ArcRotateCamera(
			"camera",
			-Math.PI / 2,
			Math.PI / 2.5,
			10,
			Vector3.Zero(),
			scene
		);
		camera.attachControl(canvasRef.current, false);
		camera.lowerRadiusLimit = 8;
		camera.upperRadiusLimit = 12;

		// Light
		const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
		light.intensity = 0.8;

		// Load models
		(async () => {
			try {
				const [treeResult, rockResult] = await Promise.all([
					SceneLoader.ImportMeshAsync(null, "/models/ForestKaykit/", "Tree_1_A_Color1.gltf", scene),
					SceneLoader.ImportMeshAsync(null, "/models/ForestKaykit/", "Rock_1_A_Color1.gltf", scene)
				]);

				treeResult.meshes.forEach(mesh => {
					mesh.position.x = -3;
				});

				rockResult.meshes.forEach(mesh => {
					mesh.position.x = 3;
				});
			} catch (error) {
				console.error("Failed to load models:", error);
			}
		})();

		// Mouse parallax - affects BOTH background and 3D models
		let targetAlpha = camera.alpha;
		let targetBeta = camera.beta;
		let mouseX = 0;
		let mouseY = 0;

		const handleMouseMove = (e: MouseEvent) => {
			mouseX = (e.clientX / window.innerWidth) * 2 - 1;
			mouseY = -(e.clientY / window.innerHeight) * 2 + 1;

			// 3D camera movement (foreground - moves more)
			targetAlpha = mouseX * 0.2;
			targetBeta = mouseY * 0.1 + Math.PI / 2.5;

			// Background movement (moves less - creates depth)
			if (backgroundRef.current) {
				const bgMoveX = mouseX * 20; // 20px max movement
				const bgMoveY = mouseY * 20;
				backgroundRef.current.style.transform =
					`translate(${bgMoveX}px, ${bgMoveY}px) scale(1.1)`;
			}
		};

		window.addEventListener('mousemove', handleMouseMove);

		// Render loop
		engine.runRenderLoop(() => {
			camera.alpha += (targetAlpha - camera.alpha) * 0.05;
			camera.beta += (targetBeta - camera.beta) * 0.05;
			scene.render();
		});

		// Resize
		const handleResize = () => engine.resize();
		window.addEventListener('resize', handleResize);

		// Cleanup
		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('resize', handleResize);
			engine.dispose();
		};
	}, []);

	return (
		<>
			{/* BACKGROUND LAYER */}
			<div
				ref={backgroundRef}
				style={{
					position: 'absolute',
					top: '-2%',
					left: '-2%',
					width: '105%',
					height: '105%',
					backgroundImage: 'url(/images/mountains_forest_river_hut.jpg)',
					backgroundSize: 'cover',
					backgroundPosition: 'center',
					transition: 'transform 0.1s ease-out',
					zIndex: 0,
					pointerEvents: 'none'
				}}
			/>

			{/* FOREGROUND LAYER - 3D Canvas with models */}
			<canvas
				ref={canvasRef}
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					width: '100%',
					height: '100%',
					pointerEvents: 'none',
					zIndex: 1  // In front of background
				}}
			/>
		</>
	);
}
