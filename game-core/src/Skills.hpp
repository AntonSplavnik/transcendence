#pragma once

#include <variant>

namespace ArenaGame {

	struct MeleeAOE {
		float range;
		float movementMultiplier;  // 0=rooted, 1=full movement during skill
		float dmgMultiplier;
	};

	using SkillVariant = std::variant<MeleeAOE>;

	// Pure preset data — no mutable fields, no methods.
	// All runtime state (timers, hitPending) lives on CombatController.
	struct SkillDefinition {
		SkillVariant params;
		float cooldown     = 0.0f;  // cooldown duration after cast ends
		float castDuration = 0.0f;  // how long player is locked into this skill
		float staminaCost  = 0.0f;  // stamina consumed when cast completes
	};

	struct AttackStage {
		float damageMultiplier;       // multiplied against CombatController::baseDamage
		float range;                  // reach of this swing
		float duration;               // swing length — gates next input (chain or new attack)
		float movementMultiplier;     // caster speed during swing (0=rooted, 1=free)
		float chainWindow;            // time after duration expires to press again and continue
									  // 0 on last stage means chain wraps back to stage 0
		float attackAngle = 0.7f;     // half-angle in radians (≈40° → 80° frontal cone)
		float staminaCost  = 0.0f;  // stamina consumed when this swing completes
	};

} // namespace ArenaGame
