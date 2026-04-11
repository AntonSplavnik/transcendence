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

	struct StaminaPreset {
		float maxStamina;          // total stamina pool
		float baseRegenRate;       // max regen per second (at 100% stamina)
		float drainDelaySeconds;   // seconds of no regen after full depletion
		float sprintCostPerSec;    // stamina consumed per second while sprinting
		float jumpCost;            // flat stamina consumed per jump
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
		StaminaPreset  stamina;
		CombatPreset   combat;
	};

};
