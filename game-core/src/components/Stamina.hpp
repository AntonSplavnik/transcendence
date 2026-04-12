#pragma once

#include "../CharacterPreset.hpp"
#include <algorithm>
#include <cmath>

namespace ArenaGame {
namespace Components {

// =============================================================================
// Stamina - Resource pool for physical actions (sprint, attack, skill, jump)
// =============================================================================
// Pure data component with convenience methods. Mirrors Health pattern.
//
// Regen formula (applied by StaminaSystem in lateUpdate):
//   effectiveRate = max(baseRegenRate * current/maximum, baseRegenRate * 0.10)
//   → smooth curve: more stamina = faster regen, 10% floor prevents near-zero stall
//
// Exhaustion: when current hits 0, drainDelayTimer starts. No regen until it
// expires. Prevents stutter-loop of drain→regen→drain.
//
// Consumption is done by CombatSystem (attacks/skills) and
// CharacterControllerSystem (sprint/jump). This component only stores state.
// =============================================================================

struct Stamina {
	// Pool
	float current;
	float maximum;

	// Regen
	float baseRegenRate;      // max regen/s at 100% stamina
	float drainDelay;         // configured pause duration after full depletion
	float drainDelayTimer;    // runtime countdown (0 = not exhausted or delay expired)

	// State
	bool exhausted;           // true from depletion until drainDelayTimer expires

	// Per-class costs (copied from StaminaPreset at spawn)
	float sprintCostPerSec;   // continuous drain while sprinting
	float jumpCost;           // flat cost per jump

	// ── Constructors ────────────────────────────────────────────────────

	Stamina()
		: current(100.0f)
		, maximum(100.0f)
		, baseRegenRate(40.0f)
		, drainDelay(1.5f)
		, drainDelayTimer(0.0f)
		, exhausted(false)
		, sprintCostPerSec(15.0f)
		, jumpCost(8.0f)
	{}

	explicit Stamina(float maxStamina)
		: current(maxStamina)
		, maximum(maxStamina)
		, baseRegenRate(40.0f)
		, drainDelay(1.5f)
		, drainDelayTimer(0.0f)
		, exhausted(false)
		, sprintCostPerSec(15.0f)
		, jumpCost(8.0f)
	{}

	// ── Queries ─────────────────────────────────────────────────────────

	bool canAfford(float cost) const {
		return current >= cost;
	}

	bool isExhausted() const {
		return exhausted;
	}

	bool isFull() const {
		return current >= maximum;
	}

	float getPercent() const {
		return maximum > 0.0f ? (current / maximum) : 0.0f;
	}

	// ── Mutation ─────────────────────────────────────────────────────────

	void consume(float amount) {
		current = std::max(0.0f, current - amount);
	}

	void recover(float amount) {
		current = std::min(current + amount, maximum);
	}

	void restore() {
		current = maximum;
		exhausted = false;
		drainDelayTimer = 0.0f;
	}

	// ── Factory ─────────────────────────────────────────────────────────

	static Stamina createFromPreset(const StaminaPreset& preset) {
		Stamina s;
		s.maximum          = preset.maxStamina;
		s.current          = s.maximum;
		s.baseRegenRate    = preset.baseRegenRate;
		s.drainDelay       = preset.drainDelaySeconds;
		s.drainDelayTimer  = 0.0f;
		s.exhausted        = false;
		s.sprintCostPerSec = preset.sprintCostPerSec;
		s.jumpCost         = preset.jumpCost;
		return s;
	}
};

} // namespace Components
} // namespace ArenaGame
