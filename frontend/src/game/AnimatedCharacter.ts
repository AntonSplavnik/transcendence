import type { AbstractMesh, AnimationGroup, Scene, Observer } from '@babylonjs/core';
import { Color3, SceneLoader, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { CharacterConfig } from './characterConfigs';
import { SwingTrail } from './SwingTrail';

export class AnimatedCharacter {
	public rootNode: TransformNode;
	public meshes: AbstractMesh[] = [];
	public animations: Map<string, AnimationGroup> = new Map();
	public trail: SwingTrail | null = null;
	public currentAnimation: AnimationGroup | null = null;
	private currentAnimationName: string = '';
	private scene: Scene;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private skeleton: any = null;
	private blendObserver: Observer<Scene> | null = null;
	private fadingOutAnim: AnimationGroup | null = null;
	private equipmentMeshes: AbstractMesh[] = [];

	constructor(scene: Scene) {
		this.scene = scene;
		this.rootNode = new TransformNode('character_root', scene);
	}

	async loadModel(assetUrl: string): Promise<void> {
		const result = await SceneLoader.ImportMeshAsync('', '', assetUrl, this.scene);
		result.meshes.forEach((mesh) => {
			if (!mesh.parent) mesh.parent = this.rootNode;
			this.meshes.push(mesh);
		});
		result.animationGroups.forEach((anim) => {
			this.animations.set(anim.name, anim);
			anim.stop();
		});
		if (result.skeletons && result.skeletons.length > 0) {
			this.skeleton = result.skeletons[0];
		}
	}

	async loadAnimations(assetUrl: string): Promise<void> {
		const result = await SceneLoader.ImportMeshAsync('', '', assetUrl, this.scene);
		if (!this.skeleton) return;

		result.animationGroups.forEach((anim) => {
			anim.targetedAnimations.forEach((ta) => {
				const targetName = ta.target?.name;
				if (targetName) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const mainBone = this.skeleton.bones.find((b: any) => b.name === targetName);
					if (mainBone) ta.target = mainBone.getTransformNode() || mainBone;
				}
			});
			this.animations.set(anim.name, anim);
			anim.stop();
		});

		result.meshes.forEach((mesh) => {
			mesh.isVisible = false;
			mesh.setEnabled(false);
		});
	}

	async attachToBone(
		assetUrl: string,
		boneName: string,
		position?: Vector3,
		rotation?: Vector3,
	): Promise<void> {
		const result = await SceneLoader.ImportMeshAsync('', '', assetUrl, this.scene);
		if (!this.skeleton) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bone = this.skeleton.bones.find((b: any) => b.name === boneName);
		if (!bone) return;
		const parentMesh = this.meshes.find((m) => m.skeleton === this.skeleton) || this.meshes[0];
		result.meshes.forEach((mesh) => {
			this.meshes.push(mesh);
			if (mesh.name === '__root__') return;
			mesh.attachToBone(bone, parentMesh);
			mesh.rotationQuaternion = null; // glTF sets quaternion which overrides .rotation
			if (position) mesh.position.copyFrom(position);
			else mesh.position.set(0, 0, 0);
			if (rotation) mesh.rotation.copyFrom(rotation);
			else mesh.rotation.set(0, 0, 0);
			mesh.scaling.set(1, 1, 1);
			this.equipmentMeshes.push(mesh);
		});
	}

	get animationName(): string { return this.currentAnimationName; }

	playAnimation(name: string, loop: boolean = true, speedRatio: number = 1.0): void {
		if (this.currentAnimationName === name && this.currentAnimation?.isPlaying) return;
		const anim = this.animations.get(name);
		if (!anim) {
			console.warn(`[playAnimation] "${name}" not found. Available:`, [
				...this.animations.keys(),
			]);
			return;
		}
		this.cancelBlend();
		if (this.currentAnimation) this.currentAnimation.stop();
		anim.start(loop, speedRatio);
		anim.setWeightForAllAnimatables(1.0);
		this.currentAnimation = anim;
		this.currentAnimationName = name;
	}

	/**
	 * Crossfade from the current animation into a new one.
	 * Both animations play simultaneously while weights interpolate
	 * over `blendDuration` seconds.
	 */
	crossFadeTo(name: string, loop: boolean, speedRatio: number = 1.0, blendDuration: number = 0.12): void {
		if (this.currentAnimationName === name && this.currentAnimation?.isPlaying) return;
		const anim = this.animations.get(name);
		if (!anim) {
			console.warn(`[crossFadeTo] "${name}" not found. Available:`, [
				...this.animations.keys(),
			]);
			return;
		}

		// Clean up any in-progress blend
		this.cancelBlend();

		const outgoing = this.currentAnimation;

		// Start incoming at weight 0
		anim.start(loop, speedRatio);
		anim.setWeightForAllAnimatables(0.0);
		this.currentAnimation = anim;
		this.currentAnimationName = name;

		if (!outgoing || blendDuration <= 0) {
			// No previous animation or instant switch
			if (outgoing) outgoing.stop();
			anim.setWeightForAllAnimatables(1.0);
			return;
		}

		this.fadingOutAnim = outgoing;
		let elapsed = 0;

		this.blendObserver = this.scene.onBeforeRenderObservable.add(() => {
			const dt = this.scene.getEngine().getDeltaTime() / 1000;
			elapsed += dt;
			const t = Math.min(elapsed / blendDuration, 1.0);

			anim.setWeightForAllAnimatables(t);
			outgoing.setWeightForAllAnimatables(1.0 - t);

			if (t >= 1.0) {
				outgoing.stop();
				this.cancelBlend();
			}
		});
	}

	private cancelBlend(): void {
		if (this.blendObserver) {
			this.scene.onBeforeRenderObservable.remove(this.blendObserver);
			this.blendObserver = null;
		}
		if (this.fadingOutAnim) {
			this.fadingOutAnim.stop();
			this.fadingOutAnim = null;
		}
	}

	initTrail(config: CharacterConfig): void {
		const { base, tip, maxWidth } = config.trailColor;
		this.trail = new SwingTrail(this.scene, {
			baseColor: new Color3(base[0] / 255, base[1] / 255, base[2] / 255),
			tipColor:  new Color3(tip[0]  / 255, tip[1]  / 255, tip[2]  / 255),
			maxWidth,
		});
	}

	// Returns the world-space position of the right-hand weapon tip.
	// Uses the weapon mesh bounding box to find the tip (farthest point from grip).
	// Falls back to the handslot.r bone position if no equipment mesh is loaded yet.
	getWeaponWorldPos(): Vector3 | null {
		if (this.equipmentMeshes.length > 0) {
			const mesh = this.equipmentMeshes[0];
			const bb = mesh.getBoundingInfo().boundingBox;
			const grip = mesh.getAbsolutePosition();
			// The tip is whichever extreme of the AABB is farthest from the grip origin.
			const toMax = bb.maximumWorld.subtract(grip).length();
			const toMin = bb.minimumWorld.subtract(grip).length();
			return (toMax >= toMin ? bb.maximumWorld : bb.minimumWorld).clone();
		}
		// Fallback: read grip position from handslot.r bone.
		if (!this.skeleton) return null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const bone = this.skeleton.bones.find((b: any) => b.name === 'handslot.r');
		if (!bone) return null;
		const node = bone.getTransformNode?.();
		if (node) return node.getAbsolutePosition().clone();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const m = (bone as any).getAbsoluteTransform?.()?.m;
		if (m) return new Vector3(m[12], m[13], m[14]);
		return null;
	}

	setPosition(pos: Vector3): void {
		this.rootNode.position.copyFrom(pos);
	}

	setRotation(yaw: number): void {
		this.rootNode.rotation.y = yaw;
	}

	dispose(): void {
		this.cancelBlend();
		this.trail?.dispose();
		this.animations.forEach((anim) => anim.stop());
		this.equipmentMeshes.forEach((mesh) => mesh.dispose());
		this.meshes.forEach((mesh) => mesh.dispose());
		this.rootNode.dispose();
	}
}

export async function loadCharacter(
	char: AnimatedCharacter,
	config: CharacterConfig,
): Promise<void> {
	await char.loadModel(config.model);
	for (const animSet of config.animationSets) {
		await char.loadAnimations(animSet);
	}
	for (const slot of config.equipment) {
		const pos = slot.position
			? new Vector3(slot.position[0], slot.position[1], slot.position[2])
			: undefined;
		const rot = slot.rotation
			? new Vector3(slot.rotation[0], slot.rotation[1], slot.rotation[2])
			: undefined;
		await char.attachToBone(slot.model, slot.bone, pos, rot);
	}
	char.rootNode.scaling.setAll(config.scale);
}
