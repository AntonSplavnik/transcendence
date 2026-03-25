import {
	ArcRotateCamera,
	DefaultRenderingPipeline,
	CreateCylinder,
	CreateGround,
	DirectionalLight,
	HemisphericLight,
	ImportMeshAsync,
	Scene,
	ShadowGenerator,
	StandardMaterial,
	Color3,
	Vector3,
} from '@babylonjs/core';
import barbarian from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Barbarian.glb';
import Tree1A from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_1_A_Color1.gltf';
import Tree1B from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_1_B_Color1.gltf';
import Tree1C from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_1_C_Color1.gltf';
import Tree2A from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_2_A_Color1.gltf';
import Tree2B from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_2_B_Color1.gltf';
import Tree3A from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_3_A_Color1.gltf';
import Tree3B from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_3_B_Color1.gltf';
import Tree4A from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Tree_4_A_Color1.gltf';
import Rock1 from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Rock_1_A_Color1.gltf';
import Rock2 from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Rock_2_A_Color1.gltf';
import Rock3 from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Rock_3_A_Color1.gltf';
import Bush1 from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Bush_1_A_Color1.gltf';
import Bush2 from '@/assets/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf/Bush_2_A_Color1.gltf';

// Isometric camera constants — shared with DevScene so dev view matches the game
export const CAM_ALPHA = -Math.PI / 4;
export const CAM_BETA = Math.PI / 3.5;
export const CAM_RADIUS = 50;
export const CAM_TARGET = new Vector3(0, 2, 0);

const ARENA_Y = 0.5;
const CLEAR_RADIUS = 12;
// Front arc: ±60° around camera direction — tall trees here block the arena view
const FRONT_ARC_HALF = Math.PI / 3;

function mkRng(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 0x100000000;
	};
}

function ring(radius: number, count: number, offsetAngle = 0) {
	return Array.from({ length: count }, (_, i) => {
		const angle = (i / count) * Math.PI * 2 + offsetAngle;
		return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle };
	});
}

// True if angle falls in the camera-facing zone (would block the arena view)
function inFrontArc(angle: number): boolean {
	const diff = ((angle - CAM_ALPHA + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
	return Math.abs(diff) < FRONT_ARC_HALF;
}

function spawn(
	model: string,
	scene: Scene,
	shadows: ShadowGenerator,
	x: number,
	z: number,
	scale: number,
	rng: () => number,
) {
	ImportMeshAsync(model, scene).then(({ meshes }) => {
		meshes[0].position.set(x, ARENA_Y, z);
		meshes[0].rotation.y = rng() * Math.PI * 2;
		meshes[0].scaling.setAll(scale);
		meshes.forEach((m) => shadows.addShadowCaster(m));
	});
}

export function arenaScene(scene: Scene, _camera: ArcRotateCamera) {
	const sun = new DirectionalLight('sun', new Vector3(-2, -1, 2.5), scene);
	sun.intensity = 2;
	const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
	hemi.intensity = 0.7;

	// Forest floor
	const floor = CreateGround('floor', { width: 80, height: 80, subdivisions: 1 }, scene);
	floor.position.y = ARENA_Y;
	const floorMat = new StandardMaterial('floorMat', scene);
	floorMat.diffuseColor = new Color3(0.25, 0.35, 0.15);
	floor.material = floorMat;
	floor.receiveShadows = true;

	// Circular clearing
	const clearing = CreateCylinder(
		'clearing',
		{ diameter: CLEAR_RADIUS * 2, height: 0.02, tessellation: 48 },
		scene,
	);
	clearing.position.y = ARENA_Y + 0.01;
	const clearingMat = new StandardMaterial('clearingMat', scene);
	clearingMat.diffuseColor = new Color3(0.6, 0.5, 0.4);
	clearing.material = clearingMat;
	clearing.receiveShadows = true;

	const shadows = new ShadowGenerator(1024, sun);
	shadows.useBlurExponentialShadowMap = true;

	// Post-processing (uncomment to enable)
	const pipeline = new DefaultRenderingPipeline('pipeline', true, scene, [_camera]);
	pipeline.samples = 4; // MSAA 4x — re-enables AA lost when pipeline renders to texture
	pipeline.fxaaEnabled = true; // FXAA on top for extra edge smoothness
	pipeline.bloomEnabled = true;
	pipeline.bloomThreshold = 0.1;
	pipeline.bloomKernel = 64;
	pipeline.bloomScale = 1.0;
	pipeline.bloomWeight = 0.4;
	// pipeline.grainEnabled = true; pipeline.grain.intensity = 4; pipeline.grain.animated = true;
	// pipeline.chromaticAberrationEnabled = true; pipeline.chromaticAberration.aberrationAmount = 65.1; pipeline.chromaticAberration.radialIntensity = 2;
	// pipeline.sharpenEnabled = true; pipeline.sharpen.edgeAmount = 0.15;

	// Measured heights at scale 1: Tree1=4.16, Tree2=4.67, Tree3=3.51, Tree4=5.27
	// Base scales normalize each type to ~10 units tall
	const trees: Array<{ model: string; baseScale: number }> = [
		{ model: Tree1A, baseScale: 2.4 },
		{ model: Tree1B, baseScale: 2.4 },
		{ model: Tree1C, baseScale: 2.4 },
		{ model: Tree2A, baseScale: 2.1 },
		{ model: Tree2B, baseScale: 2.1 },
		{ model: Tree3A, baseScale: 2.85 },
		{ model: Tree3B, baseScale: 2.85 },
		{ model: Tree4A, baseScale: 1.9 },
	];
	const rocks = [Rock1, Rock2, Rock3];
	const bushes = [Bush1, Bush2];

	const rng = mkRng(42);

	// Barbarian — center reference (~1.75 units tall at scale 0.75)
	ImportMeshAsync(barbarian, scene).then(({ meshes }) => {
		meshes[0].position.set(0, ARENA_Y, 0);
		meshes[0].scaling.setAll(0.75);
		meshes.forEach((m) => shadows.addShadowCaster(m));
	});

	// Clearing edge — low bushes all around
	ring(CLEAR_RADIUS + 1.5, 10).forEach(({ x, z }) => {
		const jx = (rng() - 0.5) * 1.5;
		const jz = (rng() - 0.5) * 1.5;
		spawn(
			bushes[Math.floor(rng() * bushes.length)],
			scene,
			shadows,
			x + jx,
			z + jz,
			1.2 + rng() * 0.6,
			rng,
		);
	});

	const spawnTree = (x: number, z: number, variation = 0.5) => {
		const jx = (rng() - 0.5) * 1.5;
		const jz = (rng() - 0.5) * 1.5;
		const entry = trees[Math.floor(rng() * trees.length)];
		spawn(
			entry.model,
			scene,
			shadows,
			x + jx,
			z + jz,
			entry.baseScale * (0.75 + rng() * variation),
			rng,
		);
	};

	const spawnFiller = (x: number, z: number) => {
		const jx = (rng() - 0.5) * 1.5;
		const jz = (rng() - 0.5) * 1.5;
		const isRock = rng() > 0.4;
		const model = isRock
			? rocks[Math.floor(rng() * rocks.length)]
			: bushes[Math.floor(rng() * bushes.length)];
		spawn(
			model,
			scene,
			shadows,
			x + jx,
			z + jz,
			isRock ? 1.0 + rng() * 1.2 : 1.0 + rng() * 0.8,
			rng,
		);
	};

	// Ring 1 (r≈16) — front arc gets rocks/bushes, back gets trees
	ring(16, 8).forEach(({ x, z, angle }) => {
		if (inFrontArc(angle)) spawnFiller(x, z);
		else spawnTree(x, z);
	});

	// Gap 1 (r≈19) — rocks and bushes throughout (low, don't block view)
	ring(19, 10, Math.PI / 14).forEach(({ x, z }) => spawnFiller(x, z));

	// Ring 2 (r≈22)
	ring(22, 11, Math.PI / 16).forEach(({ x, z, angle }) => {
		if (inFrontArc(angle)) spawnFiller(x, z);
		else spawnTree(x, z);
	});

	// Gap 2 (r≈26)
	ring(26, 12, Math.PI / 9).forEach(({ x, z }) => spawnFiller(x, z));

	// Ring 3 (r≈29)
	ring(29, 14, Math.PI / 20).forEach(({ x, z, angle }) => {
		if (inFrontArc(angle)) spawnFiller(x, z);
		else spawnTree(x, z);
	});

	// Ring 4 — edge, front arc still kept low
	ring(34, 18, Math.PI / 26).forEach(({ x, z, angle }) => {
		if (inFrontArc(angle)) spawnFiller(x, z);
		else spawnTree(x, z, 0.6);
	});
}
