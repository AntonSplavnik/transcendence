#pragma once

#include <variant>
#include <cassert>

namespace ArenaGame {

	struct MeleeAOE {
		float range;
		float movementMultiplier;  // 0=rooted, 1=full movement during skill
		float dmgMultiplier;
	};

	using SkillVariant = std::variant<MeleeAOE>;

	struct SkillDefinition {
		SkillVariant params;
		float cooldown     = 0.0f;
		float castDuration = 0.0f;  // how long player is locked into this skill
		float timer        = 0.0f;  // cooldown countdown (starts after cast ends)
		float castTimer    = 0.0f;  // cast countdown — effect fires when this hits 0
		bool  hitPending   = false; // effect deferred to cast end

		bool isCasting() const { return castTimer > 0.0f; }
		bool canUse()    const { return timer <= 0.0f && !isCasting(); }

		// Starts the cast. The cooldown timer does NOT start until endCast() is called.
		// Total lockout = castDuration + cooldown. Precondition: castDuration > 0.
		// Skills with instant effects must not use this path.
		void trigger() {
			assert(castDuration > 0.0f && "SkillDefinition: castDuration must be > 0");
			castTimer  = castDuration;
			hitPending = true;
		}

		// Called by CombatSystem when castTimer reaches zero, before applying the hit.
		// Does NOT clear hitPending — CombatSystem clears it after applying the effect.
		void endCast() {
			timer     = cooldown;
			castTimer = 0.0f;
		}
	};

	struct AttackStage {
		float damageMultiplier;       // multiplied against CombatController::baseDamage
		float range;                  // reach of this swing
		float duration;               // swing length — gates next input (chain or new attack)
		float movementMultiplier;     // caster speed during swing (0=rooted, 1=free)
		float chainWindow;            // time after duration expires to press again and continue
									  // 0 on last stage means chain wraps back to stage 0
		float attackAngle = 1.047f;   // half-angle in radians (≈60° → 120° frontal cone)
	};

} // namespace ArenaGame
