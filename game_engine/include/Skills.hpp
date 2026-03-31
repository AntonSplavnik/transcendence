#pragma once

#include <variant>

namespace ArenaGame {

	struct MeleeAOE {
		float range;
		float movementMultiplier;  // 0=rooted, 1=full movement during skill
		float dmgMultiplier;
	};

	using SkillVariant = std::variant<MeleeAOE>;

	struct SkillDefinition {
		SkillVariant params;
		float cooldown;
		float timer = 0.0f;
		bool canUse() const { return timer <= 0.0f; }
		void trigger()      { timer = cooldown; }
	};

	struct AttackStage {
		float damageMultiplier;   // multiplied against CombatController::baseDamage
		float range;              // reach of this swing
		float duration;           // swing length — gates next input (chain or new attack)
		float movementMultiplier; // caster speed during swing (0=rooted, 1=free)
		float chainWindow;        // time after duration expires to press again and continue
		                          // 0 on last stage means chain wraps back to stage 0
	};

} // namespace ArenaGame
