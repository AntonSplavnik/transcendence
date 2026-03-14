/**
 * Minimal Game Client - Phase 1: Bare Minimum
 *
 * Features:
 * - Connect to server
 * - Render boxes for each player
 * - Update positions from server snapshots (no prediction)
 * - Basic camera
 *
 * NO animations, NO client prediction, NO interpolation
 * Pure server-authoritative rendering for debugging
 */

import { useEffect, useRef } from 'react';
import {
    Scene, Engine, Vector3, MeshBuilder, UniversalCamera, HemisphericLight,
    StandardMaterial, Color3, Mesh
} from '@babylonjs/core';
import type { GameStateSnapshot, Vector3D } from '../../game/types';

interface Props {
    snapshot: GameStateSnapshot | null;
    onSendInput: (movement: Vector3D, lookDirection: Vector3D, attacking: boolean, jumping: boolean) => void;
    localPlayerId: number | undefined;
}

export default function MinimalGameClient({ snapshot, onSendInput, localPlayerId }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Engine | null>(null);
    const sceneRef = useRef<Scene | null>(null);

    // Store player meshes by player_id
    const playerMeshesRef = useRef<Map<number, Mesh>>(new Map());

    // Input state
    const keysRef = useRef<Set<string>>(new Set());

    // Flag to prevent double initialization
    const initializedRef = useRef(false);

    // Store onSendInput in ref to avoid stale closures
    const onSendInputRef = useRef(onSendInput);
    useEffect(() => {
        onSendInputRef.current = onSendInput;
    }, [onSendInput]);

    // Convert keyboard input to movement vector — declared before the Babylon
    // useEffect so the closure inside the render loop can reference it without
    // triggering a use-before-declare lint error.
    const getInputFromKeys = () => {
        const keys = keysRef.current;
        const movement: Vector3D = { x: 0, y: 0, z: 0 };

        // WASD movement (world space, not camera relative)
        if (keys.has('w')) movement.z += 1;
        if (keys.has('s')) movement.z -= 1;
        if (keys.has('a')) movement.x -= 1;
        if (keys.has('d')) movement.x += 1;

        return {
            movement,
            lookDirection: { x: 0, y: 1, z: 0 },
            attacking: keys.has('e'),
            jumping: keys.has(' ')
        };
    };

    // Initialize Babylon.js scene once
    useEffect(() => {
        if (!canvasRef.current || initializedRef.current) return;
        initializedRef.current = true;

        const canvas = canvasRef.current;
        const engine = new Engine(canvas, true);
        const scene = new Scene(engine);

        engineRef.current = engine;
        sceneRef.current = scene;

        // Camera - centered isometric view
        const camera = new UniversalCamera('camera', new Vector3(50, 100, 0), scene);
        camera.setTarget(new Vector3(50, 0, 50));
        camera.attachControl(canvas, true);
        camera.fov = 0.8; // Wider field of view to see the whole arena

        // Lighting
        const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
        light.intensity = 1.5;

        // Ground - centered at origin, extending 50 units in each direction
        const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
        ground.position = new Vector3(50, 0, 50); // Center the ground at (50, 0, 50)
        const groundMat = new StandardMaterial('groundMat', scene);
        groundMat.diffuseColor = Color3.FromHexString('#2d5016');
        groundMat.specularColor = Color3.Black();
        ground.material = groundMat;

        // Walls
        const wallHeight = 5;
        const wallMat = new StandardMaterial('wallMat', scene);
        wallMat.diffuseColor = Color3.FromHexString('#8B4513');
        wallMat.specularColor = Color3.Black();

        const northWall = MeshBuilder.CreateBox('northWall', { width: 100, height: wallHeight, depth: 1 }, scene);
        northWall.position = new Vector3(50, wallHeight / 2, 100);
        northWall.material = wallMat;

        const southWall = MeshBuilder.CreateBox('southWall', { width: 100, height: wallHeight, depth: 1 }, scene);
        southWall.position = new Vector3(50, wallHeight / 2, 0);
        southWall.material = wallMat;

        const eastWall = MeshBuilder.CreateBox('eastWall', { width: 1, height: wallHeight, depth: 100 }, scene);
        eastWall.position = new Vector3(100, wallHeight / 2, 50);
        eastWall.material = wallMat;

        const westWall = MeshBuilder.CreateBox('westWall', { width: 1, height: wallHeight, depth: 100 }, scene);
        westWall.position = new Vector3(0, wallHeight / 2, 50);
        westWall.material = wallMat;

        // Keyboard input
        const handleKeyDown = (e: KeyboardEvent) => {
            keysRef.current.add(e.key.toLowerCase());
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            keysRef.current.delete(e.key.toLowerCase());
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        // Render loop
        let lastInputSend = 0;
        engine.runRenderLoop(() => {
            const now = performance.now();

            // Send input to server every 16.67ms (60 times/sec)
            if (now - lastInputSend >= 16.67) {
                const input = getInputFromKeys();
                onSendInputRef.current(input.movement, input.lookDirection, input.attacking, input.jumping);
                lastInputSend = now;
            }

            scene.render();
        });

        // Handle window resize
        const handleResize = () => engine.resize();
        window.addEventListener('resize', handleResize);

        // Cleanup
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('resize', handleResize);
            engine.stopRenderLoop();
            scene.dispose();
            engine.dispose();
            initializedRef.current = false;
        };
    }, []); // Empty deps - only run once!

    // Process snapshots from server
    useEffect(() => {
        if (!snapshot || !sceneRef.current) return;

        const scene = sceneRef.current;
        const playerMeshes = playerMeshesRef.current;

        console.log('📦 Snapshot received:', {
            frame: snapshot.frame_number,
            players: snapshot.characters.length
        });

        // Track which players are in this snapshot
        const activePlayerIds = new Set<number>();

        // Update or create meshes for each player
        for (const char of snapshot.characters) {
            activePlayerIds.add(char.player_id);

            let mesh = playerMeshes.get(char.player_id);

            // Create new mesh if doesn't exist
            if (!mesh) {
                console.log('🎨 Creating mesh for player', char.player_id);

                // Create a box to represent the player
                mesh = MeshBuilder.CreateBox(
                    `player_${char.player_id}`,
                    { width: 1, height: 2, depth: 1 },
                    scene
                );

                // Color: local player = blue, remote players = red
                const mat = new StandardMaterial(`mat_${char.player_id}`, scene);
                mat.diffuseColor = char.player_id === localPlayerId
                    ? Color3.Blue()
                    : Color3.Red();
                mat.specularColor = Color3.Black();
                mesh.material = mat;

                playerMeshes.set(char.player_id, mesh);
            }

            // Update position directly from server (no interpolation)
            mesh.position.set(char.position.x, char.position.y + 1, char.position.z);

            // Debug log for local player
            if (char.player_id === localPlayerId) {
                console.log('🔵 Local player position:', char.position);
            }
        }

        // Remove meshes for disconnected players
        for (const [playerId, mesh] of playerMeshes.entries()) {
            if (!activePlayerIds.has(playerId)) {
                console.log('🗑️ Removing mesh for player', playerId);
                mesh.dispose();
                playerMeshes.delete(playerId);
            }
        }
    }, [snapshot, localPlayerId]);

    return (
        <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

            {/* Debug overlay */}
            <div style={{
                position: 'absolute',
                top: 10,
                left: 10,
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '10px',
                fontFamily: 'monospace',
                fontSize: '12px'
            }}>
                <div>🎮 Minimal Game Client - Phase 1</div>
                <div>Local Player ID: {localPlayerId}</div>
                {/* eslint-disable-next-line react-hooks/refs */}
                <div>Players in scene: {playerMeshesRef.current.size}</div>
                {snapshot && (
                    <>
                        <div>Frame: {snapshot.frame_number}</div>
                        <div>Time: {snapshot.timestamp.toFixed(2)}s</div>
                    </>
                )}
                <div style={{ marginTop: '10px', borderTop: '1px solid #666', paddingTop: '5px' }}>
                    <div>🔵 Blue = You</div>
                    <div>🔴 Red = Others</div>
                    <div>WASD = Move (world space)</div>
                    <div>Space = Jump</div>
                    <div>E = Attack</div>
                </div>
            </div>
        </div>
    );
}
