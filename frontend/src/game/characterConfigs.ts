import knightModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Knight.glb';
import rogueModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Rogue.glb';
import generalAnims from '@/assets/Rig_Medium/Rig_Medium_General.glb';
import movementBasicAnims from '@/assets/Rig_Medium/Rig_Medium_MovementBasic.glb';
import combatMeleeAnims from '@/assets/Rig_Medium/Rig_Medium_CombatMelee.glb';
import swordModel from '@/assets/KayKit_Adventurers_2.0_FREE/Assets/gltf/sword_1handed.glb';
import shieldModel from '@/assets/KayKit_Adventurers_2.0_FREE/Assets/gltf/shield_badge_color.glb';
import daggerModel from '@/assets/KayKit_Adventurers_2.0_FREE/Assets/gltf/dagger.glb';

export type CharacterChoice = 'Knight' | 'Rogue';
export const DEFAULT_CHARACTER: CharacterChoice = 'Knight';

export interface EquipmentSlot {
	model: string;
	bone: string;
	position?: [number, number, number]; // bone-local XYZ offset
	rotation?: [number, number, number]; // bone-local XYZ rotation (radians)
}

export interface AnimationEntry {
	name: string;
	speed?: number;  // playback speed multiplier (default 1.0)
}

export interface TrailColor {
	base: [number, number, number]; // RGB 0–255, tail end (transparent)
	tip: [number, number, number];  // RGB 0–255, weapon end (bright)
	maxWidth: number;               // ribbon half-width in world units
}

export interface CharacterConfig {
	label: string;
	model: string;
	animationSets: string[];
	equipment: EquipmentSlot[];
	scale: number;
	previewBgColor: string;
	idleAnimation:    AnimationEntry;
	walkAnimation:    AnimationEntry;
	runAnimation:     AnimationEntry;
	attackAnimations: AnimationEntry[];  // [stage0, stage1, stage2, ...] — index = chain stage
	skillAnimations:  AnimationEntry[];  // [skill1anim, skill2anim] — index = slot - 1
	trailColor: TrailColor;
}

export const CHARACTER_CONFIGS: Record<CharacterChoice, CharacterConfig> = {
	Knight: {
		label: 'Knight',
		model: knightModel,
		animationSets: [generalAnims, movementBasicAnims, combatMeleeAnims],
		equipment: [
			{ model: swordModel, bone: 'handslot.r' },
			{ model: shieldModel, bone: 'handslot.l', position: [0, 0, 0.2] },
		],
		scale: 1,
		previewBgColor: '#18a880',
		idleAnimation:  { name: 'Idle_A' },
		walkAnimation:  { name: 'Walking_B', speed: 0.9 },
		runAnimation:   { name: 'Running_B' },
		attackAnimations: [
			{ name: 'Melee_1H_Attack_Slice_Diagonal' },       // stage 0
			{ name: 'Melee_1H_Attack_Slice_Horizontal' },     // stage 1
			{ name: 'Melee_1H_Attack_Stab', speed: 0.9 },     // stage 2 — heavy finisher
		],
		skillAnimations: [
			{ name: 'Melee_1H_Attack_Jump_Chop' },   // skill1
			{ name: 'Melee_1H_Attack_Chop' },         // skill2 — placeholder
		],
		trailColor: { base: [79, 195, 247], tip: [255, 255, 255], maxWidth: 0.3 },
	},
	Rogue: {
		label: 'Rogue',
		model: rogueModel,
		animationSets: [generalAnims, movementBasicAnims, combatMeleeAnims],
		equipment: [
			{ model: daggerModel, bone: 'handslot.r', rotation: [0, 3.14, 0] },
			{ model: daggerModel, bone: 'handslot.l' },
		],
		scale: 1,
		previewBgColor: '#582880',
		idleAnimation:    { name: 'Idle_A' },
		walkAnimation:    { name: 'Walking_B' },
		runAnimation:     { name: 'Running_B', speed: 1.2 },
		attackAnimations: [{ name: 'Melee_Dualwield_Attack_Chop', speed: 1.4 }],  // placeholder
		skillAnimations:  [{ name: 'Melee_Dualwield_Attack_Chop', speed: 1.4 }],  // placeholder
		trailColor: { base: [102, 187, 106], tip: [200, 255, 200], maxWidth: 0.3 },
	},
};
