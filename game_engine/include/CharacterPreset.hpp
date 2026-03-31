#pragma once

#include "Skills.hpp"
#include <vector>

namespace ArenaGame {

	struct CharacterPreset {
		// Health
		float maxHealth;
		float armor;
		float resistance;

		// CharacterController
		float movementSpeed;
		float rotationSpeed;

		// CombatController
		float baseDamage;
		float damageMultiplier;
		float criticalChance;
		float criticalMultiplier;
		std::vector<AttackStage> attackChain;
		SkillDefinition skill1;
		SkillDefinition skill2;
	};
};
