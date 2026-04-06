// Simplified client WITHOUT physics - for testing
import {
    Scene,
    Engine,
    Vector3,
    MeshBuilder,
    UniversalCamera,
    HemisphericLight,
    StandardMaterial,
    Color3,
    SceneLoader,
    AnimationGroup,
    AbstractMesh,
    TransformNode
} from '@babylonjs/core';
import '@babylonjs/inspector'; // Enable Babylon.js Inspector (press 'I' key)
import '@babylonjs/loaders/glTF'; // GLTF/GLB loader
import '@babylonjs/loaders/OBJ'; // OBJ loader (optional)
// Note: FBX requires separate package - recommend converting FBX to GLTF

interface Vector3D {
    x: number;
    y: number;
    z: number;
}

interface CharacterSnapshot {
    player_id: number;
    position: Vector3D;
    velocity: Vector3D;
    yaw: number;
    state: number;
    health: number;
    max_health: number;
}

interface GameStateSnapshot {
    frame_number: number;
    characters: CharacterSnapshot[];
    timestamp: number;
}

interface InputState {
    movementDirection: Vector3D;
    isAttacking: boolean;
    isJumping: boolean;
}

// Character states matching server
enum CharacterState {
    Idle = 0,
    Moving = 1,
    Attacking = 2,
    Stunned = 4,
    Dead = 5
}

// Animated character class
class AnimatedCharacter {
    public rootNode: TransformNode;
    public meshes: AbstractMesh[] = [];
    public animations: Map<string, AnimationGroup> = new Map();
    private currentAnimation: AnimationGroup | null = null;
    private currentAnimationName: string = '';
    private scene: Scene;

    constructor(scene: Scene) {
        this.scene = scene;
        this.rootNode = new TransformNode("character_root", scene);
    }

    // Load character model and animations from a GLB file
    async loadModel(path: string, filename: string): Promise<void> {
        const result = await SceneLoader.ImportMeshAsync("", path, filename, this.scene);

        // Parent all meshes to our root node
        result.meshes.forEach(mesh => {
            if (!mesh.parent) {
                mesh.parent = this.rootNode;
            }
            this.meshes.push(mesh);
        });

        // Store animations by name
        result.animationGroups.forEach(anim => {
            this.animations.set(anim.name, anim);
            anim.stop(); // Stop all animations initially
            console.log(`📦 Loaded animation: "${anim.name}"`);
        });

        console.log(`✅ Character loaded: ${filename} with ${this.animations.size} animations`);
    }

    // Load additional animations from another GLB file (same rig)
    async loadAnimations(path: string, filename: string): Promise<void> {
        const result = await SceneLoader.ImportMeshAsync("", path, filename, this.scene);

        // Get our main skeleton (from first loaded model)
        const mainSkeleton = this.scene.skeletons[0]; // First skeleton is ours

        if (!mainSkeleton) {
            console.error('❌ No main skeleton found for retargeting!');
            return;
        }

        console.log(`🔧 Retargeting animations to skeleton: ${mainSkeleton.name}`);
        console.log(`   Main skeleton has ${mainSkeleton.bones.length} bones`);

        // Add new animations and retarget to main skeleton
        result.animationGroups.forEach(anim => {
            let retargetedCount = 0;

            // Retarget each animation to use our main skeleton's bones
            anim.targetedAnimations.forEach(ta => {
                const targetName = ta.target?.name;
                if (targetName) {
                    // Try to find matching bone in main skeleton
                    const mainBone = mainSkeleton.bones.find(b => b.name === targetName);
                    if (mainBone) {
                        ta.target = mainBone.getTransformNode() || mainBone;
                        retargetedCount++;
                    }
                }
            });

            this.animations.set(anim.name, anim);
            anim.stop();
            console.log(`📦 Loaded "${anim.name}" (retargeted ${retargetedCount}/${anim.targetedAnimations.length} targets)`);
        });

        // Hide duplicate meshes but DON'T dispose - animations need them
        result.meshes.forEach(mesh => {
            mesh.isVisible = false;
            mesh.setEnabled(false);
        });

        // DON'T dispose skeletons - animations are bound to them
        // result.skeletons.forEach(skeleton => skeleton.dispose());

        console.log(`✅ Loaded ${result.animationGroups.length} animations from ${filename}`);
    }

    // Play an animation by name
    playAnimation(name: string, loop: boolean = true, speed: number = 1.0): void {
        // Don't restart if already playing this animation
        if (this.currentAnimationName === name) return;

        const anim = this.animations.get(name);
        if (!anim) {
            console.warn(`⚠️ Animation "${name}" not found. Available:`, Array.from(this.animations.keys()));
            return;
        }

        // Stop current animation
        if (this.currentAnimation) {
            this.currentAnimation.stop();
        }

        // Start new animation
        anim.speedRatio = speed;
        anim.start(loop);
        this.currentAnimation = anim;
        this.currentAnimationName = name;
    }

    // Stop current animation
    stopAnimation(): void {
        if (this.currentAnimation) {
            this.currentAnimation.stop();
            this.currentAnimation = null;
            this.currentAnimationName = '';
        }
    }

    // Set position
    setPosition(pos: Vector3): void {
        this.rootNode.position.copyFrom(pos);
    }

    // Set rotation (yaw)
    setRotation(yaw: number): void {
        this.rootNode.rotation.y = yaw;
    }

    // Dispose character
    dispose(): void {
        this.animations.forEach(anim => anim.stop());
        this.meshes.forEach(mesh => mesh.dispose());
        this.rootNode.dispose();
    }

    // List all available animations
    listAnimations(): string[] {
        return Array.from(this.animations.keys());
    }
}

// Animation name mapping for different states
// Combining animations from General.glb + MovementBasic.glb
const AnimationNames = {
    idle: 'Idle_A',         // From General.glb
    walk: 'Walking_A',      // From MovementBasic.glb
    run: 'Running_A',       // From MovementBasic.glb
    jumpStart: 'Jump_Start', // From MovementBasic.glb
    jumpIdle: 'Jump_Idle',  // From MovementBasic.glb
    jumpLand: 'Jump_Land',  // From MovementBasic.glb
    attack: 'Throw',        // From General.glb (placeholder until CombatMelee loaded)
    hit: 'Hit_A',           // From General.glb
    death: 'Death_A',       // From General.glb
    spawn: 'Spawn_Air'      // From General.glb
};

class SimpleGameClient {
    private scene: Scene;
    private localPlayerID: number;
    private characters: Map<number, AnimatedCharacter> = new Map();
    private loadingCharacters: Set<number> = new Set(); // Track characters being loaded
    private localCharacter: AnimatedCharacter | null = null;
    private position: Vector3 = new Vector3(0, 1, 0);
    private velocity: Vector3 = new Vector3(0, 0, 0);
    private camera: UniversalCamera;

    // Animation state tracking
    private currentAnimState: string = 'idle';
    private isGrounded: boolean = true;
    private wasGrounded: boolean = true;
    private isJumping: boolean = false;

    constructor(scene: Scene, localPlayerID: number, camera: UniversalCamera) {
        this.scene = scene;
        this.localPlayerID = localPlayerID;
        this.camera = camera;
    }

    // Initialize local player character with animations
    async initLocalPlayer(): Promise<void> {
        this.localCharacter = new AnimatedCharacter(this.scene);

        // Load model from General.glb (has mesh + Idle, Spawn, Death, Hit animations)
        await this.localCharacter.loadModel('/assets/Rig_Medium/', 'Rig_Medium_General.glb');

        // Load movement animations from MovementBasic.glb (Walk, Run, Jump)
        await this.localCharacter.loadAnimations('/assets/Rig_Medium/', 'Rig_Medium_MovementBasic.glb');

        // Scale and position the character (adjust scale as needed)
        this.localCharacter.rootNode.scaling = new Vector3(1, 1, 1);
        this.localCharacter.setPosition(this.position);

        // Play spawn animation on start
        this.localCharacter.playAnimation('Spawn_Air', false);
        console.log('🎬 Playing Spawn_Air animation...');

        // After spawn animation, switch to idle
        setTimeout(() => {
            this.currentAnimState = ''; // Reset to allow idle
            this.playAnimation('idle');
        }, 1500);

        console.log('✅ Local player character loaded with animations');
        console.log('Available animations:', this.localCharacter.listAnimations());
    }

    // Play animation by state name
    private playAnimation(state: string, loop: boolean = true): void {
        if (this.currentAnimState === state) return; // Already playing

        const animName = AnimationNames[state as keyof typeof AnimationNames];
        if (animName && this.localCharacter) {
            this.localCharacter.playAnimation(animName, loop);
            this.currentAnimState = state;
        }
    }

    // Update animation based on current state
    private updateAnimation(input: InputState): void {
        if (!this.localCharacter) return;

        const isMoving = input.movementDirection.x !== 0 || input.movementDirection.z !== 0;
        const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

        // Check if just landed
        if (this.isGrounded && !this.wasGrounded) {
            this.playAnimation('idle'); // Reset after landing
            this.isJumping = false;
        }

        // Jump state
        if (!this.isGrounded) {
            if (!this.isJumping) {
                this.playAnimation('jumpStart', false);
                this.isJumping = true;
            }
            return;
        }

        // Attacking state
        if (input.isAttacking) {
            this.playAnimation('attack', false);
            return;
        }

        // Movement states
        if (isMoving) {
            if (speed > 3.0) {
                this.playAnimation('run');
            } else {
                this.playAnimation('walk');
            }

            // Rotate character to face movement direction
            if (this.velocity.x !== 0 || this.velocity.z !== 0) {
                const targetRotation = Math.atan2(this.velocity.x, this.velocity.z);
                this.localCharacter.setRotation(targetRotation);
            }
        } else {
            this.playAnimation('idle');
        }
    }

    applyInput(input: InputState, deltaTime: number) {
        const moveSpeed = 5.0;

        // Store previous grounded state
        this.wasGrounded = this.isGrounded;

        // Apply movement (camera-relative for intuitive isometric controls)
        if (input.movementDirection.x !== 0 || input.movementDirection.z !== 0) {
            // Get camera's forward direction (looking at player), projected to horizontal plane
            const cameraForward = this.camera.getTarget().subtract(this.camera.position);
            cameraForward.y = 0; // Project to horizontal plane
            cameraForward.normalize();

            // Get camera's right direction (perpendicular to forward)
            const cameraRight = Vector3.Cross(Vector3.Up(), cameraForward).normalize();

            // Transform input to world space based on camera orientation
            // W/S moves along camera forward, A/D moves along camera right
            const worldMoveDir = cameraForward.scale(input.movementDirection.z)
                .add(cameraRight.scale(input.movementDirection.x));

            if (worldMoveDir.length() > 0) {
                worldMoveDir.normalize();
                this.velocity.x = worldMoveDir.x * moveSpeed;
                this.velocity.z = worldMoveDir.z * moveSpeed;
            }
        } else {
            this.velocity.x = 0;
            this.velocity.z = 0;
        }

        // Apply jump (simple)
        if (input.isJumping && this.position.y <= 1.1) {
            this.velocity.y = 8.0;
            this.isGrounded = false;
        }

        // Simple gravity
        if (this.position.y > 1.0) {
            this.velocity.y -= 20.0 * deltaTime;
            this.isGrounded = false;
        } else {
            this.position.y = 1.0;
            this.velocity.y = 0;
            this.isGrounded = true;
        }

        // Update position
        this.position.addInPlace(this.velocity.scale(deltaTime));

        // Clamp to arena bounds
        this.position.x = Math.max(-49, Math.min(49, this.position.x));
        this.position.z = Math.max(-49, Math.min(49, this.position.z));

        // Update character position
        if (this.localCharacter) {
            this.localCharacter.setPosition(this.position);
        }

        // Update animations based on state
        this.updateAnimation(input);

        // Update camera to follow player (isometric 3rd person view)
        const cameraOffset = new Vector3(30, 60, -30); // Isometric angle: above and to the side (increased distance)
        this.camera.position = this.position.add(cameraOffset);
        this.camera.setTarget(this.position); // Look at player
    }

    processSnapshot(snapshot: GameStateSnapshot) {
        // Track which players are in this snapshot
        const activePlayerIDs = new Set<number>();

        for (const char of snapshot.characters) {
            activePlayerIDs.add(char.player_id);

            if (char.player_id === this.localPlayerID) {
                // Local player - character is created in initLocalPlayer()
                // Server reconciliation - DISABLED for mock server testing
                // Only snap if we're VERY far from server (likely just connected)
                const serverPos = new Vector3(char.position.x, char.position.y, char.position.z);
                const error = Vector3.Distance(serverPos, this.position);
                if (error > 10.0) {
                    // Only snap on initial spawn or major teleport
                    this.position.copyFrom(serverPos);
                    if (this.localCharacter) {
                        this.localCharacter.setPosition(this.position);
                    }
                    console.log('⚠️ Snapping to server position (initial spawn or teleport)');
                }
            } else {
                // Remote players - create animated character if doesn't exist
                let remoteChar = this.characters.get(char.player_id);
                if (!remoteChar && !this.loadingCharacters.has(char.player_id)) {
                    // Create remote character (async loading)
                    this.createRemoteCharacter(char.player_id, char);
                } else if (remoteChar) {
                    // Update remote character position and animation
                    const pos = new Vector3(char.position.x, char.position.y, char.position.z);
                    remoteChar.setPosition(pos);
                    remoteChar.setRotation(char.yaw);

                    // Update animation based on server state
                    this.updateRemoteAnimation(remoteChar, char.state);
                }
            }
        }

        // Remove disconnected players (those not in the current snapshot)
        const disconnectedPlayers: number[] = [];
        for (const [playerID, character] of this.characters.entries()) {
            if (!activePlayerIDs.has(playerID)) {
                disconnectedPlayers.push(playerID);
                character.dispose();
                console.log(`Remote player disconnected: ${playerID}`);
            }
        }

        // Clean up from the map and loading set
        for (const playerID of disconnectedPlayers) {
            this.characters.delete(playerID);
            this.loadingCharacters.delete(playerID);
        }
    }

    // Create a remote player character asynchronously
    private async createRemoteCharacter(playerID: number, charData: CharacterSnapshot): Promise<void> {
        // Mark as loading to prevent duplicate creation
        this.loadingCharacters.add(playerID);

        const remoteChar = new AnimatedCharacter(this.scene);

        try {
            // Load model from General.glb + movement animations from MovementBasic.glb
            await remoteChar.loadModel('/assets/Rig_Medium/', 'Rig_Medium_General.glb');
            await remoteChar.loadAnimations('/assets/Rig_Medium/', 'Rig_Medium_MovementBasic.glb');

            // Check if this player is now our local player (welcome arrived during load)
            if (playerID === this.localPlayerID) {
                console.log(`Discarding remote character - it's our local player: ${playerID}`);
                remoteChar.dispose();
                this.loadingCharacters.delete(playerID);
                return;
            }

            // Position the character
            remoteChar.setPosition(new Vector3(charData.position.x, charData.position.y, charData.position.z));
            remoteChar.setRotation(charData.yaw);

            // Store in map
            this.characters.set(playerID, remoteChar);
            console.log(`Remote player joined: ${playerID}`);

            // Start idle animation
            remoteChar.playAnimation(AnimationNames.idle, true);
        } catch (error) {
            console.error(`Failed to load remote character ${playerID}:`, error);
        } finally {
            this.loadingCharacters.delete(playerID);
        }
    }

    // Update remote player animation based on server state
    private updateRemoteAnimation(character: AnimatedCharacter, state: number): void {
        switch (state) {
            case CharacterState.Idle:
                character.playAnimation(AnimationNames.idle, true);
                break;
            case CharacterState.Moving:
                character.playAnimation(AnimationNames.run, true);
                break;
            case CharacterState.Attacking:
                character.playAnimation(AnimationNames.attack, false);
                break;
            case CharacterState.Stunned:
                character.playAnimation(AnimationNames.hit, false);
                break;
            case CharacterState.Dead:
                character.playAnimation(AnimationNames.death, false);
                break;
        }
    }

    getPosition() {
        return this.position;
    }
}

export async function initGameClient(canvas: HTMLCanvasElement, localPlayerID: number) {
    // Initialize Babylon.js (NO PHYSICS)
    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);

    // Setup camera (isometric view from the start - FIXED, no rotation)
    // Position is (X, Y, Z) where Y is up. Making it farther away for better view.
    const camera = new UniversalCamera('camera', new Vector3(30, 90, -30), scene);  // 3x farther away
    camera.setTarget(Vector3.Zero());
    // Don't attach control - we want a fixed isometric camera that only follows player
    // camera.attachControl(canvas, true); // DISABLED - no mouse control
    camera.minZ = 0.1; // Near clipping plane
    camera.maxZ = 500; // Far clipping plane - see far distances

    // Add lighting (bright, from above)
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
    light.intensity = 1.5; // Brighter lighting

    // Create ground (make it very visible)
    const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
    const groundMat = new StandardMaterial('groundMat', scene);
    groundMat.diffuseColor = Color3.FromHexString('#4CAF50'); // Green color like grass
    groundMat.specularColor = Color3.Black(); // No shine
    ground.material = groundMat;
    ground.position.y = 0; // Make sure it's at y=0

    // Add arena boundaries (walls) for visual reference
    const wallHeight = 5;
    const wallMat = new StandardMaterial('wallMat', scene);
    wallMat.diffuseColor = Color3.FromHexString('#8B4513'); // Brown walls

    // North wall
    const northWall = MeshBuilder.CreateBox('northWall', { width: 100, height: wallHeight, depth: 1 }, scene);
    northWall.position = new Vector3(0, wallHeight/2, 50);
    northWall.material = wallMat;

    // South wall
    const southWall = MeshBuilder.CreateBox('southWall', { width: 100, height: wallHeight, depth: 1 }, scene);
    southWall.position = new Vector3(0, wallHeight/2, -50);
    southWall.material = wallMat;

    // East wall
    const eastWall = MeshBuilder.CreateBox('eastWall', { width: 1, height: wallHeight, depth: 100 }, scene);
    eastWall.position = new Vector3(50, wallHeight/2, 0);
    eastWall.material = wallMat;

    // West wall
    const westWall = MeshBuilder.CreateBox('westWall', { width: 1, height: wallHeight, depth: 100 }, scene);
    westWall.position = new Vector3(-50, wallHeight/2, 0);
    westWall.material = wallMat;

    // Initialize game client
    const gameClient = new SimpleGameClient(scene, localPlayerID, camera);

    // Load animated player character
    await gameClient.initLocalPlayer();

    // Input handling
    const input: InputState = {
        movementDirection: { x: 0, y: 0, z: 0 },
        isAttacking: false,
        isJumping: false,
    };

    // Keyboard input
    const keysPressed = new Set<string>();

    scene.onKeyboardObservable.add((kbInfo) => {
        if (kbInfo.type === 1) { // KEY_DOWN
            keysPressed.add(kbInfo.event.key.toLowerCase());

            // Toggle Inspector with 'i' key
            if (kbInfo.event.key.toLowerCase() === 'i') {
                if (scene.debugLayer.isVisible()) {
                    scene.debugLayer.hide();
                } else {
                    scene.debugLayer.show();
                }
            }
        } else if (kbInfo.type === 2) { // KEY_UP
            keysPressed.delete(kbInfo.event.key.toLowerCase());
        }
    });

    // Update input each frame
    scene.onBeforeRenderObservable.add(() => {
        input.movementDirection.x = 0;
        input.movementDirection.z = 0;

        if (keysPressed.has('w')) {
            input.movementDirection.z = 1;
            console.log('W pressed - moving forward');
        }
        if (keysPressed.has('s')) {
            input.movementDirection.z = -1;
            console.log('S pressed - moving backward');
        }
        if (keysPressed.has('a')) {
            input.movementDirection.x = -1;
            console.log('A pressed - moving left');
        }
        if (keysPressed.has('d')) {
            input.movementDirection.x = 1;
            console.log('D pressed - moving right');
        }

        input.isJumping = keysPressed.has(' ');
        if (input.isJumping) console.log('Space pressed - jumping');
    });

    // Render loop
    let lastTime = performance.now();
    engine.runRenderLoop(() => {
        const now = performance.now();
        const deltaTime = (now - lastTime) / 1000;
        lastTime = now;

        gameClient.applyInput(input, deltaTime);
        scene.render();
    });

    window.addEventListener('resize', () => {
        engine.resize();
    });

    return { engine, scene, gameClient, input };
}

// Network client (same as before)
export class GameNetworkClient {
    private ws: WebSocket | null = null;
    private onSnapshotCallback: ((snapshot: GameStateSnapshot) => void) | null = null;
    private onWelcomeCallback: ((playerId: number) => void) | null = null;

    connect(url: string) {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('✅ Connected to game server');
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);

            // Handle welcome message with server-assigned player ID
            if (message.type === 'welcome') {
                console.log('📩 Received player ID from server:', message.playerId);
                if (this.onWelcomeCallback) {
                    this.onWelcomeCallback(message.playerId);
                }
            }
            // Handle game state snapshots
            else if (message.frame_number !== undefined) {
                const snapshot = message as GameStateSnapshot;
                if (this.onSnapshotCallback) {
                    this.onSnapshotCallback(snapshot);
                }
            }
        };

        this.ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('Connection closed');
        };
    }

    onWelcome(callback: (playerId: number) => void) {
        this.onWelcomeCallback = callback;
    }

    onSnapshot(callback: (snapshot: GameStateSnapshot) => void) {
        this.onSnapshotCallback = callback;
    }

    sendInput(input: InputState) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'input', input: input }));  // Changed 'data' to 'input' to match mock server
        }
    }
}

// Export AnimatedCharacter for use in other files
export { AnimatedCharacter, CharacterState };

// Test function to load a character and list animations
export async function testCharacterAnimations(scene: Scene): Promise<AnimatedCharacter> {
    console.log('🎮 Loading test character...');

    const character = new AnimatedCharacter(scene);

    // Load the base model (General usually has the mesh + basic anims)
    await character.loadModel('/assets/Rig_Medium/', 'Rig_Medium_General.glb');

    // Load movement animations
    await character.loadAnimations('/assets/Rig_Medium/', 'Rig_Medium_MovementBasic.glb');

    // List all available animations
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Available animations:');
    character.listAnimations().forEach((name, i) => {
        console.log(`   ${i + 1}. "${name}"`);
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Position the character
    character.setPosition(new Vector3(0, 0, 0));

    // Try to play an idle animation (common names)
    const idleNames = ['Idle', 'idle', 'IDLE', 'Idle_A', 'idle_A'];
    for (const name of idleNames) {
        if (character.animations.has(name)) {
            character.playAnimation(name, true);
            console.log(`▶️ Playing: "${name}"`);
            break;
        }
    }

    return character;
}
