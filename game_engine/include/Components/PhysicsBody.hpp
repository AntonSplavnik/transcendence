#pragma once

#include "../GameTypes.hpp"

namespace ArenaGame {
namespace Components {

// =============================================================================
// PhysicsBody - Physics properties for dynamic objects
// =============================================================================
// Pure data component - logic handled by PhysicsSystem
// Represents an object that moves and responds to forces
//
// Usage:
//   PhysicsBody body;
//   body.velocity = Vector3D(5, 0, 0);  // Moving right at 5 m/s
//   body.useGravity = true;
// =============================================================================

struct PhysicsBody {
	// Kinematics
	Vector3D velocity;          // Current velocity (m/s)
	Vector3D acceleration;      // Current acceleration (m/s²) - usually controlled by forces

	// Physical properties
	float mass;                 // Mass in kg (affects momentum, not currently used for forces)
	float friction;             // Friction coefficient (0 = no friction, 1 = full friction)
	float drag;                 // Air resistance (velocity damping)

	// Physics settings
	bool useGravity;            // Should gravity be applied?
	bool isKinematic;           // If true, not affected by forces (manually controlled)
	bool isGrounded;            // Is the object touching the ground?

	// Velocity limits
	float maxSpeed;             // Maximum horizontal speed (m/s)
	float maxFallSpeed;         // Maximum falling speed (m/s) - terminal velocity

	// Constructors
	PhysicsBody()
		: velocity(0.0f, 0.0f, 0.0f)
		, acceleration(0.0f, 0.0f, 0.0f)
		, mass(1.0f)
		, friction(GameConfig::FRICTION)
		, drag(0.0f)
		, useGravity(true)
		, isKinematic(false)
		, isGrounded(false)
		, maxSpeed(GameConfig::CHARACTER_MAX_SPEED)
		, maxFallSpeed(50.0f)
	{}

	// Helper methods
	void setVelocity(float x, float y, float z) {
		velocity.x = x;
		velocity.y = y;
		velocity.z = z;
	}

	void addVelocity(const Vector3D& deltaV) {
		velocity += deltaV;
	}

	void stopHorizontalMovement() {
		velocity.x = 0.0f;
		velocity.z = 0.0f;
	}

	void stopVerticalMovement() {
		velocity.y = 0.0f;
	}

	void stop() {
		velocity = Vector3D(0.0f, 0.0f, 0.0f);
		acceleration = Vector3D(0.0f, 0.0f, 0.0f);
	}

	// Queries
	float getSpeed() const {
		return velocity.length();
	}

	float getHorizontalSpeed() const {
		Vector3D horizontal(velocity.x, 0.0f, velocity.z);
		return horizontal.length();
	}

	bool isMoving() const {
		return velocity.lengthSquared() > 0.01f;
	}

	bool isFalling() const {
		return !isGrounded && velocity.y < -0.1f;
	}

	bool isRising() const {
		return !isGrounded && velocity.y > 0.1f;
	}

	// Static factory methods for common configurations
	static PhysicsBody createCharacter() {
		PhysicsBody body;
		body.mass = 70.0f;  // Average human mass
		body.friction = GameConfig::FRICTION;
		body.useGravity = true;
		body.maxSpeed = GameConfig::CHARACTER_MAX_SPEED;
		return body;
	}
	static PhysicsBody createProjectile() {
		PhysicsBody body;
		body.mass = 0.5f;
		body.friction = 0.0f;  // No friction for projectiles
		body.drag = 0.01f;     // Slight air resistance
		body.useGravity = true;
		body.maxSpeed = 100.0f;  // Fast projectiles
		return body;
	}
	static PhysicsBody createStatic() {
		PhysicsBody body;
		body.isKinematic = true;
		body.useGravity = false;
		body.velocity = Vector3D(0.0f, 0.0f, 0.0f);
		return body;
	}
};

} // namespace Components
} // namespace ArenaGame
