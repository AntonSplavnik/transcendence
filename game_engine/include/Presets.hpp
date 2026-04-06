#pragma once

#include "CharacterPreset.hpp"

namespace ArenaGame {
namespace Presets {

	// ── Player characters ──────────────────────────────────────────────
	inline const CharacterPreset KNIGHT = {
		.maxHealth           = 120.0f,
		.armor               = 5.0f,
		.resistance          = 0.1f,
		.movementSpeed       = 1.5f,
		.rotationSpeed       = 1.0f,
		.baseDamage          = 18.0f,
		.damageMultiplier    = 1.0f,
		.criticalChance      = 0.15f,
		.criticalMultiplier  = 1.5f,
		.attackChain   = {
			// Stage 0: overhead chop — slow, rooted, moderate hit (skill description and feel)
			{ .damageMultiplier=0.9f,
			.range=2.0f,
			.duration=0.5f,
			.movementMultiplier=0.0f,
			.chainWindow=0.8f },
			// Stage 1: shield bash — rooted, heavy hit, ends chain
			{ .damageMultiplier=1.6f,
			.range=1.8f,
			.duration=0.6f,
			.movementMultiplier=0.0f,
			.chainWindow=0.0f },
		},
		.skill1 = { MeleeAOE{
			.range=2.0f,
			.movementMultiplier=0.0f,
			.dmgMultiplier=1.5f },
			.cooldown=5.0f },
		.skill2 = { MeleeAOE{
			.range=2.0f,
			.movementMultiplier=0.7f,
			.dmgMultiplier=1.5f },
			.cooldown=10.0f },
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
