#pragma once

#include "Systems/SystemEnTT.hpp"
#include "Components/PlayerInfo.hpp"
#include "Components/Transform.hpp"
#include "Components/Health.hpp"
#include "Components/CombatController.hpp"
#include "Components/CharacterController.hpp"
#include "GameTypes.hpp"
#include <entt/entt.hpp>
#include <queue>

namespace ArenaGame {

// =============================================================================
// CombatSystemEnTT - EnTT-based combat system
// =============================================================================
// Drop-in replacement for CombatSystem using EnTT views
// - Uses view<Health, CombatController> for iteration
// - Uses WorldEnTT for PlayerID → entity lookups
// - Identical combat logic to CombatSystem.hpp
//
// Performance improvements:
// - Packed storage for better cache locality
// - Automatic filtering (view only returns entities with required components)
// - No manual entity tracking
// =============================================================================

class CombatSystemEnTT : public SystemEnTT {
public:
    CombatSystemEnTT() = default;

    // System interface
    void update(float deltaTime) override;
    const char* getName() const override { return "CombatSystemEnTT"; }

    // Combat actions
    void registerHit(PlayerID attackerID, PlayerID victimID, float damage);
    void requestAttack(PlayerID playerID);

    // Combat configuration (same as CombatSystem)
    struct Config {
        float meleeRange = 2.0f;        // Range for melee attacks
        float meleeDamage = 10.0f;      // Base melee damage
        float attackCooldown = 0.5f;    // Time between attacks
        bool friendlyFire = false;      // Can players damage each other?
    };

    const Config& getConfig() const { return m_config; }
    void setConfig(const Config& config) { m_config = config; }

    // Clear pending actions (for shutdown)
    void clear() {
        while (!m_pendingHits.empty()) m_pendingHits.pop();
        while (!m_pendingAttacks.empty()) m_pendingAttacks.pop();
    }

private:
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
    entt::entity findEntity(PlayerID playerID);
    void processAttacks();
    void processDamage();
    void updateCooldowns(float deltaTime);
};

// =============================================================================
// Implementation
// =============================================================================

inline void CombatSystemEnTT::update(float deltaTime) {
    // Process all pending attacks
    processAttacks();

    // Process all pending damage
    processDamage();

    // Update cooldowns
    updateCooldowns(deltaTime);
}

inline void CombatSystemEnTT::registerHit(PlayerID attackerID, PlayerID victimID, float damage) {
    m_pendingHits.push({attackerID, victimID, damage});
}

inline void CombatSystemEnTT::requestAttack(PlayerID playerID) {
    m_pendingAttacks.push({playerID});
}

inline entt::entity CombatSystemEnTT::findEntity(PlayerID playerID) {
    if (!m_registry) {
        return entt::null;
    }

    // Search through all entities with PlayerInfo component
    auto view = m_registry->view<Components::PlayerInfo>();
    for (auto entity : view) {
        auto& playerInfo = view.get<Components::PlayerInfo>(entity);
        if (playerInfo.playerID == playerID) {
            return entity;
        }
    }

    return entt::null;
}

inline void CombatSystemEnTT::processAttacks() {
    while (!m_pendingAttacks.empty()) {
        PendingAttack attack = m_pendingAttacks.front();
        m_pendingAttacks.pop();

        entt::entity attacker = findEntity(attack.playerID);
        if (attacker == entt::null) {
            continue;
        }

        // Check if entity has combat component and is alive
        auto* combat = m_registry->try_get<Components::CombatController>(attacker);
        auto* health = m_registry->try_get<Components::Health>(attacker);

        if (!combat || (health && !health->isAlive())) {
            continue;
        }

        // Try to initiate attack
        if (combat->canPerformAttack()) {
            combat->startAttack();

            // Update character state if has controller
            if (auto* controller = m_registry->try_get<Components::CharacterController>(attacker)) {
                controller->setState(CharacterState::Attacking);
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

inline void CombatSystemEnTT::processDamage() {
    while (!m_pendingHits.empty()) {
        PendingHit hit = m_pendingHits.front();
        m_pendingHits.pop();

        entt::entity victim = findEntity(hit.victimID);
        if (victim == entt::null) {
            continue;
        }

        // Get health component
        auto* health = m_registry->try_get<Components::Health>(victim);
        if (!health || !health->isAlive()) {
            continue;
        }

        // Check friendly fire
        if (!m_config.friendlyFire && hit.attackerID == hit.victimID) {
            continue;
        }

        // Apply damage
        health->takeDamage(hit.damage, hit.attackerID);

        // Check if victim died
        if (!health->isAlive()) {
            // Update character state if has controller
            if (auto* controller = m_registry->try_get<Components::CharacterController>(victim)) {
                controller->setState(CharacterState::Dead);
            }

            // Could trigger death events, respawn logic, etc.
            // For now, character is just marked as dead
        }
    }
}

inline void CombatSystemEnTT::updateCooldowns(float deltaTime) {
    // Get all entities with combat controller
    auto view = m_registry->view<Components::CombatController>();

    for (auto entity : view) {
        auto& combat = view.get<Components::CombatController>(entity);

        // Update timers
        combat.updateTimers(deltaTime);

        // Check if attack finished and update state
        auto* controller = m_registry->try_get<Components::CharacterController>(entity);
        if (controller && !combat.isAttacking) {
            if (controller->state == CharacterState::Attacking) {
                // Return to idle or moving based on input
                if (controller->hasMovementInput()) {
                    controller->setState(CharacterState::Moving);
                } else {
                    controller->setState(CharacterState::Idle);
                }
            }
        }
    }
}

} // namespace ArenaGame
