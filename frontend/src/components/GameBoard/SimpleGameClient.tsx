// Simple game client - adapted from simple_client.ts with minimal React wrapper
import { useEffect, useRef } from 'react';
import {
    Scene, Engine, Vector3, MeshBuilder, UniversalCamera, HemisphericLight,
    StandardMaterial, Color3, SceneLoader, AnimationGroup, AbstractMesh, TransformNode
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { GameStateSnapshot, Vector3D } from '../../game/types';

// Import game assets
import generalModel from '@/assets/Rig_Medium/Rig_Medium_General.glb';
import movementBasicAnims from '@/assets/Rig_Medium/Rig_Medium_MovementBasic.glb';
import combatMeleeAnims from '@/assets/Rig_Medium/Rig_Medium_CombatMelee.glb';

// ============ COPIED FROM simple_client.ts ============

interface CharacterSnapshot {
    player_id: number;
    position: Vector3D;
    velocity: Vector3D;
    yaw: number;
    state: number;
    health: number;
    max_health: number;
}

interface InputState {
    movementDirection: Vector3D;
    isAttacking: boolean;
    isJumping: boolean;
    isSprinting: boolean;
}

enum CharacterState {
    Idle = 0,
    Moving = 1,
    Attacking = 2,
    Stunned = 4,
    Dead = 5
}

const AnimationNames = {
    idle: 'Idle_A',
    walk: 'Walking_A',
    run: 'Running_A',
    jumpStart: 'Jump_Start',
    jumpIdle: 'Jump_Idle',
    jumpLand: 'Jump_Land',
    attack: 'Melee_2H_Attack_Spinning',
    hit: 'Hit_A',
    death: 'Death_A',
    spawn: 'Spawn_Air'
};

class AnimatedCharacter {
    public rootNode: TransformNode;
    public meshes: AbstractMesh[] = [];
    public animations: Map<string, AnimationGroup> = new Map();
    private currentAnimation: AnimationGroup | null = null;
    private currentAnimationName: string = '';
    private scene: Scene;
    private skeleton: any = null;  // Store this character's skeleton

    constructor(scene: Scene) {
        this.scene = scene;
        this.rootNode = new TransformNode("character_root", scene);
    }

    async loadModel(assetUrl: string): Promise<void> {
        const result = await SceneLoader.ImportMeshAsync("", "", assetUrl, this.scene);
        result.meshes.forEach(mesh => {
            if (!mesh.parent) mesh.parent = this.rootNode;
            this.meshes.push(mesh);
        });
        result.animationGroups.forEach(anim => {
            this.animations.set(anim.name, anim);
            anim.stop();
        });
        // Store this character's skeleton
        if (result.skeletons && result.skeletons.length > 0) {
            this.skeleton = result.skeletons[0];
        }
    }

    async loadAnimations(assetUrl: string): Promise<void> {
        const result = await SceneLoader.ImportMeshAsync("", "", assetUrl, this.scene);
        // Use THIS character's skeleton, not scene.skeletons[0]!
        if (!this.skeleton) return;

        result.animationGroups.forEach(anim => {
            anim.targetedAnimations.forEach(ta => {
                const targetName = ta.target?.name;
                if (targetName) {
                    const mainBone = this.skeleton.bones.find((b: any) => b.name === targetName);
                    if (mainBone) ta.target = mainBone.getTransformNode() || mainBone;
                }
            });
            this.animations.set(anim.name, anim);
            anim.stop();
        });

        result.meshes.forEach(mesh => {
            mesh.isVisible = false;
            mesh.setEnabled(false);
        });
    }

    playAnimation(name: string, loop: boolean = true): void {
        if (this.currentAnimationName === name) return;
        const anim = this.animations.get(name);
        if (!anim) return;
        if (this.currentAnimation) this.currentAnimation.stop();
        anim.start(loop);
        this.currentAnimation = anim;
        this.currentAnimationName = name;
    }

    setPosition(pos: Vector3): void {
        this.rootNode.position.copyFrom(pos);
    }

    setRotation(yaw: number): void {
        this.rootNode.rotation.y = yaw;
    }

    dispose(): void {
        this.animations.forEach(anim => anim.stop());
        this.meshes.forEach(mesh => mesh.dispose());
        this.rootNode.dispose();
    }
}

class GameClient {
    private scene: Scene;
    private localPlayerID: number;
    private characters: Map<number, AnimatedCharacter> = new Map();
    private loadingCharacters: Set<number> = new Set();
    private localCharacter: AnimatedCharacter | null = null;
    private position: Vector3 = new Vector3(0, 1, 0);
    private velocity: Vector3 = new Vector3(0, 0, 0);
    private camera: UniversalCamera;
    private currentAnimState: string = 'idle';
    private isGrounded: boolean = true;
    private wasGrounded: boolean = true;
    private isJumping: boolean = false;

    constructor(scene: Scene, localPlayerID: number, camera: UniversalCamera) {
        this.scene = scene;
        this.localPlayerID = localPlayerID;
        this.camera = camera;
    }

    async initLocalPlayer(): Promise<void> {
        this.localCharacter = new AnimatedCharacter(this.scene);
        await this.localCharacter.loadModel(generalModel);
        await this.localCharacter.loadAnimations(movementBasicAnims);
        await this.localCharacter.loadAnimations(combatMeleeAnims);

        // Scale character up 3x to make it more visible
        this.localCharacter.rootNode.scaling.setAll(3);

        this.localCharacter.setPosition(this.position);
        this.localCharacter.playAnimation('Spawn_Air', false);
        setTimeout(() => {
            this.currentAnimState = '';
            this.playAnimation('idle');
        }, 1500);
    }

    private playAnimation(state: string, loop: boolean = true): void {
        if (this.currentAnimState === state) return;
        const animName = AnimationNames[state as keyof typeof AnimationNames];
        if (animName && this.localCharacter) {
            this.localCharacter.playAnimation(animName, loop);
            this.currentAnimState = state;
        }
    }

    private updateAnimation(input: InputState): void {
        if (!this.localCharacter) return;
        const isMoving = input.movementDirection.x !== 0 || input.movementDirection.z !== 0;
        const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

        if (this.isGrounded && !this.wasGrounded) {
            this.playAnimation('idle');
            this.isJumping = false;
        }

        if (!this.isGrounded) {
            if (!this.isJumping) {
                this.playAnimation('jumpStart', false);
                this.isJumping = true;
            }
            return;
        }

        if (input.isAttacking) {
            this.playAnimation('attack', false);
            return;
        }

        if (isMoving) {
            this.playAnimation(speed > 3.0 ? 'run' : 'walk');
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
        this.wasGrounded = this.isGrounded;

        if (input.movementDirection.x !== 0 || input.movementDirection.z !== 0) {
            const cameraForward = this.camera.getTarget().subtract(this.camera.position);
            cameraForward.y = 0;
            cameraForward.normalize();
            const cameraRight = Vector3.Cross(Vector3.Up(), cameraForward).normalize();
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

        if (input.isJumping && this.position.y <= 1.1) {
            this.velocity.y = 8.0;
            this.isGrounded = false;
        }

        if (this.position.y > 1.0) {
            this.velocity.y -= 20.0 * deltaTime;
            this.isGrounded = false;
        } else {
            this.position.y = 1.0;
            this.velocity.y = 0;
            this.isGrounded = true;
        }

        this.position.addInPlace(this.velocity.scale(deltaTime));
        this.position.x = Math.max(-49, Math.min(49, this.position.x));
        this.position.z = Math.max(-49, Math.min(49, this.position.z));

        if (this.localCharacter) this.localCharacter.setPosition(this.position);
        this.updateAnimation(input);

        const cameraOffset = new Vector3(30, 60, -30);
        this.camera.position = this.position.add(cameraOffset);
        this.camera.setTarget(this.position);
    }

    processSnapshot(snapshot: GameStateSnapshot) {
        const activePlayerIDs = new Set<number>();

        for (const char of snapshot.characters) {
            activePlayerIDs.add(char.player_id);

            if (char.player_id === this.localPlayerID) {
                // PREDICTION DISABLED - Always use server position
                const serverPos = new Vector3(char.position.x, char.position.y, char.position.z);
                this.position.copyFrom(serverPos);
                if (this.localCharacter) {
                    this.localCharacter.setPosition(this.position);
                    this.localCharacter.setRotation(char.yaw); // Use server rotation
                }

                // Update camera to follow player (adjusted for scaled characters)
                const cameraOffset = new Vector3(30, 40, -30);
                this.camera.position = this.position.add(cameraOffset);
                this.camera.setTarget(this.position);
            } else {
                let remoteChar = this.characters.get(char.player_id);
                if (!remoteChar && !this.loadingCharacters.has(char.player_id)) {
                    this.createRemoteCharacter(char.player_id, char);
                } else if (remoteChar) {
                    const pos = new Vector3(char.position.x, char.position.y, char.position.z);
                    remoteChar.setPosition(pos);
                    remoteChar.setRotation(char.yaw);
                    this.updateRemoteAnimation(remoteChar, char.state, char.velocity);
                }
            }
        }

        const disconnectedPlayers: number[] = [];
        for (const [playerID, character] of this.characters.entries()) {
            if (!activePlayerIDs.has(playerID)) {
                disconnectedPlayers.push(playerID);
                character.dispose();
            }
        }
        for (const playerID of disconnectedPlayers) {
            this.characters.delete(playerID);
            this.loadingCharacters.delete(playerID);
        }
    }

    private async createRemoteCharacter(playerID: number, charData: CharacterSnapshot): Promise<void> {
        this.loadingCharacters.add(playerID);
        const remoteChar = new AnimatedCharacter(this.scene);
        try {
            await remoteChar.loadModel(generalModel);
            await remoteChar.loadAnimations(movementBasicAnims);
            await remoteChar.loadAnimations(combatMeleeAnims);

            // Scale character up 3x to make it more visible
            remoteChar.rootNode.scaling.setAll(3);

            if (playerID === this.localPlayerID) {
                remoteChar.dispose();
                this.loadingCharacters.delete(playerID);
                return;
            }
            remoteChar.setPosition(new Vector3(charData.position.x, charData.position.y, charData.position.z));
            remoteChar.setRotation(charData.yaw);
            this.characters.set(playerID, remoteChar);
            remoteChar.playAnimation(AnimationNames.idle, true);
        } catch (error) {
            console.error(`Failed to load remote character ${playerID}:`, error);
        } finally {
            this.loadingCharacters.delete(playerID);
        }
    }

    private updateRemoteAnimation(character: AnimatedCharacter, state: number, velocity: Vector3D): void {
        switch (state) {
            case CharacterState.Idle:
                character.playAnimation(AnimationNames.idle, true);
                break;
            case CharacterState.Moving:
                // Calculate horizontal speed from velocity
                const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
                // Use run animation if speed > 10 (sprinting), walk otherwise
                character.playAnimation(speed > 10 ? AnimationNames.run : AnimationNames.walk, true);
                break;
            case CharacterState.Attacking:
                console.log('Playing attack for remote:', AnimationNames.attack, 'Available:', Array.from(character.animations.keys()));
                character.playAnimation(AnimationNames.attack, true);
                break;
            case CharacterState.Stunned:
                character.playAnimation(AnimationNames.hit, false);
                break;
            case CharacterState.Dead:
                character.playAnimation(AnimationNames.death, false);
                break;
        }
    }

    // Simple animation update based on input only (no velocity needed)
    updateLocalAnimation(input: InputState): void {
        if (!this.localCharacter) return;

        const isMoving = input.movementDirection.x !== 0 || input.movementDirection.z !== 0;

        if (input.isAttacking) {
            this.playAnimation('attack', true);  // Loop continuously while attacking
            return;
        }

        if (isMoving) {
            // Use run animation when sprinting, walk otherwise
            this.playAnimation(input.isSprinting ? 'run' : 'walk');
        } else {
            this.playAnimation('idle');
        }
    }
}

// ============ MINIMAL REACT WRAPPER ============

interface Props {
    snapshot: GameStateSnapshot | null;
    onSendInput: (movement: Vector3D, lookDirection: Vector3D, attacking: boolean, jumping: boolean, sprinting: boolean) => void;
    localPlayerId: number | undefined;
}

export default function SimpleGameClient({ snapshot, onSendInput, localPlayerId }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameClientRef = useRef<GameClient | null>(null);
    const engineRef = useRef<Engine | null>(null);

    // Initialize once
    useEffect(() => {
        if (!canvasRef.current || !localPlayerId) return;

        const canvas = canvasRef.current;
        const engine = new Engine(canvas, true);
        const scene = new Scene(engine);
        engineRef.current = engine;

        // Setup camera - FIXED: Look at arena center (50, 0, 50)
        // Adjusted closer for better view of scaled-up characters
        const camera = new UniversalCamera('camera', new Vector3(80, 60, 20), scene);
        camera.setTarget(new Vector3(50, 0, 50));
        camera.minZ = 0.1;
        camera.maxZ = 500;

        // Lighting
        const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
        light.intensity = 1.5;

        // Ground - FIXED: Match server coordinate system (0-100, not -50 to +50)
        const ground = MeshBuilder.CreateGround('ground', { width: 100, height: 100 }, scene);
        ground.position = new Vector3(50, 0, 50); // Center at (50, 0, 50)
        const groundMat = new StandardMaterial('groundMat', scene);
        groundMat.diffuseColor = Color3.FromHexString('#4CAF50');
        groundMat.specularColor = Color3.Black();
        ground.material = groundMat;

        // Walls - FIXED: Match server coordinate system (0-100)
        const wallHeight = 5;
        const wallMat = new StandardMaterial('wallMat', scene);
        wallMat.diffuseColor = Color3.FromHexString('#8B4513');

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

        // Game client
        const gameClient = new GameClient(scene, localPlayerId, camera);
        gameClientRef.current = gameClient;
        gameClient.initLocalPlayer();

        // Input
        const input: InputState = {
            movementDirection: { x: 0, y: 0, z: 0 },
            isAttacking: false,
            isJumping: false,
            isSprinting: false,
        };
        const keysPressed = new Set<string>();

        scene.onKeyboardObservable.add((kbInfo) => {
            if (kbInfo.type === 1) keysPressed.add(kbInfo.event.key.toLowerCase());
            else if (kbInfo.type === 2) keysPressed.delete(kbInfo.event.key.toLowerCase());
        });

        scene.onBeforeRenderObservable.add(() => {
            input.movementDirection.x = 0;
            input.movementDirection.z = 0;
            if (keysPressed.has('w')) input.movementDirection.z = 1;
            if (keysPressed.has('s')) input.movementDirection.z = -1;
            if (keysPressed.has('a')) input.movementDirection.x = -1;
            if (keysPressed.has('d')) input.movementDirection.x = 1;
            input.isJumping = keysPressed.has(' ');
            input.isAttacking = keysPressed.has('e');
            input.isSprinting = keysPressed.has('shift'); // Hold Shift to sprint

            // Update animations based on input
            gameClient.updateLocalAnimation(input);
        });

        // Render loop
        let lastInputSend = 0;
        engine.runRenderLoop(() => {
            const now = performance.now();

            // PREDICTION DISABLED - Only use server positions
            // gameClient.applyInput(input, deltaTime);

            // Send input to server (throttled to 20/sec)
            if (now - lastInputSend >= 50) {
                // Use movement direction as look direction so character faces where they move
                const lookDir = input.movementDirection.x !== 0 || input.movementDirection.z !== 0
                    ? input.movementDirection
                    : { x: 0, y: 0, z: 1 }; // Default forward when not moving
                onSendInput(input.movementDirection, lookDir, input.isAttacking, input.isJumping, input.isSprinting);
                lastInputSend = now;
            }

            scene.render();
        });

        window.addEventListener('resize', () => engine.resize());

        return () => {
            engine.stopRenderLoop();
            scene.dispose();
            engine.dispose();
        };
    }, [localPlayerId]);

    // Process snapshots
    useEffect(() => {
        if (snapshot && gameClientRef.current) {
            gameClientRef.current.processSnapshot(snapshot);
        }
    }, [snapshot]);

    return <canvas ref={canvasRef} style={{ width: '100%', height: '100vh', display: 'block' }} />;
}
