import knightModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Knight.glb';
import rogueModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Rogue.glb';
import barbarianModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Barbarian.glb';
import rangerModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Ranger.glb';
import mageModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Mage.glb';
import rogueHoodedModel from '@/assets/KayKit_Adventurers_2.0_FREE/Characters/gltf/Rogue_Hooded.glb';
import generalAnims from '@/assets/Rig_Medium/Rig_Medium_General.glb';
import movementBasicAnims from '@/assets/Rig_Medium/Rig_Medium_MovementBasic.glb';
import combatMeleeAnims from '@/assets/Rig_Medium/Rig_Medium_CombatMelee.glb';
import swordModel from '@/assets/KayKit_Adventurers_2.0_FREE/Assets/gltf/sword_1handed.glb';
import shieldModel from '@/assets/KayKit_Adventurers_2.0_FREE/Assets/gltf/shield_badge_color.glb';
import daggerModel from '@/assets/KayKit_Adventurers_2.0_FREE/Assets/gltf/dagger.glb';

export type CharacterChoice = 'Knight' | 'Rogue' | 'Barbarian' | 'Ranger' | 'Mage' | 'RogueHooded';
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

export interface AnimationEntry {
	name: string;
	speed?: number;  // playback speed multiplier (default 1.0)
}

export interface TrailColor {
	base: [number, number, number]; // RGB 0–255, color at the tail end (oldest point)
	tip: [number, number, number];  // RGB 0–255, color at the weapon end (newest point, most visible)
	maxWidth: number;               // ribbon half-width in world units at the weapon end
	tailOpacity: number;            // opacity of the tail end (0.0 = invisible, 1.0 = fully opaque) — controls how visible the base color is
	tipOpacity: number;             // opacity of the weapon end (0.0 = invisible, 1.0 = fully opaque) — keep below 1.0 for a translucent feel
}

export interface CharacterConfig {
	label: string;
	characterClass: string;
	locked?: boolean;
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
		previewBgColor: '#1cc0d3',
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
		trailColor: { base: [220, 235, 255], tip: [100, 165, 255], maxWidth: 0.3, tailOpacity: 0.13, tipOpacity: 0.85 },
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
			{ model: daggerModel, bone: 'handslot.r', rotation: [0, Math.PI, 0] },
			{ model: daggerModel, bone: 'handslot.l' },
		],
		scale: 1,
		previewBgColor: '#20c259',
		idleAnimation:    { name: 'Idle_A' },
		walkAnimation:    { name: 'Walking_B' },
		runAnimation:     { name: 'Running_B', speed: 1.2 },
		attackAnimations: [{ name: 'Melee_Dualwield_Attack_Chop', speed: 1.4 }],  // placeholder
		skillAnimations:  [{ name: 'Melee_Dualwield_Attack_Chop', speed: 1.4 }],  // placeholder
		trailColor: { base: [102, 187, 106], tip: [200, 255, 200], maxWidth: 0.3, tailOpacity: 0.13, tipOpacity: 0.85 },
		stats: { attack: 9, defense: 4, speed: 10, health: 6 },
		description: 'High burst damage. Glass cannon. Hit and run.',
		weapons: ['Dagger (R)', 'Dagger (L)'],
	},
	Barbarian: {
		label: 'Barbarian',
		characterClass: 'Berserker',
		locked: true,
		model: barbarianModel,
		animationSets: [generalAnims, movementBasicAnims, combatMeleeAnims],
		equipment: [],
		scale: 1,
		previewBgColor: '#c45c2c',
		idleAnimation:    { name: 'Idle_A' },
		walkAnimation:    { name: 'Walking_B' },
		runAnimation:     { name: 'Running_B' },
		attackAnimations: [{ name: 'Melee_Dualwield_Attack_Chop' }],
		skillAnimations:  [{ name: 'Melee_Dualwield_Attack_Chop' }],
		trailColor: { base: [255, 140, 60], tip: [255, 80, 30], maxWidth: 0.35, tailOpacity: 0.15, tipOpacity: 0.9 },
		stats: { attack: 10, defense: 6, speed: 5, health: 8 },
		description: 'Reckless brawler. Raw damage, low finesse.',
		weapons: ['Greataxe'],
	},
	Ranger: {
		label: 'Ranger',
		characterClass: 'Marksman',
		locked: true,
		model: rangerModel,
		animationSets: [generalAnims, movementBasicAnims, combatMeleeAnims],
		equipment: [],
		scale: 1,
		previewBgColor: '#8b6d2e',
		idleAnimation:    { name: 'Idle_A' },
		walkAnimation:    { name: 'Walking_B' },
		runAnimation:     { name: 'Running_B' },
		attackAnimations: [{ name: 'Melee_1H_Attack_Slice_Diagonal' }],
		skillAnimations:  [{ name: 'Melee_1H_Attack_Slice_Diagonal' }],
		trailColor: { base: [180, 160, 80], tip: [240, 220, 140], maxWidth: 0.25, tailOpacity: 0.1, tipOpacity: 0.8 },
		stats: { attack: 8, defense: 3, speed: 8, health: 5 },
		description: 'Ranged kiter. High mobility, fragile up close.',
		weapons: ['Bow'],
	},
	Mage: {
		label: 'Mage',
		characterClass: 'Battlemage',
		locked: true,
		model: mageModel,
		animationSets: [generalAnims, movementBasicAnims, combatMeleeAnims],
		equipment: [],
		scale: 1,
		previewBgColor: '#7b3fa0',
		idleAnimation:    { name: 'Idle_A' },
		walkAnimation:    { name: 'Walking_B' },
		runAnimation:     { name: 'Running_B' },
		attackAnimations: [{ name: 'Melee_1H_Attack_Slice_Diagonal' }],
		skillAnimations:  [{ name: 'Melee_1H_Attack_Slice_Diagonal' }],
		trailColor: { base: [160, 80, 220], tip: [220, 140, 255], maxWidth: 0.3, tailOpacity: 0.12, tipOpacity: 0.85 },
		stats: { attack: 8, defense: 5, speed: 6, health: 7 },
		description: 'Hybrid caster. Melee and magic, jack of all trades.',
		weapons: ['Staff', 'Spells'],
	},
	RogueHooded: {
		label: 'Shadow',
		characterClass: 'Nightblade',
		locked: true,
		model: rogueHoodedModel,
		animationSets: [generalAnims, movementBasicAnims, combatMeleeAnims],
		equipment: [],
		scale: 1,
		previewBgColor: '#2a4a3a',
		idleAnimation:    { name: 'Idle_A' },
		walkAnimation:    { name: 'Walking_B' },
		runAnimation:     { name: 'Running_B', speed: 1.1 },
		attackAnimations: [{ name: 'Melee_Dualwield_Attack_Chop', speed: 1.3 }],
		skillAnimations:  [{ name: 'Melee_Dualwield_Attack_Chop', speed: 1.3 }],
		trailColor: { base: [60, 120, 80], tip: [140, 220, 160], maxWidth: 0.25, tailOpacity: 0.1, tipOpacity: 0.8 },
		stats: { attack: 9, defense: 3, speed: 9, health: 5 },
		description: 'Silent killer. Stealth and poison, high risk high reward.',
		weapons: ['Poison Blade', 'Throwing Knives'],
	},
};
