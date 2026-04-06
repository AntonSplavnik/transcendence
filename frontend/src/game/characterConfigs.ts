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
	position?: [number, number, number];
	rotation?: [number, number, number];
}

/** Mirrors server-side character stat values (1–10 scale). */
export interface CharacterStatValues {
	attack: number;
	defense: number;
	speed: number;
	health: number;
}

export interface CharacterConfig {
	label: string;
	characterClass: string;
	model: string;
	animationSets: string[];
	equipment: EquipmentSlot[];
	scale: number;
	previewBgColor: string;
	idleAnimation: string;
	/** Mirrors server-side stats. Hardcoded until server exposes a config endpoint. */
	stats: CharacterStatValues;
	/** Short playstyle description shown in character selector. */
	description: string;
	/** Human-readable weapon names shown in character selector. */
	weapons: string[];
}

export const CHARACTER_CONFIGS: Record<CharacterChoice, CharacterConfig> = {
	Knight: {
		label: 'Knight',
		characterClass: 'Warrior',
		model: knightModel,
		animationSets: [generalAnims, movementBasicAnims, combatMeleeAnims],
		equipment: [
			{ model: swordModel, bone: 'handslot.r' },
			{ model: shieldModel, bone: 'handslot.l', position: [0, 0, 0.2] },
		],
		scale: 1,
		previewBgColor: '#18a880',
		idleAnimation: 'Idle_A',
		stats: { attack: 7, defense: 9, speed: 4, health: 10 },
		description: 'Durable front-liner. High armor, slow movement.',
		weapons: ['Sword', 'Shield'],
	},
	Rogue: {
		label: 'Rogue',
		characterClass: 'Assassin',
		model: rogueModel,
		animationSets: [generalAnims, movementBasicAnims, combatMeleeAnims],
		equipment: [
			{ model: daggerModel, bone: 'handslot.r', rotation: [0, 3.14, 0] },
			{ model: daggerModel, bone: 'handslot.l' },
		],
		scale: 1,
		previewBgColor: '#582880',
		idleAnimation: 'Idle_A',
		stats: { attack: 9, defense: 4, speed: 10, health: 6 },
		description: 'High burst damage. Glass cannon. Hit and run.',
		weapons: ['Dagger (R)', 'Dagger (L)'],
	},
};
