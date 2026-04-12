#pragma once

#include "../CharacterPreset.hpp"
#include <vector>
#include <algorithm>
#include <cstdlib>

namespace ArenaGame {
namespace Components {

// =============================================================================
// CombatController - Attack chain state, skills, and damage modifiers
// =============================================================================
// Pure data component — logic handled by CombatSystem.
//
// Attack chain
// ─────────────────────────────────────────────────────────────────────────────
// attackChain holds the ordered sequence of AttackStages copied from the
// CharacterPreset at entity creation.  At runtime the component tracks which
// stage fires next (chainStage) and whether the player is still inside the
// chain window (chainTimer).
//
// A normal attack fires at attackChain[chainStage].  After the swing lands,
// advanceChain() either advances to the next stage (if chainWindow > 0) or
// wraps back to 0 (last stage / chainWindow == 0).  If the player does not
// press attack again before chainWindow expires, chainStage resets to 0.
//
// Skills
// ─────────────────────────────────────────────────────────────────────────────
// ability1 / ability2 are SkillDefinition slots copied from the preset.
// Each carries its own cooldown timer ticked by updateTimers().
// =============================================================================

struct CombatController {

	// ── Preset-derived data (set once via createFromPreset) ──────────────────

	float baseDamage;                      // base; each AttackStage multiplies this
	std::vector<AttackStage> attackChain;  // ordered attack sequence
	SkillDefinition ability1;              // pure preset data
	SkillDefinition ability2;              // pure preset data

	// ── Damage modifiers ─────────────────────────────────────────────────────

	// Base values: set from preset, never modified at runtime.
	// Use these to restore runtime values after a buff/debuff expires.
	float baseDamageMultiplier;
	float baseCriticalChance;
	float baseCriticalMultiplier;

	// Runtime values: start equal to base, modified by buffs / debuffs.
	float damageMultiplier;
	float criticalChance;
	float criticalMultiplier;

	// ── Attack chain runtime state ───────────────────────────────────────────

	int   chainStage  = 0;     // index of the stage that fires on next attack press
	float chainTimer  = 0.0f;  // time elapsed since the last stage completed
	float swingTimer  = 0.0f;  // time elapsed inside the current swing
	bool  isAttacking = false; // true while swingTimer < currentStage().duration
	bool  hitPending  = false; // hit queued at swing start, applied at swing end

	// ── Skill runtime state (same pattern as attack chain) ───────────────

	float skill1CooldownTimer = 0.0f;  // cooldown countdown (starts after cast ends)
	float skill1CastTimer     = 0.0f;  // cast countdown — effect fires when this hits 0
	bool  skill1HitPending    = false;  // effect deferred to cast end
	float skill2CooldownTimer = 0.0f;
	float skill2CastTimer     = 0.0f;
	bool  skill2HitPending    = false;

	// ── Capability flags ─────────────────────────────────────────────────────

	bool canAttack       = true;
	bool canUseAbilities = true;

	// ── Input buffer ─────────────────────────────────────────────────────────

	enum class BufferedAction : uint8_t { None, Attack, Skill1, Skill2 };
	BufferedAction bufferedAction = BufferedAction::None;

	// ── Queries ──────────────────────────────────────────────────────────────

	// Returns the stage that fires on the next attack input.
	const AttackStage& currentStage() const {
		return attackChain[static_cast<size_t>(chainStage)];
	}

	bool isAbility1Casting() const { return skill1CastTimer > 0.0f; }
	bool isAbility2Casting() const { return skill2CastTimer > 0.0f; }

	// Ready to accept an attack input — not mid-swing, not casting, and attacks are enabled.
	bool canPerformAttack() const {
		return canAttack && !isAttacking && !attackChain.empty()
			&& !isAbility1Casting() && !isAbility2Casting();
	}

	bool canUseAbility1() const {
		return canUseAbilities && !isAttacking && skill1CooldownTimer <= 0.0f && !isAbility1Casting();
	}
	bool canUseAbility2() const {
		return canUseAbilities && !isAttacking && skill2CooldownTimer <= 0.0f && !isAbility2Casting();
	}

	// ── State transitions (called by CombatSystem) ───────────────────────────

	// Begin the current stage's swing.
	void startAttack() {
		isAttacking = true;
		swingTimer  = 0.0f;
		chainTimer  = 0.0f;  // player acted in time — reset window clock
		hitPending  = false;
	}

	// Advance chain after a hit lands.
	// Called by CombatSystem once per successful hit, not per frame.
	void advanceChain() {
		const bool lastStage = (chainStage + 1 >= static_cast<int>(attackChain.size()));
		const bool chainEnds = lastStage || attackChain[static_cast<size_t>(chainStage)].chainWindow <= 0.0f;

		chainStage = chainEnds ? 0 : chainStage + 1;
		chainTimer = 0.0f;
	}

	void disableAttacks()   { canAttack = false; }
	void enableAttacks()    { canAttack = true;  }
	void disableAbilities() { canUseAbilities = false; }
	void enableAbilities()  { canUseAbilities = true;  }

	// ── Per-frame timer update (called by CombatSystem::updateCooldowns) ─────

	void updateTimers(float deltaTime) {
		// Advance swing — clear isAttacking once duration has elapsed
		if (isAttacking) {
			swingTimer += deltaTime;
			if (swingTimer >= currentStage().duration) {
				isAttacking = false;
				swingTimer  = 0.0f;
			}
		}

		// Advance chain window — break chain if player is too slow.
		// Only tick after the swing ends; the window is idle time between attacks.
		if (chainStage > 0 && !isAttacking) {
			chainTimer += deltaTime;
			const float window = attackChain[static_cast<size_t>(chainStage - 1)].chainWindow;
			if (chainTimer > window) {
				chainStage = 0;
				chainTimer = 0.0f;
			}
		}

		// Tick skill cooldowns
		if (skill1CooldownTimer > 0.0f)
			skill1CooldownTimer = std::max(0.0f, skill1CooldownTimer - deltaTime);
		if (skill2CooldownTimer > 0.0f)
			skill2CooldownTimer = std::max(0.0f, skill2CooldownTimer - deltaTime);
	}

	// ── Factory ──────────────────────────────────────────────────────────────

	// Default melee combatant with no attack chain (can't attack).
	// Used for generic actors that don't need preset-driven combat.
	static CombatController createDefault() {
		CombatController cc;
		cc.baseDamage             = 10.0f;
		cc.baseDamageMultiplier   = 1.0f;
		cc.baseCriticalChance     = 0.1f;
		cc.baseCriticalMultiplier = 1.5f;
		cc.damageMultiplier       = 1.0f;
		cc.criticalChance         = 0.1f;
		cc.criticalMultiplier     = 1.5f;
		// attackChain intentionally empty — canPerformAttack() returns false
		return cc;
	}

	static CombatController createFromPreset(const CombatPreset& p) {
		CombatController cc;
		cc.baseDamage  = p.baseDamage;
		cc.attackChain = p.attackChain;
		cc.ability1    = p.skill1;
		cc.ability2    = p.skill2;

		cc.baseDamageMultiplier   = p.damageMultiplier;
		cc.baseCriticalChance     = p.criticalChance;
		cc.baseCriticalMultiplier = p.criticalMultiplier;
		cc.damageMultiplier       = p.damageMultiplier;
		cc.criticalChance         = p.criticalChance;
		cc.criticalMultiplier     = p.criticalMultiplier;
		return cc;
	}
};

} // namespace Components
} // namespace ArenaGame
