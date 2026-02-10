// Client-side game state with Babylon.js physics integration
// This demonstrates client-side prediction with server reconciliation

import {
    Scene,
    Engine,
    Vector3,
    HavokPlugin,
    PhysicsAggregate,
    PhysicsShapeType,
    Mesh,
    MeshBuilder,
    UniversalCamera,
    HemisphericLight,
    KeyboardInfo,
    PointerInfo
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';

// =============================================================================
// Types matching the C++ server
// =============================================================================

interface Vector3D {
    x: number;
    y: number;
    z: number;
}

interface CharacterSnapshot {
    playerID: number;
    position: Vector3D;
    velocity: Vector3D;
    yaw: number;
    state: CharacterState;
    health: number;
    maxHealth: number;
    frameNumber?: number; // Optional: can be inferred from GameStateSnapshot
}

interface GameStateSnapshot {
    frameNumber: number;
    characters: CharacterSnapshot[];
    timestamp: number;
}

enum CharacterState {
    Idle = 0,
    Moving = 1,
    Attacking = 2,
    Casting = 3,
    Stunned = 4,
    Dead = 5
}

interface InputState {
    movementDirection: Vector3D;
    isAttacking: boolean;
    isJumping: boolean;
    isUsingAbility1: boolean;
    isUsingAbility2: boolean;
    isDodging: boolean;
    lookDirection: Vector3D;
}

// =============================================================================
// Client-side Character with Prediction
// =============================================================================

class ClientCharacter {
    playerID: number;
    mesh: Mesh;
    physicsAggregate: PhysicsAggregate;

    // Client prediction state
    private predictedPosition: Vector3;
    private predictedVelocity: Vector3;
    private lastServerSnapshot: CharacterSnapshot | null = null;

    // Input history for reconciliation
    private inputHistory: Array<{ frame: number; input: InputState }> = [];
    private lastProcessedServerFrame: number = 0;

    constructor(scene: Scene, playerID: number, position: Vector3D) {
        this.playerID = playerID;

        // Create visual mesh (capsule for character)
        this.mesh = MeshBuilder.CreateCapsule(
            `player_${playerID}`,
            { height: 1.8, radius: 0.5 },
            scene
        );
        this.mesh.position = new Vector3(position.x, position.y, position.z);

        // Create physics body
        this.physicsAggregate = new PhysicsAggregate(
            this.mesh,
            PhysicsShapeType.CAPSULE,
            { mass: 1, restitution: 0.0, friction: 0.5 },
            scene
        );

        this.predictedPosition = this.mesh.position.clone();
        this.predictedVelocity = Vector3.Zero();
    }

    /**
     * Apply input with client-side prediction
     * Called every frame before sending to server
     */
    applyInputPrediction(input: InputState, deltaTime: number, currentFrame: number): void {
        // Store input for later reconciliation
        this.inputHistory.push({ frame: currentFrame, input: { ...input } });

        // Keep only recent history (last 1 second at 60fps = 60 frames)
        if (this.inputHistory.length > 60) {
            this.inputHistory.shift();
        }

        // Apply movement prediction
        if (input.movementDirection.x !== 0 || input.movementDirection.z !== 0) {
            const moveSpeed = 5.0; // Should match server's CharacterStats::movementSpeed
            const direction = new Vector3(
                input.movementDirection.x,
                0,
                input.movementDirection.z
            ).normalize();

            this.predictedVelocity.x = direction.x * moveSpeed;
            this.predictedVelocity.z = direction.z * moveSpeed;
        } else {
            // Apply friction
            this.predictedVelocity.x *= 0.85;
            this.predictedVelocity.z *= 0.85;
        }

        // Apply jump
        if (input.isJumping && this.isGrounded()) {
            this.predictedVelocity.y = 8.0; // JUMP_VELOCITY from server
        }

        // Apply gravity
        this.predictedVelocity.y += -20.0 * deltaTime; // GRAVITY from server

        // Update predicted position
        this.predictedPosition.addInPlace(
            this.predictedVelocity.scale(deltaTime)
        );

        // Keep above ground
        if (this.predictedPosition.y < 0) {
            this.predictedPosition.y = 0;
            this.predictedVelocity.y = 0;
        }

        // Apply to mesh
        this.mesh.position.copyFrom(this.predictedPosition);
    }

    /**
     * Reconcile with server snapshot
     * Called when receiving server update
     */
    reconcileWithServer(snapshot: CharacterSnapshot, serverFrame: number): void {
        this.lastServerSnapshot = snapshot;
        this.lastProcessedServerFrame = serverFrame;

        const serverPos = new Vector3(
            snapshot.position.x,
            snapshot.position.y,
            snapshot.position.z
        );

        // Calculate error between prediction and server
        const positionError = Vector3.Distance(serverPos, this.predictedPosition);

        // If error is small, smoothly correct it
        if (positionError < 0.5) {
            // Small error: smooth correction over next few frames
            this.predictedPosition = Vector3.Lerp(
                this.predictedPosition,
                serverPos,
                0.2 // Correction speed
            );
        } else if (positionError < 2.0) {
            // Medium error: faster correction
            this.predictedPosition = Vector3.Lerp(
                this.predictedPosition,
                serverPos,
                0.5
            );
        } else {
            // Large error: snap to server position (probably teleported or respawned)
            this.predictedPosition = serverPos;
        }

        // Replay inputs that happened after the server snapshot
        // This ensures prediction stays in sync with server
        const inputsToReplay = this.inputHistory.filter(
            entry => entry.frame > serverFrame
        );

        for (const { input } of inputsToReplay) {
            // Re-apply these inputs on top of the corrected position
            // This is simplified - in production you'd fully simulate each frame
            const deltaTime = 1.0 / 60.0;
            this.applyInputPrediction(input, deltaTime, 0);
        }

        // Update mesh
        this.mesh.position.copyFrom(this.predictedPosition);
    }

    /**
     * Interpolate other players (not local player)
     * Used for smooth rendering of remote players
     */
    interpolateToServer(snapshot: CharacterSnapshot, alpha: number): void {
        const targetPos = new Vector3(
            snapshot.position.x,
            snapshot.position.y,
            snapshot.position.z
        );

        // Smooth interpolation
        this.mesh.position = Vector3.Lerp(
            this.mesh.position,
            targetPos,
            alpha
        );

        // Rotate to face movement direction
        if (snapshot.velocity.x !== 0 || snapshot.velocity.z !== 0) {
            const angle = Math.atan2(snapshot.velocity.x, snapshot.velocity.z);
            this.mesh.rotation.y = angle;
        }
    }

    private isGrounded(): boolean {
        // Simple ground check - in production use raycast
        return this.mesh.position.y <= 0.01;
    }

    destroy(): void {
        this.physicsAggregate.dispose();
        this.mesh.dispose();
    }
}

// =============================================================================
// Game Client Manager
// =============================================================================

class GameClient {
    private scene: Scene;
    private characters: Map<number, ClientCharacter> = new Map();
    private localPlayerID: number;
    private currentFrame: number = 0;

    // Network buffering for interpolation
    private snapshotBuffer: GameStateSnapshot[] = [];
    private readonly BUFFER_SIZE = 3; // Buffer 3 snapshots (150ms at 20Hz)

    constructor(scene: Scene, localPlayerID: number) {
        this.scene = scene;
        this.localPlayerID = localPlayerID;
    }

    /**
     * Update called every frame (60 FPS)
     */
    update(deltaTime: number, currentInput: InputState): void {
        this.currentFrame++;

        // Apply local player prediction
        const localChar = this.characters.get(this.localPlayerID);
        if (localChar) {
            localChar.applyInputPrediction(currentInput, deltaTime, this.currentFrame);
        }

        // Interpolate remote players
        if (this.snapshotBuffer.length >= this.BUFFER_SIZE) {
            const oldSnapshot = this.snapshotBuffer[0];
            const newSnapshot = this.snapshotBuffer[1];

            // Calculate interpolation alpha
            const now = performance.now() / 1000.0;
            const alpha = (now - oldSnapshot.timestamp) /
                         (newSnapshot.timestamp - oldSnapshot.timestamp);

            // Interpolate all remote players
            for (const charSnapshot of newSnapshot.characters) {
                if (charSnapshot.playerID !== this.localPlayerID) {
                    const char = this.characters.get(charSnapshot.playerID);
                    if (char) {
                        char.interpolateToServer(charSnapshot, Math.min(alpha, 1.0));
                    }
                }
            }

            // Remove old snapshot when fully interpolated
            if (alpha >= 1.0) {
                this.snapshotBuffer.shift();
            }
        }
    }

    /**
     * Handle snapshot from server
     */
    onServerSnapshot(snapshot: GameStateSnapshot): void {
        // Add to buffer
        this.snapshotBuffer.push(snapshot);

        // Keep buffer size limited
        if (this.snapshotBuffer.length > this.BUFFER_SIZE + 2) {
            this.snapshotBuffer.shift();
        }

        // Reconcile local player with server state
        const localChar = this.characters.get(this.localPlayerID);
        if (localChar) {
            const localSnapshot = snapshot.characters.find(
                c => c.playerID === this.localPlayerID
            );
            if (localSnapshot) {
                localChar.reconcileWithServer(localSnapshot, snapshot.frameNumber);
            }
        }

        // Add any new players
        for (const charSnapshot of snapshot.characters) {
            if (!this.characters.has(charSnapshot.playerID)) {
                this.addCharacter(charSnapshot.playerID, charSnapshot.position);
            }
        }

        // Remove disconnected players
        const activePlayerIDs = new Set(snapshot.characters.map(c => c.playerID));
        for (const [playerID, char] of this.characters.entries()) {
            if (!activePlayerIDs.has(playerID)) {
                char.destroy();
                this.characters.delete(playerID);
            }
        }
    }

    addCharacter(playerID: number, position: Vector3D): void {
        const char = new ClientCharacter(this.scene, playerID, position);
        this.characters.set(playerID, char);
    }
}

// =============================================================================
// Example Setup
// =============================================================================

export async function initGameClient(canvas: HTMLCanvasElement, localPlayerID: number) {
    // Initialize Babylon.js
    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);

    // Setup physics (Havok)
    const havokInstance = await HavokPhysics();
    const havokPlugin = new HavokPlugin(true, havokInstance);
    scene.enablePhysics(new Vector3(0, -20, 0), havokPlugin); // Gravity matching server

    // Setup camera
    const camera = new UniversalCamera('camera', new Vector3(0, 5, -10), scene);
    camera.setTarget(Vector3.Zero());
    camera.attachControl(canvas, true);

    // Add lighting
    new HemisphericLight('light', new Vector3(0, 1, 0), scene);

    // Create ground
    const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
    new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0 }, scene);

    // Initialize game client
    const gameClient = new GameClient(scene, localPlayerID);

    // Input handling
    const input: InputState = {
        movementDirection: { x: 0, y: 0, z: 0 },
        isAttacking: false,
        isJumping: false,
        isUsingAbility1: false,
        isUsingAbility2: false,
        isDodging: false,
        lookDirection: { x: 0, y: 0, z: 1 }
    };

    // Keyboard input
    scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
        const key = kbInfo.event.key.toLowerCase();
        const isDown = kbInfo.type === 1; // KEYDOWN

        if (key === 'w') input.movementDirection.z = isDown ? 1 : 0;
        if (key === 's') input.movementDirection.z = isDown ? -1 : 0;
        if (key === 'a') input.movementDirection.x = isDown ? -1 : 0;
        if (key === 'd') input.movementDirection.x = isDown ? 1 : 0;
        if (key === ' ') input.isJumping = isDown;
    });

    // Mouse input
    scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
        if (pointerInfo.type === 1) { // POINTERDOWN
            input.isAttacking = true;
        } else if (pointerInfo.type === 2) { // POINTERUP
            input.isAttacking = false;
        }
    });

    // Render loop
    let lastTime = performance.now();
    engine.runRenderLoop(() => {
        const now = performance.now();
        const deltaTime = (now - lastTime) / 1000.0;
        lastTime = now;

        gameClient.update(deltaTime, input);
        scene.render();
    });

    return { engine, scene, gameClient, input };
}

// =============================================================================
// WebTransport Integration
// =============================================================================

export class GameNetworkClient {
    private gameClient: GameClient;
    private ws: WebSocket; // Or WebTransport when available

    constructor(gameClient: GameClient, serverURL: string) {
        this.gameClient = gameClient;
        this.ws = new WebSocket(serverURL);

        this.ws.onmessage = (event) => {
            const snapshot: GameStateSnapshot = JSON.parse(event.data);
            this.gameClient.onServerSnapshot(snapshot);
        };
    }

    sendInput(input: InputState): void {
        // Send input to server
        this.ws.send(JSON.stringify({
            type: 'input',
            input: input
        }));
    }
}
