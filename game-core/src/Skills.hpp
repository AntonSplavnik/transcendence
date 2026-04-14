#pragma once

#include <variant>

namespace ArenaGame {

	// One-shot AOE cast. Player is locked for castDuration, then damage
	// is applied once to every target in range.
	struct MeleeAOE {
		float range;
		float movementMultiplier;  // 0=rooted, 1=full movement during skill
		float dmgMultiplier;
		float castDuration;        // seconds the caster is locked after triggering
		float staminaCost;         // flat cost consumed when the cast completes
	};

	// Channeled spinning-sweep attack. An axe angle rotates around the
	// caster at rotationSpeed (rad/s, cumulative offset from caster forward).
	// Each tick, damage is applied to every target whose direction-from-
	// caster falls inside the arc swept since the previous tick. Ends on
	// key release, stamina depletion, maxDuration, or death.
	//
	// Notes:
	//   - Coverage is continuous: a stationary target at a given direction
	//     is hit exactly once per full rotation, independent of tickInterval.
	//   - The caster can still steer by turning; the swept arc is a local
	//     offset that follows the caster's current forward.
	struct ChanneledCone {
		float range;
		float rotationSpeed;        // axe angular velocity (rad/s) around the caster
		float tickInterval;         // seconds between damage ticks
		float dmgPerTickMultiplier; // applied per tick (vs CombatController::baseDamage)
		float maxDuration;          // hard cap on channel length (seconds)
		float staminaCostPerSec;    // continuous drain while channeling
		float movementMultiplier;   // 0=rooted, 1=full movement during channel
	};

	using SkillVariant = std::variant<MeleeAOE, ChanneledCone>;

	// Pure preset data — no mutable fields, no methods.
	// All runtime state (timers, hitPending) lives on CombatController.
	// Only fields universal to every variant belong here; variant-specific
	// timings / costs live inside the variant struct itself.
	struct SkillDefinition {
		SkillVariant params;
		float cooldown = 0.0f;  // cooldown duration after the skill ends
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
