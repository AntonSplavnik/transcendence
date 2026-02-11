#pragma once

#include "System.hpp"
#include "GameTypes.hpp"
#include "Core/Entity.hpp"
#include <vector>
#include <queue>

namespace ArenaGame {

// =============================================================================
// CombatSystem - Handles all combat logic
// =============================================================================
// Responsibilities:
// - Process attack commands
// - Handle damage application
// - Manage attack cooldowns
// - Process death/respawn
// - Future: Projectile damage, area-of-effect, buffs/debuffs
//
// Works with entities that have Health and CombatController components
// =============================================================================

class CombatSystem : public System {
public:
    CombatSystem();

    // System interface
    void update(float deltaTime) override;
    const char* getName() const override { return "CombatSystem"; }

    // Register entities for combat processing
    void addEntity(Core::Entity* entity);
    void removeEntity(Core::Entity* entity);
    void clear();

    // Combat actions
    void registerHit(PlayerID attackerID, PlayerID victimID, float damage);
    void requestAttack(PlayerID playerID);

    // Combat configuration
    struct Config {
        float meleeRange = 2.0f;        // Range for melee attacks
        float meleeDamage = 10.0f;      // Base melee damage
        float attackCooldown = 0.5f;    // Time between attacks
        bool friendlyFire = false;      // Can players damage each other?
    };

    const Config& getConfig() const { return m_config; }
    void setConfig(const Config& config) { m_config = config; }

private:
    std::vector<Core::Entity*> m_entities;
    Config m_config;

    // Pending hits to process
    struct PendingHit {
        PlayerID attackerID;
        PlayerID victimID;
        float damage;
    };
    std::queue<PendingHit> m_pendingHits;

    // Pending attacks to process
    struct PendingAttack {
        PlayerID playerID;
    };
    std::queue<PendingAttack> m_pendingAttacks;

    // Helper methods
    Core::Entity* findEntity(PlayerID playerID);
    void processAttacks();
    void processDamage();
    void updateCooldowns(float deltaTime);
};

// =============================================================================
// Implementation
// =============================================================================

inline CombatSystem::CombatSystem() {
    m_entities.reserve(32);
}

inline void CombatSystem::update(float deltaTime) {
    // Process all pending attacks
    processAttacks();

    // Process all pending damage
    processDamage();

    // Update cooldowns
    updateCooldowns(deltaTime);
}

inline void CombatSystem::addEntity(Core::Entity* entity) {
    if (entity && (entity->hasHealth() || entity->hasCombat())) {
        m_entities.push_back(entity);
    }
}

inline void CombatSystem::removeEntity(Core::Entity* entity) {
    m_entities.erase(
        std::remove(m_entities.begin(), m_entities.end(), entity),
        m_entities.end()
    );
}

inline void CombatSystem::clear() {
    m_entities.clear();

    // Clear pending actions
    while (!m_pendingHits.empty()) m_pendingHits.pop();
    while (!m_pendingAttacks.empty()) m_pendingAttacks.pop();
}

inline void CombatSystem::registerHit(PlayerID attackerID, PlayerID victimID, float damage) {
    m_pendingHits.push({attackerID, victimID, damage});
}

inline void CombatSystem::requestAttack(PlayerID playerID) {
    m_pendingAttacks.push({playerID});
}

inline Core::Entity* CombatSystem::findEntity(PlayerID playerID) {
    for (Core::Entity* entity : m_entities) {
        if (entity && entity->id == playerID) {
            return entity;
        }
    }
    return nullptr;
}

inline void CombatSystem::processAttacks() {
    while (!m_pendingAttacks.empty()) {
        PendingAttack attack = m_pendingAttacks.front();
        m_pendingAttacks.pop();

        Core::Entity* attacker = findEntity(attack.playerID);
        if (!attacker || !attacker->hasCombat() || !attacker->isAlive()) {
            continue;
        }

        auto& combat = attacker->getCombat();

        // Try to initiate attack
        if (combat.canPerformAttack()) {
            combat.startAttack();

            // Update character state if has controller
            if (attacker->hasController()) {
                attacker->getController().setState(CharacterState::Attacking);
            }

            // In a full implementation, you'd:
            // 1. Check for targets in range
            // 2. Apply damage to those targets
            // 3. Trigger attack animations/effects

            // For now, this is handled by registerHit() being called
            // from the game logic when client confirms a hit
        }
    }
}

inline void CombatSystem::processDamage() {
    while (!m_pendingHits.empty()) {
        PendingHit hit = m_pendingHits.front();
        m_pendingHits.pop();

        Core::Entity* victim = findEntity(hit.victimID);
        if (!victim || !victim->hasHealth() || !victim->isAlive()) {
            continue;
        }

        // Check friendly fire
        if (!m_config.friendlyFire && hit.attackerID == hit.victimID) {
            continue;
        }

        // Apply damage
        victim->getHealth().takeDamage(hit.damage, hit.attackerID);

        // Check if victim died
        if (!victim->isAlive()) {
            // Update character state if has controller
            if (victim->hasController()) {
                victim->getController().setState(CharacterState::Dead);
            }

            // Could trigger death events, respawn logic, etc.
            // For now, character is just marked as dead
        }
    }
}

inline void CombatSystem::updateCooldowns(float deltaTime) {
    for (Core::Entity* entity : m_entities) {
        if (!entity || !entity->hasCombat()) {
            continue;
        }

        auto& combat = entity->getCombat();

        // Update timers
        combat.updateTimers(deltaTime);

        // Check if attack finished and update state
        if (entity->hasController() && !combat.isAttacking) {
            auto& controller = entity->getController();
            if (controller.state == CharacterState::Attacking) {
                // Return to idle or moving based on input
                if (controller.hasMovementInput()) {
                    controller.setState(CharacterState::Moving);
                } else {
                    controller.setState(CharacterState::Idle);
                }
            }
        }
    }
}

} // namespace ArenaGame
