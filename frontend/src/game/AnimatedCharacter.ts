import type { AbstractMesh, AnimationGroup, Scene } from '@babylonjs/core';
import { SceneLoader, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { CharacterConfig } from './characterConfigs';

export class AnimatedCharacter {
	public rootNode: TransformNode;
	public meshes: AbstractMesh[] = [];
	public animations: Map<string, AnimationGroup> = new Map();
	private currentAnimation: AnimationGroup | null = null;
	private currentAnimationName: string = '';
	private scene: Scene;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private skeleton: any = null;

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
			if (mesh.name === '__root__') return;
			mesh.attachToBone(bone, parentMesh);
			mesh.rotationQuaternion = null; // glTF sets quaternion which overrides .rotation
			if (position) mesh.position.copyFrom(position);
			else mesh.position.set(0, 0, 0);
			if (rotation) mesh.rotation.copyFrom(rotation);
			else mesh.rotation.set(0, 0, 0);
			mesh.scaling.set(1, 1, 1);
		});
	}

	playAnimation(name: string, loop: boolean = true): void {
		if (this.currentAnimationName === name && this.currentAnimation?.isPlaying) return;
		const anim = this.animations.get(name);
		if (!anim) {
			console.warn(`[playAnimation] "${name}" not found. Available:`, [
				...this.animations.keys(),
			]);
			return;
		}
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
		this.animations.forEach((anim) => anim.stop());
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
