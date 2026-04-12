#pragma once

#include "System.hpp"
#include "../components/Transform.hpp"
#include "../components/Collider.hpp"
#include "../components/PhysicsBody.hpp"
#include "../components/Health.hpp"
#include "../GameTypes.hpp"
#include "../../entt/entt.hpp"
#include <algorithm>
#include <cmath>
#include <vector>

namespace ArenaGame {

// =============================================================================
// CollisionSystem - Detects and resolves collisions between entities
// =============================================================================
// - Iterates all entity pairs with Transform + Collider components
// - Filters by collision layer (shouldCollideWith) and skips dead entities
// - Resolves overlap by pushing entities apart based on kinematic flags
//
// Should run in fixedUpdate phase (after physics integration)
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

	struct HorizontalProjection {
		Vector3D center;
		float radius;
		Vector3D halfExtents;
		bool isBox;
	};

	// Collision detection helpers
	HorizontalProjection getHorizontalProjection(const Components::Transform& transform, const Components::Collider& collider) const;
	bool checkCollision(
		const Components::Transform& transformA, const Components::Collider& colliderA,
		const Components::Transform& transformB, const Components::Collider& colliderB
	) const;

	bool intersectsCircleCircle(const HorizontalProjection& a, const HorizontalProjection& b) const;
	bool intersectsBoxBox(const HorizontalProjection& a, const HorizontalProjection& b) const;
	bool intersectsCircleBox(const HorizontalProjection& circle, const HorizontalProjection& box) const;

	Vector3D computeSeparationVector(
		const Components::Transform& transformA, const Components::Collider& colliderA,
		const Components::Transform& transformB, const Components::Collider& colliderB
	) const;
	Vector3D computeCircleCircleSeparation(const HorizontalProjection& a, const HorizontalProjection& b) const;
	Vector3D computeBoxBoxSeparation(const HorizontalProjection& a, const HorizontalProjection& b) const;
	Vector3D computeCircleBoxSeparation(const HorizontalProjection& circle, const HorizontalProjection& box) const;

	void resolveCollision(
		Components::Transform& transformA, const Components::Collider& colliderA,
		Components::Transform& transformB, const Components::Collider& colliderB,
		const Components::PhysicsBody* physicsA, const Components::PhysicsBody* physicsB
	);
};

// =============================================================================
// Implementation
// =============================================================================

inline void CollisionSystem::fixedUpdate([[maybe_unused]] float fixedDeltaTime) {
	if (!m_config.enableCharacterCollision) {
		return;
	}

	// Get view of all entities with Transform + Collider
	auto view = m_registry->view<Components::Transform, Components::Collider>();


	// Convert view to vector for indexed access (needed for O(n²) pair iteration)
	std::vector<entt::entity> entities;
	entities.reserve(view.size_hint());
	view.each([&](auto entity, [[maybe_unused]] Components::Transform& transform, [[maybe_unused]] Components::Collider& collider) {
		entities.push_back(entity);
	});

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
	auto projectionA = getHorizontalProjection(transformA, colliderA);
	auto projectionB = getHorizontalProjection(transformB, colliderB);

	if (projectionA.isBox && projectionB.isBox) {
		return intersectsBoxBox(projectionA, projectionB);
	}

	if (!projectionA.isBox && !projectionB.isBox) {
		return intersectsCircleCircle(projectionA, projectionB);
	}

	if (!projectionA.isBox) {
		return intersectsCircleBox(projectionA, projectionB);
	}

	return intersectsCircleBox(projectionB, projectionA);
}

inline void CollisionSystem::resolveCollision(
	Components::Transform& transformA, const Components::Collider& colliderA,
	Components::Transform& transformB, const Components::Collider& colliderB,
	const Components::PhysicsBody* physicsA, const Components::PhysicsBody* physicsB
) {
	Vector3D separation = computeSeparationVector(transformA, colliderA, transformB, colliderB);
	if (separation.lengthSquared() == 0.0f) {
		return;
	}

	bool aIsStatic = physicsA && physicsA->isKinematic;
	bool bIsStatic = physicsB && physicsB->isKinematic;
	Vector3D pushVector = separation * m_config.pushStrength;

	if (aIsStatic && bIsStatic) {
		return;
	}

	if (aIsStatic) {
		transformB.position = transformB.position - (pushVector * 2.0f);
	} else if (bIsStatic) {
		transformA.position += pushVector * 2.0f;
	} else {
		transformA.position += pushVector;
		transformB.position = transformB.position - pushVector;
	}
}

inline CollisionSystem::HorizontalProjection CollisionSystem::getHorizontalProjection(
	const Components::Transform& transform, const Components::Collider& collider
) const {
	HorizontalProjection projection;
	projection.center = transform.position + collider.offset;
	projection.isBox = collider.shape == Components::Collider::Shape::Box;
	projection.radius = projection.isBox ? 0.0f : collider.radius;
	projection.halfExtents = projection.isBox
		? Vector3D(collider.halfExtents.x, 0.0f, collider.halfExtents.z)
		: Vector3D(collider.radius, 0.0f, collider.radius);
	return projection;
}

inline bool CollisionSystem::intersectsCircleCircle(const HorizontalProjection& a, const HorizontalProjection& b) const {
	float dx = a.center.x - b.center.x;
	float dz = a.center.z - b.center.z;
	float radiusSum = a.radius + b.radius;
	return (dx * dx + dz * dz) < (radiusSum * radiusSum);
}

inline bool CollisionSystem::intersectsBoxBox(const HorizontalProjection& a, const HorizontalProjection& b) const {
	float aMinX = a.center.x - a.halfExtents.x;
	float aMaxX = a.center.x + a.halfExtents.x;
	float aMinZ = a.center.z - a.halfExtents.z;
	float aMaxZ = a.center.z + a.halfExtents.z;

	float bMinX = b.center.x - b.halfExtents.x;
	float bMaxX = b.center.x + b.halfExtents.x;
	float bMinZ = b.center.z - b.halfExtents.z;
	float bMaxZ = b.center.z + b.halfExtents.z;

	return (aMinX < bMaxX && aMaxX > bMinX) && (aMinZ < bMaxZ && aMaxZ > bMinZ);
}

inline bool CollisionSystem::intersectsCircleBox(const HorizontalProjection& circle, const HorizontalProjection& box) const {
	float minX = box.center.x - box.halfExtents.x;
	float maxX = box.center.x + box.halfExtents.x;
	float minZ = box.center.z - box.halfExtents.z;
	float maxZ = box.center.z + box.halfExtents.z;

	float closestX = std::clamp(circle.center.x, minX, maxX);
	float closestZ = std::clamp(circle.center.z, minZ, maxZ);
	float dx = circle.center.x - closestX;
	float dz = circle.center.z - closestZ;

	return (dx * dx + dz * dz) < (circle.radius * circle.radius);
}

inline Vector3D CollisionSystem::computeSeparationVector(
	const Components::Transform& transformA, const Components::Collider& colliderA,
	const Components::Transform& transformB, const Components::Collider& colliderB
) const {
	auto projectionA = getHorizontalProjection(transformA, colliderA);
	auto projectionB = getHorizontalProjection(transformB, colliderB);

	if (projectionA.isBox && projectionB.isBox) {
		return computeBoxBoxSeparation(projectionA, projectionB);
	}

	if (!projectionA.isBox && !projectionB.isBox) {
		return computeCircleCircleSeparation(projectionA, projectionB);
	}

	if (!projectionA.isBox) {
		return computeCircleBoxSeparation(projectionA, projectionB);
	}

	return computeCircleBoxSeparation(projectionB, projectionA) * -1.0f;
}

inline Vector3D CollisionSystem::computeCircleCircleSeparation(const HorizontalProjection& a, const HorizontalProjection& b) const {
	Vector3D separation(a.center.x - b.center.x, 0.0f, a.center.z - b.center.z);
	float distance = separation.length();
	float requiredDistance = a.radius + b.radius;

	if (distance < m_config.minSeparation) {
		separation = Vector3D(1.0f, 0.0f, 0.0f);
		distance = 1.0f;
	}

	if (distance >= requiredDistance) {
		return Vector3D(0.0f, 0.0f, 0.0f);
	}

	return separation.normalized() * (requiredDistance - distance);
}

inline Vector3D CollisionSystem::computeBoxBoxSeparation(const HorizontalProjection& a, const HorizontalProjection& b) const {
	float aMinX = a.center.x - a.halfExtents.x;
	float aMaxX = a.center.x + a.halfExtents.x;
	float aMinZ = a.center.z - a.halfExtents.z;
	float aMaxZ = a.center.z + a.halfExtents.z;

	float bMinX = b.center.x - b.halfExtents.x;
	float bMaxX = b.center.x + b.halfExtents.x;
	float bMinZ = b.center.z - b.halfExtents.z;
	float bMaxZ = b.center.z + b.halfExtents.z;

	float overlapX = std::min(aMaxX, bMaxX) - std::max(aMinX, bMinX);
	float overlapZ = std::min(aMaxZ, bMaxZ) - std::max(aMinZ, bMinZ);

	if (overlapX <= 0.0f || overlapZ <= 0.0f) {
		return Vector3D(0.0f, 0.0f, 0.0f);
	}

	if (overlapX < overlapZ) {
		float direction = (a.center.x < b.center.x) ? -1.0f : 1.0f;
		return Vector3D(direction * overlapX, 0.0f, 0.0f);
	}

	float direction = (a.center.z < b.center.z) ? -1.0f : 1.0f;
	return Vector3D(0.0f, 0.0f, direction * overlapZ);
}

inline Vector3D CollisionSystem::computeCircleBoxSeparation(const HorizontalProjection& circle, const HorizontalProjection& box) const {
	float minX = box.center.x - box.halfExtents.x;
	float maxX = box.center.x + box.halfExtents.x;
	float minZ = box.center.z - box.halfExtents.z;
	float maxZ = box.center.z + box.halfExtents.z;

	float closestX = std::clamp(circle.center.x, minX, maxX);
	float closestZ = std::clamp(circle.center.z, minZ, maxZ);
	float dx = circle.center.x - closestX;
	float dz = circle.center.z - closestZ;
	float distanceSquared = dx * dx + dz * dz;

	if (distanceSquared > 0.0f) {
		float distance = std::sqrt(distanceSquared);
		if (distance >= circle.radius) {
			return Vector3D(0.0f, 0.0f, 0.0f);
		}

		Vector3D direction(dx / distance, 0.0f, dz / distance);
		return direction * (circle.radius - distance);
	}

	float leftPush = (circle.center.x - minX) + circle.radius;
	float rightPush = (maxX - circle.center.x) + circle.radius;
	float downPush = (circle.center.z - minZ) + circle.radius;
	float upPush = (maxZ - circle.center.z) + circle.radius;

	if (leftPush <= rightPush && leftPush <= downPush && leftPush <= upPush) {
		return Vector3D(-leftPush, 0.0f, 0.0f);
	}

	if (rightPush <= downPush && rightPush <= upPush) {
		return Vector3D(rightPush, 0.0f, 0.0f);
	}

	if (downPush <= upPush) {
		return Vector3D(0.0f, 0.0f, -downPush);
	}

	return Vector3D(0.0f, 0.0f, upPush);
}

} // namespace ArenaGame
