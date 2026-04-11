// Suggested patch for rotation support in Collider.hpp

/*
ADD to struct Collider (after the `offset` field):

	// Rotation around Y-axis (in radians)
	// Only used for Box colliders; cylinders ignore this
	float rotationY = 0.0f;

ADD factory method:

	static Collider createBox(
		float halfWidth, float halfHeight, float halfDepth,
		float rotationY = 0.0f
	) {
		Collider collider;
		collider.shape = Shape::Box;
		collider.halfExtents = Vector3D(halfWidth, halfHeight, halfDepth);
		collider.height = halfHeight * 2.0f;
		collider.rotationY = rotationY;
		return collider;
	}

MODIFY getAABB() to handle rotated boxes:

	AABB getAABB(const Vector3D& position) const {
		AABB aabb;
		Vector3D pos = position + offset;

		switch (shape) {
			// ... existing Cylinder/Sphere/Capsule cases ...

			case Shape::Box:
				if (rotationY != 0.0f) {
					// For rotated boxes, compute AABB of rotated corners
					// (conservative approach - slightly larger than needed)
					Vector3D corners[8] = {
						Vector3D(-halfExtents.x, -halfExtents.y, -halfExtents.z),
						Vector3D(halfExtents.x, -halfExtents.y, -halfExtents.z),
						Vector3D(-halfExtents.x, halfExtents.y, -halfExtents.z),
						Vector3D(halfExtents.x, halfExtents.y, -halfExtents.z),
						Vector3D(-halfExtents.x, -halfExtents.y, halfExtents.z),
						Vector3D(halfExtents.x, -halfExtents.y, halfExtents.z),
						Vector3D(-halfExtents.x, halfExtents.y, halfExtents.z),
						Vector3D(halfExtents.x, halfExtents.y, halfExtents.z),
					};
					
					// Rotate each corner around Y-axis
					float cosY = std::cos(rotationY);
					float sinY = std::sin(rotationY);
					
					float minX = corners[0].x, maxX = corners[0].x;
					float minZ = corners[0].z, maxZ = corners[0].z;
					
					for (int i = 0; i < 8; i++) {
						float rotX = corners[i].x * cosY - corners[i].z * sinY;
						float rotZ = corners[i].x * sinY + corners[i].z * cosY;
						minX = std::min(minX, rotX);
						maxX = std::max(maxX, rotX);
						minZ = std::min(minZ, rotZ);
						maxZ = std::max(maxZ, rotZ);
					}
					
					aabb.min = Vector3D(pos.x + minX, pos.y - halfExtents.y, pos.z + minZ);
					aabb.max = Vector3D(pos.x + maxX, pos.y + halfExtents.y, pos.z + maxZ);
				} else {
					// Non-rotated box - original code
					aabb.min = pos - halfExtents;
					aabb.max = pos + halfExtents;
				}
				break;
		}

		return aabb;
	}
*/

// For CollisionSystem.hpp, add OBB collision test:

/*
ADD helper method to check Oriented Bounding Box (OBB) collision:

	bool checkOBBCollision(
		const Vector3D& posA, const Collider& colliderA,
		const Vector3D& posB, const Collider& colliderB
	) const {
		// Simplified SAT for axis-aligned vs Y-rotated boxes
		// Assumes colliders are boxes with rotation around Y axis
		
		// For now, use conservative AABB test
		// Full SAT implementation would be more precise but complex
		
		Collider::AABB aabbA = colliderA.getAABB(posA);
		Collider::AABB aabbB = colliderB.getAABB(posB);
		
		return aabbA.intersects(aabbB);
	}

UPDATE checkCollision() to handle Box vs Box (and Box vs Cylinder):

	inline bool CollisionSystem::checkCollision(
		const Components::Transform& transformA, const Components::Collider& colliderA,
		const Components::Transform& transformB, const Components::Collider& colliderB
	) const {
		// Pure cylinder vs cylinder (most common, original code)
		if (colliderA.shape == Components::Collider::Shape::Cylinder && 
			colliderB.shape == Components::Collider::Shape::Cylinder) {
			Cylinder cylA = colliderA.getCylinder(transformA.position);
			Cylinder cylB = colliderB.getCylinder(transformB.position);
			return cylA.intersects(cylB);
		}
		
		// Box vs Box (use AABB of rotated boxes)
		if (colliderA.shape == Components::Collider::Shape::Box &&
			colliderB.shape == Components::Collider::Shape::Box) {
			return checkOBBCollision(transformA.position, colliderA, transformB.position, colliderB);
		}
		
		// Box vs Cylinder (use cylinder radius + rotated box AABB)
		if ((colliderA.shape == Components::Collider::Shape::Box && 
			 colliderB.shape == Components::Collider::Shape::Cylinder) ||
			(colliderA.shape == Components::Collider::Shape::Cylinder && 
			 colliderB.shape == Components::Collider::Shape::Box)) {
			
			const Components::Collider& boxCol = 
				(colliderA.shape == Components::Collider::Shape::Box) ? colliderA : colliderB;
			const Components::Collider& cylCol = 
				(colliderA.shape == Components::Collider::Shape::Cylinder) ? colliderA : colliderB;
			
			const Vector3D& boxPos = 
				(&colliderA == &boxCol) ? transformA.position : transformB.position;
			const Vector3D& cylPos = 
				(&colliderA == &cylCol) ? transformA.position : transformB.position;
			
			Collider::AABB boxAABB = boxCol.getAABB(boxPos);
			Cylinder cyl = cylCol.getCylinder(cylPos);
			
			// Approximate: check if cylinder center is within box AABB + radius
			Vector3D closestPoint(
				std::clamp(cyl.center.x, boxAABB.min.x, boxAABB.max.x),
				std::clamp(cyl.center.y, boxAABB.min.y, boxAABB.max.y),
				std::clamp(cyl.center.z, boxAABB.min.z, boxAABB.max.z)
			);
			
			float distance = (closestPoint - cyl.center).length();
			return distance < cylCol.radius;
		}
		
		// Fallback for other cases
		return false;
	}
*/
