#pragma once

#include "../GameTypes.hpp"
#include "../CharacterPreset.hpp"
#include <entt/entt.hpp>
#include <algorithm>
#include <cstdio>

namespace ArenaGame {
namespace Components {

// =============================================================================
// Health - Hit points and damage handling
// =============================================================================
// Pure data component - logic handled by CombatSystem
// Represents an entity that can take damage and die
//
// Usage:
//   Health health(100.0f);
//   health.takeDamage(25.0f);
//   if (!health.isAlive()) { ... }
// =============================================================================

struct Health {
    float current;      // Current health points
    float maximum;      // Maximum health points

    // Damage modifiers
    float armor;        // Flat damage reduction (subtracted from incoming damage)
    float resistance;   // Percentage damage reduction (0.0 = no reduction, 1.0 = immune)

    // Status
    bool invulnerable;  // If true, takes no damage
    bool isDead;        // Cached death state

    // Last damage info (for kill feed / scoreboard — translate to PlayerID at snapshot time)
    entt::entity lastAttacker;
    float lastDamageAmount;
    double lastDamageTime;

    Health()
        : current(100.0f)
        , maximum(100.0f)
        , armor(0.0f)
        , resistance(0.0f)
        , invulnerable(false)
        , isDead(false)
        , lastAttacker(entt::null)
        , lastDamageAmount(0.0f)
        , lastDamageTime(0.0)
    {}
    explicit Health(float maxHealth)
        : current(maxHealth)
        , maximum(maxHealth)
        , armor(0.0f)
        , resistance(0.0f)
        , invulnerable(false)
        , isDead(false)
        , lastAttacker(entt::null)
        , lastDamageAmount(0.0f)
        , lastDamageTime(0.0)
    {}
    Health(float maxHealth, float armor, float resistance)
        : current(maxHealth)
        , maximum(maxHealth)
        , armor(armor)
        , resistance(resistance)
        , invulnerable(false)
        , isDead(false)
        , lastAttacker(entt::null)
        , lastDamageAmount(0.0f)
        , lastDamageTime(0.0)
    {}

    // Health queries
    bool isAlive() const {
        return current > 0.0f && !isDead;
    }

    bool isFullHealth() const {
        return current >= maximum;
    }

    float getCurrentHelth() const {
        return current;
    }

    float getHealthPercent() const {
        return maximum > 0.0f ? (current / maximum) : 0.0f;
    }

    bool isCritical() const {
        return getHealthPercent() < 0.25f;  // Below 25% health
    }

    // Health manipulation
    void takeDamage(float rawDamage, entt::entity attacker = entt::null) {
        if (invulnerable || isDead) {
            return;
        }

        // Apply armor (flat reduction)
        float damageAfterArmor = std::max(0.0f, rawDamage - armor);

        // Apply resistance (percentage reduction)
        float finalDamage = damageAfterArmor * (1.0f - resistance);

        fprintf(stderr, "[HEALTH] raw=%.2f  -armor(%.1f)=%.2f  -resist(%.0f%%)=%.2f  hp: %.1f -> %.1f\n",
            rawDamage, armor, damageAfterArmor,
            resistance * 100.0f, finalDamage,
            current, std::max(0.0f, current - finalDamage));

        // Apply damage
        current -= finalDamage;

        if (current <= 0.0f) {
            current = 0.0f;
            isDead = true;
        }

        // Track last damage (translate attacker entity → PlayerID at snapshot time)
        lastDamageAmount = finalDamage;
        lastAttacker = attacker;
        // lastDamageTime should be set by CombatSystem with game time
    }

    void heal(float amount) {
        if (isDead) {
            return;
        }

        current = std::min(current + amount, maximum);
    }

    void setHealth(float health) {
        current = std::clamp(health, 0.0f, maximum);
        isDead = (current <= 0.0f);
    }

    void setMaxHealth(float maxHealth) {
        maximum = maxHealth;
        current = std::min(current, maximum);
    }

    void restore() {
        current = maximum;
        isDead = false;
    }

    void kill() {
        current = 0.0f;
        isDead = true;
    }

    void revive(float healthAmount = -1.0f) {
        isDead = false;
        if (healthAmount < 0.0f) {
            current = maximum;  // Full health
        } else {
            current = std::min(healthAmount, maximum);
        }
    }

    // Damage calculation helpers (can be used by CombatSystem)
    float calculateDamage(float rawDamage) const {
        float damageAfterArmor = std::max(0.0f, rawDamage - armor);
        return damageAfterArmor * (1.0f - resistance);
    }

    // Static factory methods
    static Health createFromPreset(const CharacterPreset& preset) {
        Health h;
        h.maximum = preset.maxHealth;
        h.current = h.maximum;
        h.armor = preset.armor;
        return h;
    }
    static Health createCharacter() {
        return Health(GameConfig::CHARACTER_MAX_HEALTH, 0.0f, 0.0f);
    }
    static Health createTank() {
        return Health(150.0f, 10.0f, 0.2f);  // More HP, armor, and resistance
    }
    static Health createGlass() {
        return Health(50.0f, 0.0f, 0.0f);  // Low HP, no protection
    }
    static Health createBoss() {
        return Health(500.0f, 20.0f, 0.3f);  // High HP, armor, and resistance
    }
};

} // namespace Components
} // namespace ArenaGame
