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

export interface CharacterConfig {
	label: string;
	model: string;
	animationSets: string[];
	equipment: EquipmentSlot[];
	scale: number;
	previewBgColor: string;
	idleAnimation: string;
	attackAnimations: string[];  // [stage0, stage1, stage2, ...] — index = chain stage
	skillAnimations:  string[];  // [skill1anim, skill2anim] — index = slot - 1
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
		idleAnimation: 'Idle_A',
		attackAnimations: [
			'Melee_1H_Attack_Slice_Diagonal',    // stage 0
			'Melee_1H_Attack_Slice_Horizontal',  // stage 1
			'Melee_1H_Attack_Stab',              // stage 2
		],
		skillAnimations: [
			'Melee_1H_Attack_Jump_Chop',  // skill1
			'Melee_1H_Attack_Chop',       // skill2 — placeholder; replace with a distinct anim later
		],
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
		idleAnimation: 'Idle_A',
		attackAnimations: ['Melee_Dualwield_Attack_Chop'],  // placeholder until Rogue chain is designed
		skillAnimations:  ['Melee_Dualwield_Attack_Chop'],  // placeholder
	},
};
