#pragma once

#include "Skills.hpp"
#include <vector>

namespace ArenaGame {

	struct HealthPreset {
		float maxHealth;
		float armor;
		float resistance;
	};

	struct MovementPreset {
		// CharacterController
		float movementSpeed;
		float rotationSpeed;
		float sprintMultiplier;
		float crouchMultiplier;
		float jumpVelocity;
		float dodgeVelocity;
		float airControlFactor;
		float acceleration;
		float deceleration;
		// PhysicsBody
		float mass;
		float friction;
		float drag;
		float maxSpeed;
		float maxFallSpeed;
	};

	struct ColliderPreset {
		float radius;
		float height;
	};

	struct CombatPreset {
		float baseDamage;
		float damageMultiplier;
		float criticalChance;
		float criticalMultiplier;
		std::vector<AttackStage> attackChain;
		SkillDefinition skill1;
		SkillDefinition skill2;
	};

	struct CharacterPreset {
		HealthPreset   health;
		MovementPreset movement;
		ColliderPreset collider;
		CombatPreset   combat;
	};

};
