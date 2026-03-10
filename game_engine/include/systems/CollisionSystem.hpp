#pragma once

#include "System.hpp"
#include "Components/Transform.hpp"
#include "Components/Collider.hpp"
#include "Components/PhysicsBody.hpp"
#include "Components/Health.hpp"
#include "GameTypes.hpp"
#include <entt/entt.hpp>
#include <algorithm>

namespace ArenaGame {

// =============================================================================
// CollisionSystem - EnTT-based collision detection and resolution
// =============================================================================
// Drop-in replacement for CollisionSystem using EnTT views
// - Uses view<Transform, Collider> for iteration
// - Better performance with EnTT groups (cache-friendly)
// - Identical collision logic to CollisionSystem.hpp
//
// Performance improvements:
// - Packed storage for better cache locality
// - Can use EnTT groups for hot path optimization
// - No manual entity tracking needed
// =============================================================================

class CollisionSystem : public System {
public:
    CollisionSystem() = default;

    // System interface
    void fixedUpdate(float fixedDeltaTime) override;
    const char* getName() const override { return "CollisionSystem"; }
    bool needsFixedUpdate() const override { return true; }

    // Collision configuration (same as CollisionSystem)
    struct Config {
        bool enableCharacterCollision = true;
        float pushStrength = 0.5f;  // How much to push entities apart
        float minSeparation = 0.01f; // Minimum distance to avoid jitter
    };

    const Config& getConfig() const { return m_config; }
    void setConfig(const Config& config) { m_config = config; }

    // Future: Raycasting for projectiles
    struct RaycastHit {
        bool hit = false;
        Vector3D point;
        float distance = 0.0f;
        entt::entity hitEntity = entt::null;
    };

private:
    Config m_config;

    // Collision detection helpers
    bool checkCollision(
        const Components::Transform& transformA, const Components::Collider& colliderA,
        const Components::Transform& transformB, const Components::Collider& colliderB
    ) const;

    void resolveCollision(
        Components::Transform& transformA, const Components::Collider& colliderA,
        Components::Transform& transformB, const Components::Collider& colliderB,
        const Components::PhysicsBody* physicsA, const Components::PhysicsBody* physicsB
    );
};

// =============================================================================
// Implementation
// =============================================================================

inline void CollisionSystem::fixedUpdate(float fixedDeltaTime) {
    if (!m_config.enableCharacterCollision) {
        return;
    }

    // Get view of all entities with Transform + Collider
    auto view = m_registry->view<Components::Transform, Components::Collider>();

    // Convert view to vector for indexed access (needed for O(n²) pair iteration)
    std::vector<entt::entity> entities;
    entities.reserve(view.size_hint());
    for (auto entity : view) {
        entities.push_back(entity);
    }

    // Simple O(n²) collision detection
    // For larger entity counts (>50), use spatial partitioning
    for (size_t i = 0; i < entities.size(); ++i) {
        entt::entity entityA = entities[i];

        auto& transformA = m_registry->get<Components::Transform>(entityA);
        auto& colliderA = m_registry->get<Components::Collider>(entityA);

        // Skip if dead (has health and is not alive)
        if (auto* healthA = m_registry->try_get<Components::Health>(entityA)) {
            if (!healthA->isAlive()) {
                continue;
            }
        }

        for (size_t j = i + 1; j < entities.size(); ++j) {
            entt::entity entityB = entities[j];

            auto& transformB = m_registry->get<Components::Transform>(entityB);
            auto& colliderB = m_registry->get<Components::Collider>(entityB);

            // Skip if dead
            if (auto* healthB = m_registry->try_get<Components::Health>(entityB)) {
                if (!healthB->isAlive()) {
                    continue;
                }
            }

            // Check if they should collide (layer filtering)
            if (!colliderA.shouldCollideWith(colliderB)) {
                continue;
            }

            // Check collision
            if (checkCollision(transformA, colliderA, transformB, colliderB)) {
                // Get physics bodies (may be null)
                auto* physicsA = m_registry->try_get<Components::PhysicsBody>(entityA);
                auto* physicsB = m_registry->try_get<Components::PhysicsBody>(entityB);

                resolveCollision(transformA, colliderA, transformB, colliderB, physicsA, physicsB);
            }
        }
    }
}

inline bool CollisionSystem::checkCollision(
    const Components::Transform& transformA, const Components::Collider& colliderA,
    const Components::Transform& transformB, const Components::Collider& colliderB
) const {
    // Get collision cylinders
    Cylinder cylA = colliderA.getCylinder(transformA.position);
    Cylinder cylB = colliderB.getCylinder(transformB.position);

    // Check horizontal collision (XZ plane) using cylinder intersection
    return cylA.intersects(cylB);
}

inline void CollisionSystem::resolveCollision(
    Components::Transform& transformA, const Components::Collider& colliderA,
    Components::Transform& transformB, const Components::Collider& colliderB,
    const Components::PhysicsBody* physicsA, const Components::PhysicsBody* physicsB
) {
    Vector3D posA = transformA.position;
    Vector3D posB = transformB.position;

    // Calculate horizontal separation vector (ignore Y)
    Vector3D separation(posB.x - posA.x, 0.0f, posB.z - posA.z);
    float distance = separation.length();

    // If entities are overlapping
    if (distance < m_config.minSeparation) {
        // Avoid division by zero - push apart in arbitrary direction
        separation = Vector3D(1.0f, 0.0f, 0.0f);
        distance = 1.0f;
    }

    // Calculate required separation
    float requiredDistance = colliderA.radius + colliderB.radius;

    // Only resolve if overlapping
    if (distance < requiredDistance) {
        Vector3D pushDirection = separation.normalized();
        float overlap = requiredDistance - distance;

        // Determine push ratios based on whether entities are static
        bool aIsStatic = physicsA && physicsA->isKinematic;
        bool bIsStatic = physicsB && physicsB->isKinematic;

        Vector3D pushVector = pushDirection * (overlap * m_config.pushStrength);

        if (aIsStatic && !bIsStatic) {
            // Only push B
            posB = posB + (pushVector * 2.0f);
        } else if (!aIsStatic && bIsStatic) {
            // Only push A
            posA = posA - (pushVector * 2.0f);
        } else if (!aIsStatic && !bIsStatic) {
            // Push both (50/50 split)
            posA = posA - pushVector;
            posB = posB + pushVector;
        }
        // If both static, don't push

        // Update positions
        transformA.position = posA;
        transformB.position = posB;
    }
}

} // namespace ArenaGame
