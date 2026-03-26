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
	model: string; // character skin GLB (Vite URL)
	animationSets: string[]; // animation GLBs loaded in order
	equipment: EquipmentSlot[];
	scale: number; // rootNode.scaling.setAll(scale) in-game
	previewBgColor: string;
	idleAnimation: string; // animation name to play in preview
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
	},
};
