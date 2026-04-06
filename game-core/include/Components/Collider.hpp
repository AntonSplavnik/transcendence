#pragma once

#include "../GameTypes.hpp"

namespace ArenaGame {
namespace Components {

// =============================================================================
// Collider - Collision shape and properties
// =============================================================================
// Pure data component - logic handled by CollisionSystem
// Represents the collision volume of an entity
//
// Collision layers allow filtering (e.g., bullets don't collide with each other)
//
// Usage:
//   Collider collider = Collider::createCylinder(0.5f, 1.8f);
//   collider.layer = CollisionLayer::Player;
// =============================================================================

// Collision layers for filtering
enum class CollisionLayer : uint32_t {
    None        = 0,
    Ground      = 1 << 0,   // 0x01
    Wall        = 1 << 1,   // 0x02
    Player      = 1 << 2,   // 0x04
    Enemy       = 1 << 3,   // 0x08
    Projectile  = 1 << 4,   // 0x10
    Trigger     = 1 << 5,   // 0x20 (for capture zones, power-ups, etc.)
    All         = 0xFFFFFFFF
};

// Bitwise operations for collision layers
inline CollisionLayer operator|(CollisionLayer a, CollisionLayer b) {
    return static_cast<CollisionLayer>(static_cast<uint32_t>(a) | static_cast<uint32_t>(b));
}

inline CollisionLayer operator&(CollisionLayer a, CollisionLayer b) {
    return static_cast<CollisionLayer>(static_cast<uint32_t>(a) & static_cast<uint32_t>(b));
}

inline bool hasLayer(CollisionLayer value, CollisionLayer layer) {
    return (static_cast<uint32_t>(value) & static_cast<uint32_t>(layer)) != 0;
}

struct Collider {
    // Collision shape type
    enum class Shape {
        Cylinder,   // Best for characters (radius + height)
        Sphere,     // Best for projectiles (radius only)
        Box,        // Best for walls/obstacles (width, height, depth)
        Capsule     // Alternative for characters (radius + height)
    };

    // Shape and dimensions
    Shape shape;
    float radius;       // For Cylinder, Sphere, Capsule
    float height;       // For Cylinder, Box, Capsule
    Vector3D halfExtents; // For Box (half-width, half-height, half-depth)

    // Collision filtering
    CollisionLayer layer;           // What layer is this collider on?
    CollisionLayer collidesWith;    // What layers does it collide with?

    // Collision properties
    bool isTrigger;     // If true, detects collisions but doesn't resolve them (for zones)
    bool isStatic;      // If true, never moves (optimization for collision detection)

    // Offset from entity position (if needed)
    Vector3D offset;

    // Constructors
    Collider()
        : shape(Shape::Cylinder)
        , radius(GameConfig::CHARACTER_COLLISION_RADIUS)
        , height(GameConfig::CHARACTER_HEIGHT)
        , halfExtents(0.5f, 1.0f, 0.5f)
        , layer(CollisionLayer::Player)
        , collidesWith(CollisionLayer::All)
        , isTrigger(false)
        , isStatic(false)
        , offset(0.0f, 0.0f, 0.0f)
    {}

    // Get collision cylinder (for backwards compatibility)
    Cylinder getCylinder(const Vector3D& position) const {
        return Cylinder(position + offset, radius, height);
    }

    // Check if this collider should collide with another
    bool shouldCollideWith(const Collider& other) const {
        if (isTrigger || other.isTrigger) {
            return false; // Triggers don't physically collide
        }
        return hasLayer(collidesWith, other.layer) && hasLayer(other.collidesWith, layer);
    }

    // Get bounding box (AABB) for broad-phase collision
    struct AABB {
        Vector3D min;
        Vector3D max;

        bool intersects(const AABB& other) const {
            return (min.x <= other.max.x && max.x >= other.min.x) &&
                   (min.y <= other.max.y && max.y >= other.min.y) &&
                   (min.z <= other.max.z && max.z >= other.min.z);
        }
    };

    AABB getAABB(const Vector3D& position) const {
        AABB aabb;
        Vector3D pos = position + offset;

        switch (shape) {
            case Shape::Cylinder:
            case Shape::Capsule:
                aabb.min = Vector3D(pos.x - radius, pos.y, pos.z - radius);
                aabb.max = Vector3D(pos.x + radius, pos.y + height, pos.z + radius);
                break;

            case Shape::Sphere:
                aabb.min = Vector3D(pos.x - radius, pos.y - radius, pos.z - radius);
                aabb.max = Vector3D(pos.x + radius, pos.y + radius, pos.z + radius);
                break;

            case Shape::Box:
                aabb.min = pos - halfExtents;
                aabb.max = pos + halfExtents;
                break;
        }

        return aabb;
    }

    // Static factory methods for common collider types
    static Collider createCylinder(float radius, float height) {
        Collider collider;
        collider.shape = Shape::Cylinder;
        collider.radius = radius;
        collider.height = height;
        return collider;
    }

    static Collider createSphere(float radius) {
        Collider collider;
        collider.shape = Shape::Sphere;
        collider.radius = radius;
        collider.height = radius * 2.0f;
        return collider;
    }

    static Collider createBox(const Vector3D& halfExtents) {
        Collider collider;
        collider.shape = Shape::Box;
        collider.halfExtents = halfExtents;
        return collider;
    }

    static Collider createCharacter() {
        return createCylinder(
            GameConfig::CHARACTER_COLLISION_RADIUS,
            GameConfig::CHARACTER_HEIGHT
        );
    }

    static Collider createProjectile(float radius = 0.1f) {
        Collider collider = createSphere(radius);
        collider.layer = CollisionLayer::Projectile;
        collider.collidesWith = CollisionLayer::Player | CollisionLayer::Wall;
        return collider;
    }

    static Collider createWall(const Vector3D& halfExtents) {
        Collider collider = createBox(halfExtents);
        collider.layer = CollisionLayer::Wall;
        collider.isStatic = true;
        return collider;
    }

    static Collider createTrigger(float radius) {
        Collider collider = createSphere(radius);
        collider.isTrigger = true;
        collider.layer = CollisionLayer::Trigger;
        return collider;
    }
};

} // namespace Components
} // namespace ArenaGame
