#pragma once

#include "System.hpp"
#include "../components/Stamina.hpp"
#include "../components/CharacterController.hpp"
#include "../components/CombatController.hpp"
#include "../components/Health.hpp"
#include "../../entt/entt.hpp"
#include <algorithm>

namespace ArenaGame {

// =============================================================================
// StaminaSystem - Stamina regeneration (runs in lateUpdate)
// =============================================================================
// Sole owner of regen logic. Does NOT consume stamina — that is done by
// CombatSystem (attacks/skills) and CharacterControllerSystem (sprint/jump).
//
// Responsibilities:
//   1. Detect full depletion → set exhausted flag + start drain delay timer
//   2. Tick drain delay timer during exhaustion
//   3. Clear exhaustion when delay expires
//   4. Apply scaled regen when player is not actively consuming stamina
//
// Regen formula:
//   effectiveRate = max(baseRegenRate * (current / maximum), baseRegenRate * 0.10)
//   → 10% floor prevents infinitely slow recovery near zero
//
// Runs in lateUpdate (after CharacterControllerSystem in earlyUpdate and
// CombatSystem in update) so all consumption for the current frame is already
// applied before regen ticks.
// =============================================================================

class StaminaSystem : public System {
public:
	StaminaSystem() = default;

	void lateUpdate(float deltaTime) override;
	const char* getName() const override { return "StaminaSystem"; }
	bool needsLateUpdate() const override { return true; }
	bool needsUpdate() const override { return false; }
};

// =============================================================================
// Implementation
// =============================================================================

inline void StaminaSystem::lateUpdate(float deltaTime) {
	auto view = m_registry->view<
		Components::Stamina,
		Components::CharacterController,
		Components::CombatController,
		Components::Health
	>();

	view.each([&](Components::Stamina& stamina,
				  Components::CharacterController& controller,
				  Components::CombatController& combat,
				  Components::Health& health) {

		// 1. Dead players don't regen
		if (!health.isAlive()) return;

		// 2. Detect full depletion → enter exhaustion
		if (stamina.current <= 0.0f && !stamina.exhausted) {
			stamina.exhausted = true;
			stamina.drainDelayTimer = stamina.drainDelay;
		}

		// 3. Tick drain delay during exhaustion
		if (stamina.exhausted) {
			stamina.drainDelayTimer -= deltaTime;
			if (stamina.drainDelayTimer <= 0.0f) {
				stamina.exhausted = false;
				stamina.drainDelayTimer = 0.0f;
			} else {
				return;  // no regen during drain delay
			}
		}

		// 4. No regen while actively spending stamina. Channeled skills
		// drain per-second, so they count as "active" just like casts.
		if (controller.isSprinting) return;
		if (combat.isAttacking) return;
		if (combat.isAbility1Active()) return;
		if (combat.isAbility2Active()) return;

		// 5. Scaled regen with 10% minimum floor
		float ratio = stamina.current / stamina.maximum;
		float effectiveRate = stamina.baseRegenRate * ratio;
		effectiveRate = std::max(effectiveRate, stamina.baseRegenRate * 0.10f);

		stamina.current = std::min(stamina.current + effectiveRate * deltaTime, stamina.maximum);
	});
}

} // namespace ArenaGame
