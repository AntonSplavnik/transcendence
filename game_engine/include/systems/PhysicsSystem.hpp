#pragma once

#include "System.hpp"
#include "GameTypes.hpp"
#include "Core/Entity.hpp"
#include <vector>
#include <memory>

namespace ArenaGame {

// =============================================================================
// PhysicsSystem - Handles all physics simulation
// =============================================================================
// Responsibilities:
// - Apply gravity to falling objects
// - Apply friction to moving objects
// - Integrate velocity → position
// - Enforce arena boundaries
// - Ground detection
//
// Works with entities that have Transform + PhysicsBody components
// =============================================================================

class PhysicsSystem : public System {
public:
    PhysicsSystem();

    // System interface
    void fixedUpdate(float fixedDeltaTime) override;  // Physics uses fixed timestep
    const char* getName() const override { return "PhysicsSystem"; }
    bool needsFixedUpdate() const override { return true; }

    // Register entities that need physics simulation
    void addEntity(Core::Entity* entity);
    void removeEntity(Core::Entity* entity);
    void clear();

    // Physics configuration
    struct Config {
        float gravity = GameConfig::GRAVITY;
        float friction = GameConfig::FRICTION;
        float minVelocity = GameConfig::MIN_VELOCITY;
        float groundY = GameConfig::GROUND_Y;

        // Arena bounds
        float arenaMinX = GameConfig::CHARACTER_RADIUS;
        float arenaMaxX = GameConfig::ARENA_WIDTH - GameConfig::CHARACTER_RADIUS;
        float arenaMinZ = GameConfig::CHARACTER_RADIUS;
        float arenaMaxZ = GameConfig::ARENA_LENGTH - GameConfig::CHARACTER_RADIUS;
    };

    const Config& getConfig() const { return m_config; }
    void setConfig(const Config& config) { m_config = config; }

private:
    std::vector<Core::Entity*> m_entities;
    Config m_config;

    // Physics operations
    void applyGravity(Core::Entity* entity, float deltaTime);
    void applyFriction(Core::Entity* entity, float deltaTime);
    void integrateVelocity(Core::Entity* entity, float deltaTime);
    void enforceArenaBounds(Core::Entity* entity);
    void checkGroundCollision(Core::Entity* entity);
};

// =============================================================================
// Implementation
// =============================================================================

inline PhysicsSystem::PhysicsSystem() {
    m_entities.reserve(32); // Pre-allocate for typical game size
}

inline void PhysicsSystem::fixedUpdate(float fixedDeltaTime) {
    for (Core::Entity* entity : m_entities) {
        if (!entity || !entity->hasTransform() || !entity->hasPhysics()) {
            continue;
        }

        // Apply physics forces
        applyGravity(entity, fixedDeltaTime);

        // Integrate velocity into position
        integrateVelocity(entity, fixedDeltaTime);

        // Enforce constraints
        enforceArenaBounds(entity);
        checkGroundCollision(entity);
    }
}

inline void PhysicsSystem::addEntity(Core::Entity* entity) {
    if (entity && entity->hasPhysics()) {
        m_entities.push_back(entity);
    }
}

inline void PhysicsSystem::removeEntity(Core::Entity* entity) {
    m_entities.erase(
        std::remove(m_entities.begin(), m_entities.end(), entity),
        m_entities.end()
    );
}

inline void PhysicsSystem::clear() {
    m_entities.clear();
}

inline void PhysicsSystem::applyGravity(Core::Entity* entity, float deltaTime) {
    auto& physics = entity->getPhysics();

    if (physics.useGravity && !physics.isGrounded) {
        // Apply gravity to Y component
        physics.velocity.y += m_config.gravity * deltaTime;

        // Clamp to terminal velocity
        if (physics.velocity.y < -physics.maxFallSpeed) {
            physics.velocity.y = -physics.maxFallSpeed;
        }
    }
}

inline void PhysicsSystem::applyFriction(Core::Entity* entity, float deltaTime) {
    auto& physics = entity->getPhysics();

    // Apply friction only to horizontal movement (X and Z)
    physics.velocity.x *= m_config.friction;
    physics.velocity.z *= m_config.friction;

    // Stop if velocity is too small
    Vector3D horizontalVel(physics.velocity.x, 0.0f, physics.velocity.z);
    if (horizontalVel.lengthSquared() < m_config.minVelocity * m_config.minVelocity) {
        physics.velocity.x = 0.0f;
        physics.velocity.z = 0.0f;
    }
}

inline void PhysicsSystem::integrateVelocity(Core::Entity* entity, float deltaTime) {
    auto& transform = entity->getTransform();
    auto& physics = entity->getPhysics();

    // Skip if kinematic (manually controlled)
    if (physics.isKinematic) {
        return;
    }

    // Euler integration: position += velocity * deltaTime
    transform.position += physics.velocity * deltaTime;
}

inline void PhysicsSystem::enforceArenaBounds(Core::Entity* entity) {
    auto& transform = entity->getTransform();
    Vector3D& position = transform.position;

    // Clamp X coordinate
    position.x = std::max(m_config.arenaMinX,
                         std::min(m_config.arenaMaxX, position.x));

    // Clamp Z coordinate
    position.z = std::max(m_config.arenaMinZ,
                         std::min(m_config.arenaMaxZ, position.z));
}

inline void PhysicsSystem::checkGroundCollision(Core::Entity* entity) {
    auto& transform = entity->getTransform();
    auto& physics = entity->getPhysics();
    Vector3D& position = transform.position;

    // If below ground, snap to ground
    if (position.y <= m_config.groundY) {
        position.y = m_config.groundY;
        physics.velocity.y = 0.0f;
        physics.isGrounded = true;
    } else {
        // In air
        physics.isGrounded = false;
    }
}

} // namespace ArenaGame
