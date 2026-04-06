#pragma once

#include "System.hpp"
#include "../components/Transform.hpp"
#include "../components/PhysicsBody.hpp"
#include "../components/Collider.hpp"
#include "../GameTypes.hpp"
#include "../../entt/entt.hpp"

namespace ArenaGame {

// =============================================================================
// PhysicsSystem - Simulates gravity, friction, and positional integration
// =============================================================================
// - Applies gravity and friction to all entities with PhysicsBody
// - Integrates velocity into position (Euler integration)
// - Enforces arena bounds and ground collision
//
// Should run in fixedUpdate phase (before collision)
// =============================================================================

class PhysicsSystem : public System {
public:
	PhysicsSystem() = default;

	// System interface
	void fixedUpdate(float fixedDeltaTime) override;
	const char* getName() const override { return "PhysicsSystem"; }
	bool needsFixedUpdate() const override { return true; }

	// Physics configuration
	struct Config {
		float gravity     = GameConfig::GRAVITY;
		float friction    = GameConfig::FRICTION;
		float minVelocity = GameConfig::MIN_VELOCITY;
		float groundY     = GameConfig::GROUND_Y;

		// Raw arena edges (centred at origin) — collider radius offset applied per-entity
		float arenaMinX = -(GameConfig::ARENA_WIDTH  / 2.0f);
		float arenaMaxX =  (GameConfig::ARENA_WIDTH  / 2.0f);
		float arenaMinZ = -(GameConfig::ARENA_LENGTH / 2.0f);
		float arenaMaxZ =  (GameConfig::ARENA_LENGTH / 2.0f);
	};

	const Config& getConfig() const { return m_config; }
	void setConfig(const Config& config) { m_config = config; }

private:
	Config m_config;

	// Physics operations
	void applyGravity(Components::PhysicsBody& physics, float deltaTime);
	void applyFriction(Components::PhysicsBody& physics, float deltaTime);
	void integrateVelocity(Components::Transform& transform, Components::PhysicsBody& physics, float deltaTime);
	void enforceArenaBounds(Components::Transform& transform, const Components::Collider& collider);
	void checkGroundCollision(Components::Transform& transform, Components::PhysicsBody& physics);
};

// =============================================================================
// Implementation
// =============================================================================

inline void PhysicsSystem::fixedUpdate(float fixedDeltaTime) {
	auto view = m_registry->view<Components::Transform, Components::PhysicsBody, Components::Collider>();

	view.each([&](Components::Transform& transform, Components::PhysicsBody& physics, Components::Collider& collider) {
		applyGravity(physics, fixedDeltaTime);
		integrateVelocity(transform, physics, fixedDeltaTime);
		enforceArenaBounds(transform, collider);
		checkGroundCollision(transform, physics);
	});
}

inline void PhysicsSystem::applyGravity(Components::PhysicsBody& physics, float deltaTime) {
	if (physics.useGravity && !physics.isGrounded) {
		// Apply gravity to Y component
		physics.velocity.y += m_config.gravity * deltaTime;

		// Clamp to terminal velocity
		if (physics.velocity.y < -physics.maxFallSpeed) {
			physics.velocity.y = -physics.maxFallSpeed;
		}
	}
}

inline void PhysicsSystem::applyFriction(Components::PhysicsBody& physics, [[maybe_unused]] float deltaTime) {
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

inline void PhysicsSystem::integrateVelocity(Components::Transform& transform, Components::PhysicsBody& physics, float deltaTime) {
	// Skip if kinematic (manually controlled)
	if (physics.isKinematic) {
		return;
	}

	// Euler integration: position += velocity * deltaTime
	transform.position += physics.velocity * deltaTime;
}

inline void PhysicsSystem::enforceArenaBounds(Components::Transform& transform, const Components::Collider& collider) {
	Vector3D& position = transform.position;
	const float r = collider.radius;

	position.x = std::max(m_config.arenaMinX + r, std::min(m_config.arenaMaxX - r, position.x));
	position.z = std::max(m_config.arenaMinZ + r, std::min(m_config.arenaMaxZ - r, position.z));
}

inline void PhysicsSystem::checkGroundCollision(Components::Transform& transform, Components::PhysicsBody& physics) {
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
