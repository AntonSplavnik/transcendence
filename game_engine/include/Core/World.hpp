#pragma once

#include "Components/PlayerInfo.hpp"
#include "Components/Transform.hpp"
#include "Components/PhysicsBody.hpp"
#include "Components/Collider.hpp"
#include "Components/Health.hpp"
#include "Components/CharacterController.hpp"
#include "Components/CombatController.hpp"
#include "Components/Tags.hpp"

#include "systems/SystemManager.hpp"
#include "systems/CharacterControllerSystem.hpp"
#include "systems/PhysicsSystem.hpp"
#include "systems/CollisionSystem.hpp"
#include "systems/CombatSystem.hpp"

#include <entt/entt.hpp>
#include <unordered_map>
#include <vector>

namespace ArenaGame {
namespace Core {

// =============================================================================
// World - EnTT-based World implementation
// =============================================================================
// - Uses entt::registry for entity storage (packed arrays, cache-friendly)
// - Maintains PlayerID ↔ entt::entity bidirectional mapping for FFI compatibility
//
// - Built-in entity pooling and recycling
//
// Usage:
//   World world;
//   world.initialize();
//
//   entt::entity player = world.createCharacter(1, "Player", Vector3D(0, 0, 0));
//   world.update(deltaTime);  // Updates all systems
// =============================================================================

class World {
public:
	World();
	~World();

	// Lifecycle
	void initialize();
	void shutdown();

	// Update phases (identical to World.hpp)
	void earlyUpdate(float deltaTime);   // Phase 1: Input processing
	void fixedUpdate(float fixedDeltaTime);  // Phase 2: Physics & Collision
	void update(float deltaTime);        // Phase 3: Game logic, Combat
	void lateUpdate(float deltaTime);    // Phase 4: Post-processing

	// Entity management
	entt::entity createActor(const Vector3D& spawnPos);
	entt::entity createProjectile(const Vector3D& spawnPos, const Vector3D& velocity);
	entt::entity createWall(const Vector3D& position, const Vector3D& halfExtents);
	entt::entity createTrigger(const Vector3D& position, float radius);

	bool destroyEntity(entt::entity entity);
	void clearEntities();

	// PlayerID ↔ entt::entity mapping (for FFI compatibility)
	entt::entity getEntityByPlayerID(PlayerID id) const;
	PlayerID getPlayerIDByEntity(entt::entity entity) const;

	// Registry access (for systems)
	entt::registry& getRegistry() { return m_registry; }
	const entt::registry& getRegistry() const { return m_registry; }

	// System access
	CharacterControllerSystem* getCharacterControllerSystem() { return m_characterControllerSystem; }
	PhysicsSystem* getPhysicsSystem() { return m_physicsSystem; }
	CollisionSystem* getCollisionSystem() { return m_collisionSystem; }
	CombatSystem* getCombatSystem() { return m_combatSystem; }
	SystemManager* getSystemManager() { return &m_systemManager; }

	// Convenience methods for player management
	entt::entity createPlayer(PlayerID id, const std::string& name, Vector3D pos, const CharacterPreset& preset);
	bool removePlayer(PlayerID id);
	size_t getPlayerCount() const { return m_playerToEntity.size(); }

	// Input handling (forwards to controller component)
	void setPlayerInput(PlayerID id, const InputState& input);


private:
	// EnTT registry (core data structure)
	entt::registry m_registry;

	// System management
	SystemManager m_systemManager;

	// Cached system pointers (for convenience)
	CharacterControllerSystem* m_characterControllerSystem;
	PhysicsSystem* m_physicsSystem;
	CollisionSystem* m_collisionSystem;
	CombatSystem* m_combatSystem;

	// PlayerID ↔ entt::entity bidirectional mapping
	std::unordered_map<PlayerID, entt::entity> m_playerToEntity;
	std::unordered_map<entt::entity, PlayerID> m_entityToPlayer;

	// Internal helpers
	void registerPlayerIDMapping(entt::entity entity, PlayerID id);
	void unregisterPlayerIDMapping(entt::entity entity);
};

// =============================================================================
// Implementation
// =============================================================================


inline World::World()
	: m_characterControllerSystem(nullptr)
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
	auto characterControllerSystem = std::make_unique<CharacterControllerSystem>();
	auto physicsSystem = std::make_unique<PhysicsSystem>();
	auto collisionSystem = std::make_unique<CollisionSystem>();
	auto combatSystem = std::make_unique<CombatSystem>();

	// Pass registry to systems
	characterControllerSystem->setRegistry(&m_registry);
	physicsSystem->setRegistry(&m_registry);
	collisionSystem->setRegistry(&m_registry);
	combatSystem->setRegistry(&m_registry);

	// Store raw pointers for convenience
	m_characterControllerSystem = characterControllerSystem.get();
	m_physicsSystem = physicsSystem.get();
	m_collisionSystem = collisionSystem.get();
	m_combatSystem = combatSystem.get();

	// Add to system manager (order matters: CharacterController -> Physics -> Collision -> Combat)
	m_systemManager.addSystem(std::move(characterControllerSystem));
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

/**
 * Phase 1: Input processing, pre-physics logic
 */
inline void World::earlyUpdate(float deltaTime) {
	m_systemManager.earlyUpdate(deltaTime);
}

/**
 * Phase 2: Physics simulation (fixed timestep, deterministic)
 */
inline void World::fixedUpdate(float fixedDeltaTime) {
	m_systemManager.fixedUpdate(fixedDeltaTime);
}

/**
 * Phase 3: Game logic, combat, AI (variable timestep)
 */
inline void World::update(float deltaTime) {
	m_systemManager.update(deltaTime);
}

/**
 * Phase 4: Post-processing, interpolation
 */
inline void World::lateUpdate(float deltaTime) {
	m_systemManager.lateUpdate(deltaTime);
}

// General entity
inline entt::entity World::createActor(const Vector3D& spawnPos) {

	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	m_registry.emplace<ActorTag>(entity);
	m_registry.emplace<Components::Transform>(entity, spawnPos);
	m_registry.emplace<Components::PhysicsBody>(entity, Components::PhysicsBody::createCharacter());
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createCharacter());
	m_registry.emplace<Components::Health>(entity, Components::Health::createCharacter());
	m_registry.emplace<Components::CharacterController>(entity, Components::CharacterController::createDefault());
	m_registry.emplace<Components::CombatController>(entity, Components::CombatController::createDefault());

	return entity;
}
inline entt::entity World::createProjectile(const Vector3D& spawnPos, const Vector3D& velocity) {

	entt::entity entity = m_registry.create();;
	if (entity == entt::null) {
		return entt::null;
	}

	// Initialize as projectile
	auto physics = Components::PhysicsBody::createProjectile();
	physics.velocity = velocity;

	m_registry.emplace<ProjectileTag>(entity);
	m_registry.emplace<Components::Transform>(entity, spawnPos);
	m_registry.emplace<Components::PhysicsBody>(entity, physics);
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createProjectile());

	return entity;
}
inline entt::entity World::createWall(const Vector3D& position, const Vector3D& halfExtents) {
	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	// Initialize as wall
	m_registry.emplace<WallTag>(entity);
	m_registry.emplace<Components::Transform>(entity, position);
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createWall(halfExtents));
	m_registry.emplace<Components::PhysicsBody>(entity, Components::PhysicsBody::createStatic());

	return entity;
}
inline entt::entity World::createTrigger(const Vector3D& position, float radius) {

	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	// Initialize as trigger
	m_registry.emplace<TriggerTag>(entity);
	m_registry.emplace<Components::Transform>(entity, position);
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createTrigger(radius));

	return entity;
}

inline bool World::destroyEntity(entt::entity entity) {

	// Destroy entity (automatically removes all components)
	m_registry.destroy(entity);

	return true;
}
inline void World::clearEntities() {
	// Clear all mappings
	m_playerToEntity.clear();
	m_entityToPlayer.clear();

	// Clear registry (destroys all entities and components)
	m_registry.clear();
}

// Player related
inline entt::entity World::getEntityByPlayerID(PlayerID id) const {
	auto it = m_playerToEntity.find(id);
	return (it != m_playerToEntity.end()) ? it->second : entt::null;
}
inline PlayerID World::getPlayerIDByEntity(entt::entity entity) const {
	auto it = m_entityToPlayer.find(entity);
	return (it != m_entityToPlayer.end()) ? it->second : 0;
}

inline entt::entity World::createPlayer(PlayerID id,
										const std::string& name,
										Vector3D pos,
										const CharacterPreset& preset) {

	// Check if entity already exists
	if (m_playerToEntity.find(id) != m_playerToEntity.end()) {
		return entt::null;
	}

	entt::entity entity = m_registry.create();

	// Add PlayerInfo component
	m_registry.emplace<PlayerTag>(entity);
	m_registry.emplace<Components::PlayerInfo>(entity, id, name);
	m_registry.emplace<Components::Transform>(entity, pos);
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createCharacter());
	m_registry.emplace<Components::PhysicsBody>(entity, Components::PhysicsBody::createCharacter());
	m_registry.emplace<Components::Health>(entity, Components::Health::createFromPreset(preset));
	m_registry.emplace<Components::CombatController>(entity, Components::CombatController::createFromPreset(preset));
	m_registry.emplace<Components::CharacterController>(entity, Components::CharacterController::createFromPreset(preset));

	registerPlayerIDMapping(entity, id);

	return entity;
}

inline bool World::removePlayer(PlayerID id) {

	entt::entity entity = getEntityByPlayerID(id);


	if (entity == entt::null) {
		return false;
	}

	// Unregister PlayerID mapping
	unregisterPlayerIDMapping(entity);

	destroyEntity(entity);

	return true;
}

inline void World::setPlayerInput(PlayerID id, const InputState& input) {
	entt::entity entity = getEntityByPlayerID(id);
	if (entity == entt::null) {
		return;
	}

	// Get controller component
	auto* controller = m_registry.try_get<Components::CharacterController>(entity);
	if (controller) {
		controller->setInput(input);
	}
}

inline void World::registerPlayerIDMapping(entt::entity entity, PlayerID id) {
	m_playerToEntity[id] = entity;
	m_entityToPlayer[entity] = id;
}
inline void World::unregisterPlayerIDMapping(entt::entity entity) {
	PlayerID id = getPlayerIDByEntity(entity);
	if (id != 0) {
		m_playerToEntity.erase(id);
		m_entityToPlayer.erase(entity);
	}
}


} // namespace Core
} // namespace ArenaGame
