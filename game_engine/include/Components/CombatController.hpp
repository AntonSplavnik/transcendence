#pragma once

#include "../GameTypes.hpp"

namespace ArenaGame {
namespace Components {

// =============================================================================
// CombatController - Attack timing, damage, and combat state
// =============================================================================
// Pure data component - logic handled by CombatSystem
// Stores combat-related state and configuration
//
// Usage:
//   CombatController combat;
//   combat.baseDamage = 25.0f;
//   if (combat.canAttack()) {
//       combat.startAttack();
//   }
// =============================================================================

struct CombatController {
    // Attack properties
    float baseDamage;           // Base damage per attack
    float attackRange;          // Range of melee attacks
    float attackCooldown;       // Time between attacks (seconds)
    float attackDuration;       // How long an attack lasts (animation time)

    // Attack timing
    float timeSinceLastAttack;  // Time since last attack started
    float attackTimer;          // Current attack animation timer

    // Attack state
    bool isAttacking;           // Currently performing an attack
    bool attackRequested;       // Player has requested an attack

    // Combo system (optional)
    int comboCount;             // Current combo counter
    float comboWindow;          // Time window to continue combo
    float comboTimer;           // Time since last combo hit

    // Damage modifiers
    float damageMultiplier;     // Multiplier for all damage dealt (buffs/debuffs)
    float criticalChance;       // Chance to deal critical hit (0.0-1.0)
    float criticalMultiplier;   // Damage multiplier on critical hit

    // Ability cooldowns
    float ability1Cooldown;
    float ability1Timer;
    float ability2Cooldown;
    float ability2Timer;

    // Combat capabilities
    bool canAttack;
    bool canUseAbilities;

    // Constructors
    CombatController()
        : baseDamage(GameConfig::MELEE_DAMAGE)
        , attackRange(GameConfig::ATTACK_RANGE)
        , attackCooldown(0.5f)
        , attackDuration(0.3f)
        , timeSinceLastAttack(999.0f)  // Can attack immediately
        , attackTimer(0.0f)
        , isAttacking(false)
        , attackRequested(false)
        , comboCount(0)
        , comboWindow(1.0f)
        , comboTimer(0.0f)
        , damageMultiplier(1.0f)
        , criticalChance(0.05f)  // 5% crit chance
        , criticalMultiplier(2.0f)  // 2x damage on crit
        , ability1Cooldown(5.0f)
        , ability1Timer(0.0f)
        , ability2Cooldown(10.0f)
        , ability2Timer(0.0f)
        , canAttack(true)
        , canUseAbilities(true)
    {}

    // Attack state management
    bool canPerformAttack() const {
        return canAttack && !isAttacking && timeSinceLastAttack >= attackCooldown;
    }

    void startAttack() {
        if (!canPerformAttack()) {
            return;
        }

        isAttacking = true;
        attackTimer = 0.0f;
        timeSinceLastAttack = 0.0f;
        attackRequested = false;
    }

    void finishAttack() {
        isAttacking = false;
        attackTimer = 0.0f;
    }

    void requestAttack() {
        attackRequested = true;
    }

    void clearAttackRequest() {
        attackRequested = false;
    }

    // Update timers (called by CombatSystem)
    void updateTimers(float deltaTime) {
        // Attack cooldown
        timeSinceLastAttack += deltaTime;

        // Attack animation
        if (isAttacking) {
            attackTimer += deltaTime;
            if (attackTimer >= attackDuration) {
                finishAttack();
            }
        }

        // Combo timer
        if (comboCount > 0) {
            comboTimer += deltaTime;
            if (comboTimer >= comboWindow) {
                resetCombo();
            }
        }

        // Ability cooldowns
        if (ability1Timer > 0.0f) {
            ability1Timer = std::max(0.0f, ability1Timer - deltaTime);
        }
        if (ability2Timer > 0.0f) {
            ability2Timer = std::max(0.0f, ability2Timer - deltaTime);
        }
    }

    // Combo system
    void incrementCombo() {
        comboCount++;
        comboTimer = 0.0f;
    }

    void resetCombo() {
        comboCount = 0;
        comboTimer = 0.0f;
    }

    float getComboMultiplier() const {
        // Each combo hit increases damage by 10%, up to 50%
        return 1.0f + std::min(comboCount * 0.1f, 0.5f);
    }

    // Ability management
    bool canUseAbility1() const {
        return canUseAbilities && ability1Timer <= 0.0f;
    }

    bool canUseAbility2() const {
        return canUseAbilities && ability2Timer <= 0.0f;
    }

    void useAbility1() {
        if (canUseAbility1()) {
            ability1Timer = ability1Cooldown;
        }
    }

    void useAbility2() {
        if (canUseAbility2()) {
            ability2Timer = ability2Cooldown;
        }
    }

    // Damage calculation
    float calculateDamage(bool* outIsCritical = nullptr) const {
        float damage = baseDamage * damageMultiplier;

        // Apply combo multiplier
        damage *= getComboMultiplier();

        // Check for critical hit
        bool isCritical = (static_cast<float>(rand()) / RAND_MAX) < criticalChance;
        if (isCritical) {
            damage *= criticalMultiplier;
        }

        if (outIsCritical) {
            *outIsCritical = isCritical;
        }

        return damage;
    }

    // Enable/disable capabilities
    void disableAttacks() { canAttack = false; }
    void enableAttacks() { canAttack = true; }

    void disableAbilities() { canUseAbilities = false; }
    void enableAbilities() { canUseAbilities = true; }

    // Static factory methods
    static CombatController createMelee() {
        CombatController combat;
        combat.baseDamage = 25.0f;
        combat.attackRange = 2.0f;
        combat.attackCooldown = 0.5f;
        return combat;
    }

    static CombatController createRanged() {
        CombatController combat;
        combat.baseDamage = 15.0f;
        combat.attackRange = 20.0f;
        combat.attackCooldown = 0.3f;
        return combat;
    }

    static CombatController createHeavy() {
        CombatController combat;
        combat.baseDamage = 50.0f;
        combat.attackRange = 2.5f;
        combat.attackCooldown = 1.5f;  // Slower attacks
        combat.attackDuration = 0.8f;  // Longer animation
        return combat;
    }

    static CombatController createFast() {
        CombatController combat;
        combat.baseDamage = 10.0f;
        combat.attackRange = 1.5f;
        combat.attackCooldown = 0.2f;  // Very fast attacks
        combat.attackDuration = 0.15f;
        return combat;
    }
};

} // namespace Components
} // namespace ArenaGame
