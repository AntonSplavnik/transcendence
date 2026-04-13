#pragma once

#include "CharacterPreset.hpp"
#include <string>

namespace ArenaGame {
namespace Presets {

	// ── Player characters ──────────────────────────────────────────────
	inline const CharacterPreset KNIGHT = {
		.health = {
			.maxHealth  = 180.0f,
			.armor      = 5.0f,
			.resistance = 0.1f,
		},
		.movement = {
			.movementSpeed    = 1.5f,
			.rotationSpeed    = 12.0f,  // ~130ms for a 90° turn — heavy but not snappy
			.sprintMultiplier = 2.5f,   // heavy armor limits sprint
			.crouchMultiplier = 0.4f,   // slow crouch
			.jumpVelocity     = 5.0f,   // low jump — armored
			.dodgeVelocity    = 7.0f,   // slow dodge — armored
			.airControlFactor = 0.1f,   // poor air control
			.acceleration     = 18.0f,  // ~80ms to walk, ~210ms to sprint
			.deceleration     = 25.0f,  // ~60ms walk stop, ~150ms sprint slide
			.mass             = 90.0f,
			.friction         = 0.9f,   // high friction — doesn't slide
			.drag             = 0.0f,
			.maxSpeed         = 8.0f,
			.maxFallSpeed     = 60.0f,  // heavy — falls fast
		},
		.collider = {
			.radius = 0.45f,
			.height = 1.9f,            // tall with armor
		},
		.stamina = {
			.maxStamina        = 100.0f,
			.baseRegenRate     = 40.0f,    // effective: 4.0/s (10% floor) to 40.0/s
			.drainDelaySeconds = 1.5f,     // pause after full depletion
			.sprintCostPerSec  = 15.0f,    // ~6.6s of continuous sprint
			.jumpCost          = 8.0f,     // ~12 jumps from full
		},
		.combat = {
			.baseDamage         = 18.0f,
			.damageMultiplier   = 1.0f,
			.criticalChance     = 0.15f,
			.criticalMultiplier = 1.5f,
			.attackChain = {
				// Stage 0 — diagonal slice: quick opener
				{ .damageMultiplier=0.8f, .range=3.0f, .duration=0.45f,
				  .movementMultiplier=0.0f, .chainWindow=0.6f, .staminaCost=10.0f },
				// Stage 1 — horizontal slice: mid combo
				{ .damageMultiplier=0.9f, .range=3.0f, .duration=0.50f,
				  .movementMultiplier=0.0f, .chainWindow=0.5f, .staminaCost=15.0f },
				// Stage 2 — stab: heavy finisher, chain resets (chainWindow=0)
				{ .damageMultiplier=1.6f, .range=3.0f, .duration=0.60f,
				  .movementMultiplier=0.0f, .chainWindow=0.0f, .staminaCost=25.0f },
			},
			.skill1 = { .params = MeleeAOE{ .range=4.0f, .movementMultiplier=0.0f, .dmgMultiplier=1.8f },
			            .cooldown=5.0f, .castDuration=0.7f, .staminaCost=20.0f },
			.skill2 = { .params = MeleeAOE{ .range=4.0f, .movementMultiplier=0.7f, .dmgMultiplier=1.5f },
			            .cooldown=10.0f, .castDuration=0.5f, .staminaCost=30.0f },
		},
	};

	inline const CharacterPreset BARBARIAN = {
		.health = {
			.maxHealth  = 150.0f,
			.armor      = 2.0f,
			.resistance = 0.05f,
		},
		.movement = {
			.movementSpeed    = 1.7f,
			.rotationSpeed    = 14.0f,  // ~100ms for a 90° turn — mid-weight
			.sprintMultiplier = 2.7f,   // moderate sprint
			.crouchMultiplier = 0.5f,
			.jumpVelocity     = 6.0f,   // decent jump
			.dodgeVelocity    = 8.0f,   // short dodge — relies on aggression, not evasion
			.airControlFactor = 0.2f,   // moderate air control
			.acceleration     = 20.0f,  // ~65ms to walk, ~170ms to sprint
			.deceleration     = 22.0f,  // ~55ms walk stop, ~175ms sprint slide — carries momentum
			.mass             = 85.0f,
			.friction         = 0.8f,   // slight slide on stop
			.drag             = 0.0f,
			.maxSpeed         = 9.0f,
			.maxFallSpeed     = 58.0f,
		},
		.collider = {
			.radius = 0.45f,
			.height = 1.85f,           // big frame, slightly shorter than knight
		},
		.stamina = {
			.maxStamina        = 110.0f,
			.baseRegenRate     = 45.0f,    // effective: 4.5/s (10% floor) to 45.0/s
			.drainDelaySeconds = 1.2f,     // medium recovery window
			.sprintCostPerSec  = 12.0f,    // ~9s of continuous sprint
			.jumpCost          = 7.0f,     // ~15 jumps from full
		},
		.combat = {
			.baseDamage         = 25.0f,
			.damageMultiplier   = 1.0f,
			.criticalChance     = 0.20f,
			.criticalMultiplier = 1.8f,
			.attackChain = {
				// Stage 0 — stab: quick opener, some forward movement
				{ .damageMultiplier=0.9f, .range=3.5f, .duration=0.50f,
				  .movementMultiplier=0.2f, .chainWindow=0.55f, .staminaCost=10.0f },
				// Stage 1 — chop: heavy mid-swing
				{ .damageMultiplier=1.2f, .range=3.5f, .duration=0.55f,
				  .movementMultiplier=0.1f, .chainWindow=0.5f, .staminaCost=15.0f },
				// Stage 2 — stab finisher: devastating, rooted
				{ .damageMultiplier=1.8f, .range=3.5f, .duration=0.65f,
				  .movementMultiplier=0.0f, .chainWindow=0.0f, .staminaCost=20.0f },
			},
			// Skill 1 — spin attack: high-damage AOE, roots caster
			.skill1 = { .params = MeleeAOE{ .range=4.5f, .movementMultiplier=0.0f, .dmgMultiplier=2.2f },
			            .cooldown=6.0f, .castDuration=0.8f, .staminaCost=25.0f },
			// Skill 2 — spinning cleave: sustained AOE, some movement
			.skill2 = { .params = MeleeAOE{ .range=4.0f, .movementMultiplier=0.3f, .dmgMultiplier=2.0f },
			            .cooldown=8.0f, .castDuration=0.6f, .staminaCost=20.0f },
		},
	};

	inline const CharacterPreset ROGUE = {
		.health = {
			.maxHealth  = 100.0f,
			.armor      = 0.0f,
			.resistance = 0.0f,
		},
		.movement = {
			.movementSpeed    = 1.9f,
			.rotationSpeed    = 22.0f,  // ~70ms for a 90° turn — very snappy
			.sprintMultiplier = 3.0f,   // light armor — fast sprint
			.crouchMultiplier = 0.6f,   // stealthier crouch, still quick
			.jumpVelocity     = 7.5f,   // high jump — agile
			.dodgeVelocity    = 11.0f,  // signature dodge — long reposition
			.airControlFactor = 0.35f,  // good air control
			.acceleration     = 22.0f,  // ~50ms to walk, ~140ms to sprint
			.deceleration     = 30.0f,  // ~45ms walk stop, ~105ms sprint slide
			.mass             = 60.0f,
			.friction         = 0.7f,   // slides a bit — momentum after stops
			.drag             = 0.0f,
			.maxSpeed         = 10.0f,
			.maxFallSpeed     = 55.0f,
		},
		.collider = {
			.radius = 0.35f,
			.height = 1.75f,           // slimmer than knight
		},
		.stamina = {
			.maxStamina        = 120.0f,
			.baseRegenRate     = 55.0f,    // effective: 5.5/s (10% floor) to 55.0/s
			.drainDelaySeconds = 1.0f,     // short pause — recovers fast
			.sprintCostPerSec  = 10.0f,    // ~12s of continuous sprint
			.jumpCost          = 5.0f,     // ~24 jumps from full
		},
		.combat = {
			.baseDamage         = 22.0f,
			.damageMultiplier   = 1.0f,
			.criticalChance     = 0.35f,   // high crit — glass cannon
			.criticalMultiplier = 2.0f,
			.attackChain = {
				// Stage 0 — chop: fast opener, mobile
				{ .damageMultiplier=0.8f, .range=3.0f, .duration=0.5f,
				  .movementMultiplier=0.4f, .chainWindow=0.5f, .staminaCost=8.0f },
				// Stage 1 — slice: heavier finisher, chain resets (chainWindow=0)
				{ .damageMultiplier=1.3f, .range=3.0f, .duration=0.6f,
				  .movementMultiplier=0.3f, .chainWindow=0.0f, .staminaCost=14.0f },
			},
			// Skill 1 — dash stab: quick forward lunge
			.skill1 = { .params = MeleeAOE{ .range=3.0f, .movementMultiplier=1.0f, .dmgMultiplier=1.6f },
			            .cooldown=4.0f, .castDuration=0.40f, .staminaCost=15.0f },
			// Skill 2 — kick: close-range knockback/disengage tool
			.skill2 = { .params = MeleeAOE{ .range=3.0f, .movementMultiplier=0.2f, .dmgMultiplier=1.4f },
			            .cooldown=6.0f, .castDuration=0.45f, .staminaCost=12.0f },
		},
	};
/*
	// ── AI enemies ─────────────────────────────────────────────────────
	inline const CharacterPreset SKELETON = {
		.baseDamage     = 8.0f,
		.attackRange    = 1.5f,
		.attackCooldown = 0.4f,
		.maxHealth      = 50.0f,
		.armor          = 0.0f,
		.movementSpeed  = 10.0f,
		.skill1 = { MeleeSingleTargetSkill{ 2.0f, 1.5f }, 6.0f },
		.skill2 = { DashSkill{ 4.0f, 12.0f },             12.0f },
	};
 */
};
};
