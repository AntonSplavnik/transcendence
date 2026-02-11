#pragma once

#include "Core/Entity.hpp"
#include "Systems/SystemManager.hpp"
#include "Systems/PhysicsSystem.hpp"
#include "Systems/CollisionSystem.hpp"
#include "Systems/CombatSystem.hpp"
#include <unordered_map>
#include <vector>
#include <memory>

namespace ArenaGame {
namespace Core {

// =============================================================================
// World - Manages all entities and systems
// =============================================================================
// The World is the central registry for the entire game simulation
// - Owns all entities
// - Manages all systems
// - Provides entity lifecycle (create, destroy, find)
//
// Usage:
//   World world;
//   world.initialize();
//
//   Entity* player = world.createEntity(1, "Player");
//   player->transform = Transform(Vector3D(0, 0, 0));
//   player->physics = PhysicsBody::createCharacter();
//
//   world.update(deltaTime);  // Updates all systems
// =============================================================================

class World {
public:
    World();
    ~World();

    // Lifecycle
    void initialize();
    void shutdown();

    // Update phases (NEW - multi-phase update loop)
    void earlyUpdate(float deltaTime);   // Phase 1: Input processing
    void fixedUpdate(float fixedDeltaTime);  // Phase 2: Physics & Collision
    void update(float deltaTime);        // Phase 3: Game logic, Combat
    void lateUpdate(float deltaTime);    // Phase 4: Post-processing

    // Entity management
    Entity* createEntity(PlayerID id, const std::string& name = "");
    Entity* createCharacter(PlayerID id, const std::string& name, const Vector3D& spawnPos);
    Entity* createProjectile(PlayerID id, const Vector3D& spawnPos, const Vector3D& velocity);
    Entity* createWall(PlayerID id, const Vector3D& position, const Vector3D& halfExtents);
    Entity* createTrigger(PlayerID id, const Vector3D& position, float radius);

    bool destroyEntity(PlayerID id);
    void clearEntities();

    // Entity queries
    Entity* getEntity(PlayerID id);
    const Entity* getEntity(PlayerID id) const;
    size_t getEntityCount() const { return m_entities.size(); }

    // Get all entities with specific components (for systems)
    std::vector<Entity*> getEntitiesWith(bool needTransform, bool needPhysics = false,
                                         bool needCollider = false, bool needHealth = false,
                                         bool needController = false, bool needCombat = false);

    // System access
    PhysicsSystem* getPhysicsSystem() { return m_physicsSystem; }
    CollisionSystem* getCollisionSystem() { return m_collisionSystem; }
    CombatSystem* getCombatSystem() { return m_combatSystem; }
    SystemManager* getSystemManager() { return &m_systemManager; }

    // Convenience methods for player management (backwards compatibility)
    Entity* addPlayer(PlayerID playerId, const std::string& name, const Vector3D& spawnPos);
    bool removePlayer(PlayerID playerId);
    Entity* getPlayer(PlayerID playerId) { return getEntity(playerId); }
    size_t getPlayerCount() const { return m_playerCount; }

    // Input handling (forwards to controller component)
    void setPlayerInput(PlayerID playerId, const InputState& input);

    // Combat handling (forwards to combat system)
    void registerHit(PlayerID attackerId, PlayerID victimId, float damage);

private:
    // Entity storage
    std::unordered_map<PlayerID, std::unique_ptr<Entity>> m_entities;
    PlayerID m_nextEntityId;
    size_t m_playerCount;

    // System management
    SystemManager m_systemManager;

    // Cached system pointers (for convenience)
    PhysicsSystem* m_physicsSystem;
    CollisionSystem* m_collisionSystem;
    CombatSystem* m_combatSystem;

    // Internal helpers
    void registerEntityWithSystems(Entity* entity);
    void unregisterEntityFromSystems(Entity* entity);
};

// =============================================================================
// Implementation
// =============================================================================

inline World::World()
    : m_nextEntityId(1000)  // Start IDs at 1000 to avoid collision with player IDs
    , m_playerCount(0)
    , m_physicsSystem(nullptr)
    , m_collisionSystem(nullptr)
    , m_combatSystem(nullptr)
{
}

inline World::~World() {
    shutdown();
}

inline void World::initialize() {
    // Create and register systems
    auto physicsSystem = std::make_unique<PhysicsSystem>();
    auto collisionSystem = std::make_unique<CollisionSystem>();
    auto combatSystem = std::make_unique<CombatSystem>();

    // Store raw pointers for convenience
    m_physicsSystem = physicsSystem.get();
    m_collisionSystem = collisionSystem.get();
    m_combatSystem = combatSystem.get();

    // Add to system manager (order matters: Physics -> Collision -> Combat)
    m_systemManager.addSystem(std::move(physicsSystem));
    m_systemManager.addSystem(std::move(collisionSystem));
    m_systemManager.addSystem(std::move(combatSystem));

    // Initialize all systems
    m_systemManager.initialize();

    // Start all systems (called once after initialization)
    m_systemManager.start();
}

inline void World::shutdown() {
    clearEntities();
    m_systemManager.shutdown();
}

inline void World::earlyUpdate(float deltaTime) {
    // Phase 1: Input processing, pre-physics logic
    m_systemManager.earlyUpdate(deltaTime);
}

inline void World::fixedUpdate(float fixedDeltaTime) {
    // Phase 2: Physics simulation (fixed timestep, deterministic)
    m_systemManager.fixedUpdate(fixedDeltaTime);
}

inline void World::update(float deltaTime) {
    // Phase 3: Game logic, combat, AI (variable timestep)
    m_systemManager.update(deltaTime);
}

inline void World::lateUpdate(float deltaTime) {
    // Phase 4: Post-processing, interpolation
    m_systemManager.lateUpdate(deltaTime);
}

inline Entity* World::createEntity(PlayerID id, const std::string& name) {
    // Check if entity already exists
    if (m_entities.find(id) != m_entities.end()) {
        return nullptr;
    }

    // Create entity
    auto entity = std::make_unique<Entity>(id, name);
    Entity* entityPtr = entity.get();

    // Store in map
    m_entities[id] = std::move(entity);

    return entityPtr;
}

inline Entity* World::createCharacter(PlayerID id, const std::string& name, const Vector3D& spawnPos) {
    Entity* entity = createEntity(id, name);
    if (!entity) {
        return nullptr;
    }

    // Initialize as character
    entity->transform = Transform(spawnPos);
    entity->physics = PhysicsBody::createCharacter();
    entity->collider = Collider::createCharacter();
    entity->health = Health::createCharacter();
    entity->controller = CharacterController::createDefault();
    entity->combat = CombatController::createMelee();

    // Register with systems
    registerEntityWithSystems(entity);

    return entity;
}

inline Entity* World::createProjectile(PlayerID id, const Vector3D& spawnPos, const Vector3D& velocity) {
    Entity* entity = createEntity(id, "Projectile_" + std::to_string(id));
    if (!entity) {
        return nullptr;
    }

    // Initialize as projectile
    entity->transform = Transform(spawnPos);
    entity->physics = PhysicsBody::createProjectile();
    entity->physics->velocity = velocity;
    entity->collider = Collider::createProjectile();

    // Register with systems (only physics and collision)
    registerEntityWithSystems(entity);

    return entity;
}

inline Entity* World::createWall(PlayerID id, const Vector3D& position, const Vector3D& halfExtents) {
    Entity* entity = createEntity(id, "Wall_" + std::to_string(id));
    if (!entity) {
        return nullptr;
    }

    // Initialize as wall
    entity->transform = Transform(position);
    entity->collider = Collider::createWall(halfExtents);
    entity->physics = PhysicsBody::createStatic();

    // Register with systems (only collision)
    registerEntityWithSystems(entity);

    return entity;
}

inline Entity* World::createTrigger(PlayerID id, const Vector3D& position, float radius) {
    Entity* entity = createEntity(id, "Trigger_" + std::to_string(id));
    if (!entity) {
        return nullptr;
    }

    // Initialize as trigger
    entity->transform = Transform(position);
    entity->collider = Collider::createTrigger(radius);

    // Register with systems (only collision for trigger detection)
    registerEntityWithSystems(entity);

    return entity;
}

inline bool World::destroyEntity(PlayerID id) {
    auto it = m_entities.find(id);
    if (it == m_entities.end()) {
        return false;
    }

    // Unregister from systems
    unregisterEntityFromSystems(it->second.get());

    // Remove entity
    m_entities.erase(it);

    return true;
}

inline void World::clearEntities() {
    // Unregister all entities from systems
    for (auto& [id, entity] : m_entities) {
        unregisterEntityFromSystems(entity.get());
    }

    m_entities.clear();
    m_playerCount = 0;
}

inline Entity* World::getEntity(PlayerID id) {
    auto it = m_entities.find(id);
    return (it != m_entities.end()) ? it->second.get() : nullptr;
}

inline const Entity* World::getEntity(PlayerID id) const {
    auto it = m_entities.find(id);
    return (it != m_entities.end()) ? it->second.get() : nullptr;
}

inline std::vector<Entity*> World::getEntitiesWith(
    bool needTransform, bool needPhysics, bool needCollider,
    bool needHealth, bool needController, bool needCombat)
{
    std::vector<Entity*> result;

    for (auto& [id, entity] : m_entities) {
        bool matches = true;

        if (needTransform && !entity->hasTransform()) matches = false;
        if (needPhysics && !entity->hasPhysics()) matches = false;
        if (needCollider && !entity->hasCollider()) matches = false;
        if (needHealth && !entity->hasHealth()) matches = false;
        if (needController && !entity->hasController()) matches = false;
        if (needCombat && !entity->hasCombat()) matches = false;

        if (matches) {
            result.push_back(entity.get());
        }
    }

    return result;
}

inline Entity* World::addPlayer(PlayerID playerId, const std::string& name, const Vector3D& spawnPos) {
    Entity* entity = createCharacter(playerId, name, spawnPos);
    if (entity) {
        m_playerCount++;
    }
    return entity;
}

inline bool World::removePlayer(PlayerID playerId) {
    if (destroyEntity(playerId)) {
        m_playerCount--;
        return true;
    }
    return false;
}

inline void World::setPlayerInput(PlayerID playerId, const InputState& input) {
    Entity* entity = getEntity(playerId);
    if (entity && entity->hasController()) {
        entity->controller->setInput(input);
    }
}

inline void World::registerHit(PlayerID attackerId, PlayerID victimId, float damage) {
    if (m_combatSystem) {
        m_combatSystem->registerHit(attackerId, victimId, damage);
    }
}

inline void World::registerEntityWithSystems(Entity* entity) {
    if (!entity) return;

    // Register with physics system if has physics
    if (entity->hasPhysics() && m_physicsSystem) {
        m_physicsSystem->addEntity(entity);
    }

    // Register with collision system if has collider
    if (entity->hasCollider() && m_collisionSystem) {
        m_collisionSystem->addEntity(entity);
    }

    // Register with combat system if has combat or health
    if ((entity->hasCombat() || entity->hasHealth()) && m_combatSystem) {
        m_combatSystem->addEntity(entity);
    }
}

inline void World::unregisterEntityFromSystems(Entity* entity) {
    if (!entity) return;

    // Unregister from all systems
    if (m_physicsSystem) {
        m_physicsSystem->removeEntity(entity);
    }
    if (m_collisionSystem) {
        m_collisionSystem->removeEntity(entity);
    }
    if (m_combatSystem) {
        m_combatSystem->removeEntity(entity);
    }
}

} // namespace Core
} // namespace ArenaGame
