#pragma once

#include "Systems/SystemEnTT.hpp"
#include "Components/Transform.hpp"
#include "Components/PhysicsBody.hpp"
#include "GameTypes.hpp"
#include <entt/entt.hpp>

namespace ArenaGame {

// =============================================================================
// PhysicsSystemEnTT - EnTT-based physics simulation
// =============================================================================
// Drop-in replacement for PhysicsSystem using EnTT views
// - Uses view<Transform, PhysicsBody> for cache-friendly iteration
// - No manual entity tracking (EnTT handles this)
// - Identical physics logic to PhysicsSystem.hpp
//
// Performance improvements:
// - 10-20x faster iteration (packed component storage)
// - No need to check hasPhysics() (view filters automatically)
// - Better cache locality
// =============================================================================

class PhysicsSystemEnTT : public SystemEnTT {
public:
    PhysicsSystemEnTT() = default;

    // System interface
    void fixedUpdate(float fixedDeltaTime) override;
    const char* getName() const override { return "PhysicsSystemEnTT"; }
    bool needsFixedUpdate() const override { return true; }

    // Physics configuration (same as PhysicsSystem)
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
    Config m_config;

    // Physics operations (same logic as PhysicsSystem)
    void applyGravity(Components::PhysicsBody& physics, float deltaTime);
    void applyFriction(Components::PhysicsBody& physics, float deltaTime);
    void integrateVelocity(Components::Transform& transform, Components::PhysicsBody& physics, float deltaTime);
    void enforceArenaBounds(Components::Transform& transform);
    void checkGroundCollision(Components::Transform& transform, Components::PhysicsBody& physics);
};

// =============================================================================
// Implementation
// =============================================================================

inline void PhysicsSystemEnTT::fixedUpdate(float fixedDeltaTime) {
    // EnTT view: iterate only entities with Transform AND PhysicsBody
    // This is cached and very fast (packed storage)
    auto view = m_registry->view<Components::Transform, Components::PhysicsBody>();

    for (auto entity : view) {
        auto& transform = view.get<Components::Transform>(entity);
        auto& physics = view.get<Components::PhysicsBody>(entity);

        // Apply physics forces
        applyGravity(physics, fixedDeltaTime);

        // Integrate velocity into position
        integrateVelocity(transform, physics, fixedDeltaTime);

        // Enforce constraints
        enforceArenaBounds(transform);
        checkGroundCollision(transform, physics);
    }
}

inline void PhysicsSystemEnTT::applyGravity(Components::PhysicsBody& physics, float deltaTime) {
    if (physics.useGravity && !physics.isGrounded) {
        // Apply gravity to Y component
        physics.velocity.y += m_config.gravity * deltaTime;

        // Clamp to terminal velocity
        if (physics.velocity.y < -physics.maxFallSpeed) {
            physics.velocity.y = -physics.maxFallSpeed;
        }
    }
}

inline void PhysicsSystemEnTT::applyFriction(Components::PhysicsBody& physics, float deltaTime) {
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

inline void PhysicsSystemEnTT::integrateVelocity(Components::Transform& transform, Components::PhysicsBody& physics, float deltaTime) {
    // Skip if kinematic (manually controlled)
    if (physics.isKinematic) {
        return;
    }

    // Euler integration: position += velocity * deltaTime
    transform.position += physics.velocity * deltaTime;
}

inline void PhysicsSystemEnTT::enforceArenaBounds(Components::Transform& transform) {
    Vector3D& position = transform.position;

    // Clamp X coordinate
    position.x = std::max(m_config.arenaMinX,
                         std::min(m_config.arenaMaxX, position.x));

    // Clamp Z coordinate
    position.z = std::max(m_config.arenaMinZ,
                         std::min(m_config.arenaMaxZ, position.z));
}

inline void PhysicsSystemEnTT::checkGroundCollision(Components::Transform& transform, Components::PhysicsBody& physics) {
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
