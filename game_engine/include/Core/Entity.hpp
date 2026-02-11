#pragma once

#include "GameTypes.hpp"
#include "Components/Components.hpp"
#include <string>
#include <memory>
#include <optional>

namespace ArenaGame {
namespace Core {

using namespace Components;

// =============================================================================
// Entity - A game object composed of components
// =============================================================================
// An entity is just an ID with components attached
// Components are optional - an entity can have any combination
//
// Examples:
//   - Player: Transform + PhysicsBody + Collider + Health + CharacterController + CombatController
//   - Projectile: Transform + PhysicsBody + Collider
//   - Wall: Transform + Collider
//   - Trigger: Transform + Collider (with isTrigger=true)
//
// Usage:
//   Entity player(1, "Player");
//   player.transform = Transform(Vector3D(0, 0, 0));
//   player.physics = PhysicsBody::createCharacter();
//   if (player.hasHealth()) {
//       player.health->takeDamage(10.0f);
//   }
// =============================================================================

class Entity {
public:
    // Unique identifier (matches PlayerID for players)
    PlayerID id;

    // Optional name for debugging
    std::string name;

    // Components (using std::optional for flexibility)
    // Not all entities need all components
    std::optional<Transform> transform;
    std::optional<PhysicsBody> physics;
    std::optional<Collider> collider;
    std::optional<Health> health;
    std::optional<CharacterController> controller;
    std::optional<CombatController> combat;

    // Constructors
    Entity()
        : id(0)
        , name("Entity")
    {}

    explicit Entity(PlayerID entityId)
        : id(entityId)
        , name("Entity_" + std::to_string(entityId))
    {}

    Entity(PlayerID entityId, const std::string& entityName)
        : id(entityId)
        , name(entityName)
    {}

    // Component queries
    bool hasTransform() const { return transform.has_value(); }
    bool hasPhysics() const { return physics.has_value(); }
    bool hasCollider() const { return collider.has_value(); }
    bool hasHealth() const { return health.has_value(); }
    bool hasController() const { return controller.has_value(); }
    bool hasCombat() const { return combat.has_value(); }

    // Get component references (throws if not present)
    Transform& getTransform() { return transform.value(); }
    PhysicsBody& getPhysics() { return physics.value(); }
    Collider& getCollider() { return collider.value(); }
    Health& getHealth() { return health.value(); }
    CharacterController& getController() { return controller.value(); }
    CombatController& getCombat() { return combat.value(); }

    const Transform& getTransform() const { return transform.value(); }
    const PhysicsBody& getPhysics() const { return physics.value(); }
    const Collider& getCollider() const { return collider.value(); }
    const Health& getHealth() const { return health.value(); }
    const CharacterController& getController() const { return controller.value(); }
    const CombatController& getCombat() const { return combat.value(); }

    // Safe getters that return pointers (nullptr if not present)
    Transform* tryGetTransform() { return hasTransform() ? &(*transform) : nullptr; }
    PhysicsBody* tryGetPhysics() { return hasPhysics() ? &(*physics) : nullptr; }
    Collider* tryGetCollider() { return hasCollider() ? &(*collider) : nullptr; }
    Health* tryGetHealth() { return hasHealth() ? &(*health) : nullptr; }
    CharacterController* tryGetController() { return hasController() ? &(*controller) : nullptr; }
    CombatController* tryGetCombat() { return hasCombat() ? &(*combat) : nullptr; }

    const Transform* tryGetTransform() const { return hasTransform() ? &(*transform) : nullptr; }
    const PhysicsBody* tryGetPhysics() const { return hasPhysics() ? &(*physics) : nullptr; }
    const Collider* tryGetCollider() const { return hasCollider() ? &(*collider) : nullptr; }
    const Health* tryGetHealth() const { return hasHealth() ? &(*health) : nullptr; }
    const CharacterController* tryGetController() const { return hasController() ? &(*controller) : nullptr; }
    const CombatController* tryGetCombat() const { return hasCombat() ? &(*combat) : nullptr; }

    // Entity state queries
    bool isAlive() const {
        return hasHealth() && health->isAlive();
    }

    bool isActive() const {
        // An entity is active if it has at least a transform component
        return hasTransform();
    }

    // Factory methods for common entity types
    static Entity createCharacter(PlayerID id, const std::string& name, const Vector3D& spawnPos) {
        Entity entity(id, name);

        entity.transform = Transform(spawnPos);
        entity.physics = PhysicsBody::createCharacter();
        entity.collider = Collider::createCharacter();
        entity.health = Health::createCharacter();
        entity.controller = CharacterController::createDefault();
        entity.combat = CombatController::createMelee();

        return entity;
    }

    static Entity createProjectile(PlayerID id, const Vector3D& spawnPos, const Vector3D& velocity) {
        Entity entity(id, "Projectile_" + std::to_string(id));

        entity.transform = Transform(spawnPos);
        entity.physics = PhysicsBody::createProjectile();
        entity.physics->velocity = velocity;
        entity.collider = Collider::createProjectile();
        // No health, controller, or combat components

        return entity;
    }

    static Entity createWall(PlayerID id, const Vector3D& position, const Vector3D& halfExtents) {
        Entity entity(id, "Wall_" + std::to_string(id));

        entity.transform = Transform(position);
        entity.collider = Collider::createWall(halfExtents);
        entity.physics = PhysicsBody::createStatic();
        // No health, controller, or combat components

        return entity;
    }

    static Entity createTrigger(PlayerID id, const Vector3D& position, float radius) {
        Entity entity(id, "Trigger_" + std::to_string(id));

        entity.transform = Transform(position);
        entity.collider = Collider::createTrigger(radius);
        // No physics, health, controller, or combat components

        return entity;
    }
};

} // namespace Core
} // namespace ArenaGame
