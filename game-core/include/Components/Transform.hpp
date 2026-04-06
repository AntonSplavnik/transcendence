#pragma once

#include "../GameTypes.hpp"
#include <cmath>

namespace ArenaGame {
namespace Components {

// =============================================================================
// Transform - Position, rotation, and scale in 3D space
// =============================================================================
// Pure data component - no logic
// Represents the spatial transformation of an entity
//
// Usage:
//   Transform transform;
//   transform.position = Vector3D(10, 0, 5);
//   transform.rotation.y = M_PI / 4;  // 45 degrees around Y axis
// =============================================================================

struct Transform {
	Vector3D position;      // World position (x, y, z)
	Vector3D rotation;      // Euler angles in radians (pitch, yaw, roll)
	Vector3D scale;         // Scale factors (x, y, z)

	// Constructors
	Transform()
		: position(0.0f, 0.0f, 0.0f)
		, rotation(0.0f, 0.0f, 0.0f)
		, scale(1.0f, 1.0f, 1.0f)
	{}

	Transform(const Vector3D& pos)
		: position(pos)
		, rotation(0.0f, 0.0f, 0.0f)
		, scale(1.0f, 1.0f, 1.0f)
	{}

	Transform(const Vector3D& pos, const Vector3D& rot)
		: position(pos)
		, rotation(rot)
		, scale(1.0f, 1.0f, 1.0f)
	{}

	// Helper methods for common operations
	void setPosition(float x, float y, float z) {
		position.x = x;
		position.y = y;
		position.z = z;
	}

	void translate(const Vector3D& offset) {
		position += offset;
	}

	void setRotation(float pitch, float yaw, float roll) {
		rotation.x = pitch;
		rotation.y = yaw;
		rotation.z = roll;
	}

	void rotate(float pitch, float yaw, float roll) {
		rotation.x += pitch;
		rotation.y += yaw;
		rotation.z += roll;
	}

	// Get forward direction based on yaw rotation (Y-up coordinate system)
	Vector3D getForwardDirection() const {
		float yaw = rotation.y;
		return Vector3D(std::sin(yaw), 0.0f, std::cos(yaw));
	}

	// Get right direction based on yaw rotation
	Vector3D getRightDirection() const {
		float yaw = rotation.y;
		return Vector3D(std::cos(yaw), 0.0f, -std::sin(yaw));
	}

	// Get up direction (always Y-up for now)
	Vector3D getUpDirection() const {
		return Vector3D(0.0f, 1.0f, 0.0f);
	}

	// Quick access to yaw (most common for top-down/third-person games)
	float getYaw() const { return rotation.y; }
	void setYaw(float yaw) { rotation.y = yaw; }

	float getPitch() const { return rotation.x; }
	void setPitch(float pitch) { rotation.x = pitch; }

	float getRoll() const { return rotation.z; }
	void setRoll(float roll) { rotation.z = roll; }
};

} // namespace Components
} // namespace ArenaGame
