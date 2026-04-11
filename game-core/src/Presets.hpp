#pragma once

#include "CharacterPreset.hpp"
#include <string>

namespace ArenaGame {
namespace Presets {

	// ── Player characters ──────────────────────────────────────────────
	inline const CharacterPreset KNIGHT = {
		.health = {
			.maxHealth  = 120.0f,
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
				{ .damageMultiplier=0.8f, .range=2.0f, .duration=0.45f,
				  .movementMultiplier=0.0f, .chainWindow=0.6f, .staminaCost=10.0f },
				// Stage 1 — horizontal slice: mid combo
				{ .damageMultiplier=0.9f, .range=2.2f, .duration=0.50f,
				  .movementMultiplier=0.0f, .chainWindow=0.5f, .staminaCost=15.0f },
				// Stage 2 — stab: heavy finisher, chain resets (chainWindow=0)
				{ .damageMultiplier=1.6f, .range=1.8f, .duration=0.60f,
				  .movementMultiplier=0.0f, .chainWindow=0.0f, .staminaCost=25.0f },
			},
			.skill1 = { .params = MeleeAOE{ .range=2.5f, .movementMultiplier=0.0f, .dmgMultiplier=1.8f },
			            .cooldown=5.0f, .castDuration=0.7f, .staminaCost=20.0f },
			.skill2 = { .params = MeleeAOE{ .range=2.0f, .movementMultiplier=0.7f, .dmgMultiplier=1.5f },
			            .cooldown=10.0f, .castDuration=0.5f, .staminaCost=30.0f },
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
