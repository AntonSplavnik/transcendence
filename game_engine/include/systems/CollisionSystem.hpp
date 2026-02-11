#pragma once

#include "System.hpp"
#include "GameTypes.hpp"
#include "Core/Entity.hpp"
#include <vector>
#include <algorithm>

namespace ArenaGame {

// =============================================================================
// CollisionSystem - Handles collision detection and resolution
// =============================================================================
// Responsibilities:
// - Detect collisions between entities
// - Resolve collisions (push-apart, bounce, etc.)
// - Raycasting for projectiles (future)
// - Wall collision detection (future)
//
// Works with entities that have Transform + Collider components
// =============================================================================

class CollisionSystem : public System {
public:
    CollisionSystem();

    // System interface
    void fixedUpdate(float fixedDeltaTime) override;  // Collision uses fixed timestep
    const char* getName() const override { return "CollisionSystem"; }
    bool needsFixedUpdate() const override { return true; }

    // Register entities for collision detection
    void addEntity(Core::Entity* entity);
    void removeEntity(Core::Entity* entity);
    void clear();

    // Collision configuration
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
        Core::Entity* hitEntity = nullptr;
    };

    // RaycastHit raycast(const Vector3D& origin, const Vector3D& direction, float maxDistance);

private:
    std::vector<Core::Entity*> m_entities;
    Config m_config;

    // Collision detection
    bool checkCollision(const Core::Entity* a, const Core::Entity* b) const;
    void resolveCollision(Core::Entity* a, Core::Entity* b);
};

// =============================================================================
// Implementation
// =============================================================================

inline CollisionSystem::CollisionSystem() {
    m_entities.reserve(32);
}

inline void CollisionSystem::fixedUpdate(float fixedDeltaTime) {
    if (!m_config.enableCharacterCollision) {
        return;
    }

    // Simple O(n²) collision detection
    // For larger entity counts (>50), use spatial partitioning (quadtree, grid)
    for (size_t i = 0; i < m_entities.size(); ++i) {
        Core::Entity* entityA = m_entities[i];
        if (!entityA || !entityA->hasTransform() || !entityA->hasCollider()) {
            continue;
        }

        // Skip if dead (has health and is not alive)
        if (entityA->hasHealth() && !entityA->isAlive()) {
            continue;
        }

        for (size_t j = i + 1; j < m_entities.size(); ++j) {
            Core::Entity* entityB = m_entities[j];
            if (!entityB || !entityB->hasTransform() || !entityB->hasCollider()) {
                continue;
            }

            // Skip if dead
            if (entityB->hasHealth() && !entityB->isAlive()) {
                continue;
            }

            // Check if they should collide (layer filtering)
            if (!entityA->getCollider().shouldCollideWith(entityB->getCollider())) {
                continue;
            }

            // Check collision
            if (checkCollision(entityA, entityB)) {
                resolveCollision(entityA, entityB);
            }
        }
    }
}

inline void CollisionSystem::addEntity(Core::Entity* entity) {
    if (entity && entity->hasCollider()) {
        m_entities.push_back(entity);
    }
}

inline void CollisionSystem::removeEntity(Core::Entity* entity) {
    m_entities.erase(
        std::remove(m_entities.begin(), m_entities.end(), entity),
        m_entities.end()
    );
}

inline void CollisionSystem::clear() {
    m_entities.clear();
}

inline bool CollisionSystem::checkCollision(const Core::Entity* a, const Core::Entity* b) const {
    const auto& transformA = a->getTransform();
    const auto& transformB = b->getTransform();
    const auto& colliderA = a->getCollider();
    const auto& colliderB = b->getCollider();

    // Get collision cylinders
    Cylinder cylA = colliderA.getCylinder(transformA.position);
    Cylinder cylB = colliderB.getCylinder(transformB.position);

    // Check horizontal collision (XZ plane) using cylinder intersection
    return cylA.intersects(cylB);
}

inline void CollisionSystem::resolveCollision(Core::Entity* a, Core::Entity* b) {
    auto& transformA = a->getTransform();
    auto& transformB = b->getTransform();
    const auto& colliderA = a->getCollider();
    const auto& colliderB = b->getCollider();

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
        bool aIsStatic = a->hasPhysics() && a->getPhysics().isKinematic;
        bool bIsStatic = b->hasPhysics() && b->getPhysics().isKinematic;

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
