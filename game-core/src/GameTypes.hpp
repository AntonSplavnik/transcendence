#pragma once

#include <cstdint>
#include <chrono>
#include <cmath>

namespace ArenaGame {

// =============================================================================
// Core Types
// =============================================================================

using PlayerID = uint32_t;
using EntityID = uint32_t;
using Timestamp = std::chrono::steady_clock::time_point;

// =============================================================================
// Vector3D - Basic 3D vector for positions and velocities
// =============================================================================

struct Vector3D {
	float x;
	float y;  // Y is UP in this coordinate system
	float z;

	Vector3D() : x(0.0f), y(0.0f), z(0.0f) {}
	Vector3D(float x, float y, float z) : x(x), y(y), z(z) {}

	Vector3D operator+(const Vector3D& other) const {
		return Vector3D(x + other.x, y + other.y, z + other.z);
	}

	Vector3D operator-(const Vector3D& other) const {
		return Vector3D(x - other.x, y - other.y, z - other.z);
	}

	Vector3D operator*(float scalar) const {
		return Vector3D(x * scalar, y * scalar, z * scalar);
	}

	Vector3D& operator+=(const Vector3D& other) {
		x += other.x;
		y += other.y;
		z += other.z;
		return *this;
	}

	float length() const {
		return std::sqrt(x * x + y * y + z * z);
	}

	float lengthSquared() const {
		return x * x + y * y + z * z;
	}

	Vector3D normalized() const {
		float len = length();
		if (len > 0.0001f) {
			return Vector3D(x / len, y / len, z / len);
		}
		return Vector3D(0.0f, 0.0f, 0.0f);
	}

	float dot(const Vector3D& other) const {
		return x * other.x + y * other.y + z * other.z;
	}

	Vector3D cross(const Vector3D& other) const {
		return Vector3D(
			y * other.z - z * other.y,
			z * other.x - x * other.z,
			x * other.y - y * other.x
		);
	}

	float distanceTo(const Vector3D& other) const {
		return (*this - other).length();
	}

	// Helper: Get horizontal distance (ignore Y axis)
	float horizontalDistanceTo(const Vector3D& other) const {
		float dx = x - other.x;
		float dz = z - other.z;
		return std::sqrt(dx * dx + dz * dz);
	}

	// Helper: Project onto horizontal plane (XZ plane, Y=0)
	Vector3D horizontalProjection() const {
		return Vector3D(x, 0.0f, z);
	}
};

// =============================================================================
// Cylinder - For collision detection (characters are cylinders on ground plane)
// =============================================================================

struct Cylinder {
	Vector3D position;  // Center position (bottom of cylinder)
	float radius;       // Horizontal radius
	float height;       // Vertical height

	Cylinder() : position(), radius(0.0f), height(0.0f) {}
	Cylinder(const Vector3D& pos, float r, float h)
		: position(pos), radius(r), height(h) {}

	// Horizontal collision (XZ plane) - most common for character collision
	bool intersects(const Cylinder& other) const {
		float dx = position.x - other.position.x;
		float dz = position.z - other.position.z;
		float distSquared = dx * dx + dz * dz;
		float radiusSum = radius + other.radius;
		return distSquared < (radiusSum * radiusSum);
	}

	bool containsHorizontal(const Vector3D& point) const {
		float dx = position.x - point.x;
		float dz = position.z - point.z;
		return (dx * dx + dz * dz) < (radius * radius);
	}

	// Get the top position of the cylinder
	Vector3D getTop() const {
		return Vector3D(position.x, position.y + height, position.z);
	}
};

// =============================================================================
// Player Input State
// =============================================================================

struct InputState {
	// Movement input (normalized direction on XZ plane)
	Vector3D movementDirection;

	// Action inputs
	bool isAttacking;
	bool isUsingAbility1;
	bool isUsingAbility2;
	bool isJumping;
	bool isDodging;
	bool isSprinting;

	// Target position (for click-to-move or targeting)
	Vector3D targetPosition;
	bool hasTarget;

	// Optional: target entity for auto-attack
	EntityID targetEntityID;

	// Camera/look direction (for aiming projectiles)
	Vector3D lookDirection;

	InputState()
		: movementDirection()
		, isAttacking(false)
		, isUsingAbility1(false)
		, isUsingAbility2(false)
		, isJumping(false)
		, isDodging(false)
		, isSprinting(false)
		, targetPosition()
		, hasTarget(false)
		, targetEntityID(0)
		, lookDirection(0.0f, 0.0f, 1.0f)  // Forward by default
	{}

	void reset() {
		movementDirection = Vector3D(0.0f, 0.0f, 0.0f);
		isAttacking = false;
		isUsingAbility1 = false;
		isUsingAbility2 = false;
		isJumping = false;
		isDodging = false;
		hasTarget = false;
		targetEntityID = 0;
	}
};

// =============================================================================
// Character State (used for network sync)
// =============================================================================

enum class CharacterState : uint8_t {
	Idle = 0,
	Walking = 1,
	Sprinting = 2,
	Attacking = 3,
	Casting = 4,
	Stunned = 5,
	Dead = 6
};

// =============================================================================
// Game Mode types
// =============================================================================

enum class GameModeType : uint8_t {
	None           = 0xFF, // unset sentinel — must be replaced before use
	Deathmatch     = 0,
	LastStanding   = 1,
	WaveSurvival   = 2,
	TeamDeathmatch = 3,
};

enum class MatchStatus : uint8_t {
	WaitingToStart = 0,
	InProgress     = 1,
	Over           = 2,
};

// =============================================================================
// Game Configuration
// =============================================================================

struct GameConfig {
	// Arena dimensions (3D space)
	static constexpr float ARENA_WIDTH  = 50.0f;  // X axis (visual terrain is 50×50, centred at origin)
	static constexpr float ARENA_LENGTH = 50.0f;  // Z axis
	static constexpr float ARENA_HEIGHT = 20.0f;  // Y axis (ceiling)

	// Physics
	static constexpr float GRAVITY      = -20.0f;  // Gravity acceleration (m/s^2)
	static constexpr float GROUND_Y     =   0.0f;  // Ground level
	static constexpr float FRICTION     =  0.85f;  // Horizontal deceleration
	static constexpr float MIN_VELOCITY =   0.1f;  // Stop moving below this

	// Game loop timing
	static constexpr int   TARGET_FPS            = 60;
	static constexpr float FIXED_TIMESTEP        = 1.0f / TARGET_FPS;  // ~16.67ms
	static constexpr int   MAX_PHYSICS_ITERATIONS = 5;                  // Prevent spiral of death

	// Map data
	static constexpr const char* MAP_COLLIDERS_PATH = "data/map_colliders.json";

	// Network
	static constexpr int   MAX_PLAYERS      = 8;
	static constexpr float SNAPSHOT_RATE    = 60.0f;
	static constexpr float SNAPSHOT_INTERVAL = 1.0f / SNAPSHOT_RATE;
};

} // namespace ArenaGame
