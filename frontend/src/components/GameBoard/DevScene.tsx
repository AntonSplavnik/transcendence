import { AbstractMesh, ArcRotateCamera, Engine, GizmoManager, ImportMeshAsync, Quaternion, Scene, SceneSerializer, Vector3 } from '@babylonjs/core';
import { GLTFLoader } from '@babylonjs/loaders/glTF/2.0';
import { useEffect, useMemo, useRef, useState } from 'react';

import { measureModel } from '@/utils/measureModel';
import { arenaScene, CAM_ALPHA, CAM_BETA, CAM_RADIUS, CAM_TARGET } from './BabylonCanvas';

// Register no-op handlers for CVTOOLS extensions (BabylonJS Unity Toolkit).
// This satisfies Babylon's extensionsRequired check without needing the full toolkit.
for (const name of ['CVTOOLS_babylon_mesh', 'CVTOOLS_left_handed', 'CVTOOLS_unity_metadata']) {
	GLTFLoader.RegisterExtension(name, () => ({ name, enabled: true, dispose() {} }));
}

// All gltf/glb under assets — lazy loaded, only fetched when spawned
const modelGlob = import.meta.glob<string>(
	'/src/assets/**/*.{gltf,glb}',
	{ query: '?url', import: 'default' },
);

// Derive clean display name from file path
function modelName(path: string): string {
	const file = path.split('/').pop()!;
	return file.replace(/\.(gltf|glb)$/, '').replace(/_Color\d+$/, '');
}

// Target height per model type — used to auto-normalize scale on first spawn
function targetHeight(name: string): number {
	if (name.startsWith('Tree')) return 10;
	if (name.startsWith('Rock')) return 3;
	if (name.startsWith('Bush')) return 2;
	if (name.startsWith('Grass')) return 1;
	return 2;
}

// Cache measured scales so each model is only measured once
const scaleCache = new Map<string, number>();

let spawnCounter = 0;

// Scenes in public/scenes — each entry is [label, rootUrl, filename]
const PUBLIC_SCENES: [string, string, string][] = [
	['Forest', '/scenes/Forest/', 'Forest.gltf'],
];

async function loadPublicScene(rootUrl: string, filename: string, scene: Scene) {
	try {
		const result = await ImportMeshAsync(rootUrl + filename, scene);
		// CVTOOLS_left_handed is a no-op so Babylon applies its right→left-handed Z-flip,
		// inverting normals on Unity-exported geometry. Disabling backface culling keeps
		// all surfaces visible despite the inverted winding on the terrain.
		result.meshes.forEach((mesh) => {
			if (mesh.material) mesh.material.backFaceCulling = false;
		});
	} catch (e) {
		console.error('[DevScene] failed to load scene:', e);
	}
}

async function spawnModel(path: string, scene: Scene) {
	const loader = modelGlob[path];
	if (!loader) return;
	const url = await loader();

	let scale = scaleCache.get(path);
	if (scale === undefined) {
		const dims = await measureModel(url);
		scale = dims.height > 0 ? targetHeight(modelName(path)) / dims.height : 1;
		scaleCache.set(path, scale);
	}

	const id = ++spawnCounter;
	ImportMeshAsync(url, scene).then(({ meshes }) => {
		meshes[0].name = `${modelName(path)}_${id}`;
		meshes[0].position = new Vector3(0, 0.5, 0);
		meshes[0].scaling.setAll(scale!);
	});
}

function serializeScene(scene: Scene) {
	const name = prompt('Save as:', 'forest');
	if (!name) return;
	const serialized = SceneSerializer.Serialize(scene);
	const blob = new Blob([JSON.stringify(serialized, null, 2)], { type: 'application/json' });
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = `${name}.babylon`;
	a.click();
	URL.revokeObjectURL(a.href);
}

export default function DevScene() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const sceneRef = useRef<Scene | null>(null);
	const [panelOpen, setPanelOpen] = useState(false);
	const [filter, setFilter] = useState('');
	const [snapSize, setSnapSize] = useState(1);
	const [gizmoEnabled, setGizmoEnabled] = useState(true);
	const gizmoRef = useRef<GizmoManager | null>(null);

	const allPaths = useMemo(() => Object.keys(modelGlob).sort(), []);

	const filtered = useMemo(() => {
		const q = filter.toLowerCase();
		return allPaths.filter((p) => modelName(p).toLowerCase().includes(q));
	}, [allPaths, filter]);

	// Group filtered results by prefix (Tree, Rock, Bush, etc.)
	const grouped = useMemo(() => {
		const groups = new Map<string, string[]>();
		filtered.forEach((path) => {
			const prefix = modelName(path).split('_')[0];
			if (!groups.has(prefix)) groups.set(prefix, []);
			groups.get(prefix)!.push(path);
		});
		return groups;
	}, [filtered]);

	useEffect(() => {
		if (!canvasRef.current) return;
		const engine = new Engine(canvasRef.current, true);
		const scene = new Scene(engine);
		sceneRef.current = scene;

		const camera = new ArcRotateCamera('devCam', CAM_ALPHA, CAM_BETA, CAM_RADIUS, CAM_TARGET, scene);
		camera.attachControl(canvasRef.current, true);

		arenaScene(scene, camera);

		// GizmoManager — click any mesh to select, drag with grid snapping
		const gizmoManager = new GizmoManager(scene);
		gizmoManager.positionGizmoEnabled = true;
		gizmoManager.rotationGizmoEnabled = true;
		gizmoManager.scaleGizmoEnabled = false;
		gizmoManager.usePointerToAttachGizmos = true;
		gizmoManager.gizmos.positionGizmo!.snapDistance = snapSize;
		gizmoRef.current = gizmoManager;

		// Undo stack — tracks both position and rotation changes
		type UndoEntry =
			| { type: 'position'; mesh: AbstractMesh; value: Vector3 }
			| { type: 'rotation'; mesh: AbstractMesh; euler: Vector3; quaternion: Quaternion | null };
		const undoStack: UndoEntry[] = [];

		gizmoManager.gizmos.positionGizmo!.onDragStartObservable.add(() => {
			const mesh = gizmoManager.attachedMesh;
			if (!mesh) return;
			undoStack.push({ type: 'position', mesh, value: mesh.position.clone() });
		});

		gizmoManager.gizmos.rotationGizmo!.onDragStartObservable.add(() => {
			const mesh = gizmoManager.attachedMesh;
			if (!mesh) return;
			undoStack.push({
				type: 'rotation',
				mesh,
				euler: mesh.rotation.clone(),
				quaternion: mesh.rotationQuaternion?.clone() ?? null,
			});
		});

		engine.runRenderLoop(() => scene.render());
		window.addEventListener('resize', () => engine.resize());

		let inspectorLoaded = false;
		const onKeyDown = async (event: KeyboardEvent) => {
			if (event.ctrlKey && event.shiftKey && (event.key === 'S' || event.key === 's')) {
				event.preventDefault();
				serializeScene(scene);
			}
			if (event.ctrlKey && event.shiftKey && event.key === 'I') {
				event.preventDefault();
				if (!inspectorLoaded) {
					await import('@babylonjs/inspector');
					inspectorLoaded = true;
				}
				scene.debugLayer.isVisible() ? scene.debugLayer.hide() : await scene.debugLayer.show({ embedMode: false, overlay: true, globalRoot: document.body });
			}
			if (event.ctrlKey && event.shiftKey && event.key === 'A') {
				event.preventDefault();
				setPanelOpen((v) => !v);
			}
			if (event.ctrlKey && event.shiftKey && event.key === 'G') {
				event.preventDefault();
				setGizmoEnabled((v) => !v);
			}
			// Deselect
			if (event.key === 'Escape') {
				gizmoManager.attachToMesh(null);
			}
			// Undo
			if (event.ctrlKey && event.key === 'z') {
				event.preventDefault();
				const entry = undoStack.pop();
				if (!entry) return;
				if (entry.type === 'position') {
					entry.mesh.position.copyFrom(entry.value);
				} else {
					entry.mesh.rotation.copyFrom(entry.euler);
					if (entry.quaternion) entry.mesh.rotationQuaternion = entry.quaternion;
				}
			}
		};
		window.addEventListener('keydown', onKeyDown);

		return () => {
			window.removeEventListener('keydown', onKeyDown);
			gizmoManager.dispose();
			engine.stopRenderLoop();
			scene.dispose();
			engine.dispose();
			sceneRef.current = null;
			gizmoRef.current = null;
		};
	}, []);

	// Sync snap size to gizmo when changed from panel
	useEffect(() => {
		const g = gizmoRef.current?.gizmos.positionGizmo;
		if (g) g.snapDistance = snapSize;
	}, [snapSize]);

	// Toggle gizmo manager on/off
	useEffect(() => {
		const gm = gizmoRef.current;
		if (!gm) return;
		gm.positionGizmoEnabled = gizmoEnabled;
		gm.rotationGizmoEnabled = gizmoEnabled;
		if (!gizmoEnabled) gm.attachToMesh(null);
	}, [gizmoEnabled]);

	return (
		<>
			<canvas ref={canvasRef} style={{ width: '100%', height: '100vh', display: 'block' }} />
			{panelOpen && (
				<div style={{
					position: 'fixed', top: 16, left: 16, zIndex: 9999, width: 220,
					background: '#1a1a1aee', border: '1px solid #444', borderRadius: 8,
					padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
				}}>
					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<div style={{ color: '#aaa', fontSize: 11 }}>SPAWN  <span style={{ color: '#555' }}>Ctrl+Shift+A</span></div>
						<button
							onClick={() => setGizmoEnabled((v) => !v)}
							style={{
								background: gizmoEnabled ? '#3a5a3a' : '#2a2a2a',
								color: gizmoEnabled ? '#8f8' : '#888',
								border: `1px solid ${gizmoEnabled ? '#4a7a4a' : '#444'}`,
								borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11,
							}}
						>
							{gizmoEnabled ? 'GIZMO ON' : 'GIZMO OFF'}
						</button>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
						<span style={{ color: '#666', fontSize: 10 }}>SNAP</span>
						{[0, 0.5, 1, 2].map((s) => (
							<button
								key={s}
								onClick={() => setSnapSize(s)}
								style={{
									background: snapSize === s ? '#555' : '#2a2a2a',
									color: snapSize === s ? '#fff' : '#888',
									border: '1px solid #444', borderRadius: 4,
									padding: '2px 7px', cursor: 'pointer', fontSize: 11,
								}}
							>
								{s === 0 ? 'off' : s}
							</button>
						))}
					</div>
					<input
						placeholder="filter..."
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						style={{
							background: '#2a2a2a', color: '#ddd', border: '1px solid #555',
							borderRadius: 4, padding: '4px 8px', fontSize: 12, outline: 'none',
						}}
					/>
					<div style={{ color: '#555', fontSize: 10 }}>SCENES</div>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
						{PUBLIC_SCENES.map(([label, rootUrl, filename]) => (
							<button
								key={rootUrl + filename}
								onClick={() => sceneRef.current && loadPublicScene(rootUrl, filename, sceneRef.current)}
								style={{
									background: '#2a2a2a', color: '#ccc', border: '1px solid #444',
									borderRadius: 4, padding: '3px 7px', cursor: 'pointer', fontSize: 11,
								}}
							>
								{label}
							</button>
						))}
					</div>
					<div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
						{[...grouped.entries()].map(([group, paths]) => (
							<div key={group}>
								<div style={{ color: '#555', fontSize: 10, marginBottom: 4 }}>{group.toUpperCase()}</div>
								<div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
									{paths.map((path) => (
										<button
											key={path}
											onClick={() => sceneRef.current && spawnModel(path, sceneRef.current)}
											style={{
												background: '#2a2a2a', color: '#ccc', border: '1px solid #444',
												borderRadius: 4, padding: '3px 7px', cursor: 'pointer', fontSize: 11,
											}}
										>
											{modelName(path)}
										</button>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</>
	);
}
