#pragma once

#include "../components/PlayerInfo.hpp"
#include "../components/Transform.hpp"
#include "../components/PhysicsBody.hpp"
#include "../components/Collider.hpp"
#include "../components/Health.hpp"
#include "../components/Stamina.hpp"
#include "../components/CharacterController.hpp"
#include "../components/CombatController.hpp"
#include "../components/Tags.hpp"
#include "../components/GameModeComponent.hpp"
#include "../components/MatchStatsComponent.hpp"
#include "../components/NetworkEventsComponent.hpp"
#include "../events/NetworkEvents.hpp"
#include "../components/InternalEventsComponent.hpp"
#include "../components/PendingPlayersComponent.hpp"

#include "../systems/SystemManager.hpp"
#include "../systems/CharacterControllerSystem.hpp"
#include "../systems/PhysicsSystem.hpp"
#include "../systems/CollisionSystem.hpp"
#include "../systems/CombatSystem.hpp"
#include "../systems/GameModeSystem.hpp"
#include "../systems/StaminaSystem.hpp"

#include "../ISpawner.hpp"
#include "../CharacterClassLookup.hpp"
#include "EntityFactory.hpp"
#include "MapLoader.hpp"
#include "CharacterPresetLoader.hpp"
#include "../Presets.hpp" // TEMPORARY — parity oracle during preset migration; remove in Task 8
#include <cmath>          // TEMPORARY — parity check helper

#include "../../entt/entt.hpp"
#include <memory>
#include <vector>
#include <unordered_map>
#include <utility>

namespace ArenaGame {

// =============================================================================
// World - EnTT-based World implementation
// =============================================================================
// - Uses entt::registry for entity storage (packed arrays, cache-friendly)
// - Maintains PlayerID ↔ entt::entity bidirectional mapping for FFI compatibility
// - Delegates entity creation to EntityFactory
//
// Usage:
//   World world;
//   world.initialize();
//
//   entt::entity player = world.createCharacter(1, "Player", Vector3D(0, 0, 0));
//   world.update(deltaTime);  // Updates all systems
// =============================================================================

// TEMPORARY — removed in Task 8 after the registry is wired through createPlayer.
// Compares a preset loaded from JSON against the authoritative compile-time preset
// in Presets.hpp. Throws on any float mismatch beyond 1e-6 epsilon.
inline void verifyPresetParity(const CharacterPreset& loaded, const CharacterPreset& expected, const std::string& label) {
	auto eq = [](float a, float b) { return std::fabs(a - b) < 1e-6f; };
	auto fail = [&label](const std::string& field, float l, float e) {
		throw std::runtime_error("preset parity mismatch: " + label + "." + field
			+ " loaded=" + std::to_string(l) + " expected=" + std::to_string(e));
	};
	#define CHECK(expr_loaded, expr_expected, name) do { \
		if (!eq((expr_loaded), (expr_expected))) fail((name), (expr_loaded), (expr_expected)); \
	} while (0)

	CHECK(loaded.health.maxHealth,  expected.health.maxHealth,  "health.maxHealth");
	CHECK(loaded.health.armor,      expected.health.armor,      "health.armor");
	CHECK(loaded.health.resistance, expected.health.resistance, "health.resistance");

	CHECK(loaded.movement.movementSpeed,    expected.movement.movementSpeed,    "movement.movementSpeed");
	CHECK(loaded.movement.rotationSpeed,    expected.movement.rotationSpeed,    "movement.rotationSpeed");
	CHECK(loaded.movement.sprintMultiplier, expected.movement.sprintMultiplier, "movement.sprintMultiplier");
	CHECK(loaded.movement.crouchMultiplier, expected.movement.crouchMultiplier, "movement.crouchMultiplier");
	CHECK(loaded.movement.jumpVelocity,     expected.movement.jumpVelocity,     "movement.jumpVelocity");
	CHECK(loaded.movement.dodgeVelocity,    expected.movement.dodgeVelocity,    "movement.dodgeVelocity");
	CHECK(loaded.movement.airControlFactor, expected.movement.airControlFactor, "movement.airControlFactor");
	CHECK(loaded.movement.acceleration,     expected.movement.acceleration,     "movement.acceleration");
	CHECK(loaded.movement.deceleration,     expected.movement.deceleration,     "movement.deceleration");
	CHECK(loaded.movement.mass,             expected.movement.mass,             "movement.mass");
	CHECK(loaded.movement.friction,         expected.movement.friction,         "movement.friction");
	CHECK(loaded.movement.drag,             expected.movement.drag,             "movement.drag");
	CHECK(loaded.movement.maxSpeed,         expected.movement.maxSpeed,         "movement.maxSpeed");
	CHECK(loaded.movement.maxFallSpeed,     expected.movement.maxFallSpeed,     "movement.maxFallSpeed");

	CHECK(loaded.collider.radius, expected.collider.radius, "collider.radius");
	CHECK(loaded.collider.height, expected.collider.height, "collider.height");

	CHECK(loaded.stamina.maxStamina,        expected.stamina.maxStamina,        "stamina.maxStamina");
	CHECK(loaded.stamina.baseRegenRate,     expected.stamina.baseRegenRate,     "stamina.baseRegenRate");
	CHECK(loaded.stamina.drainDelaySeconds, expected.stamina.drainDelaySeconds, "stamina.drainDelaySeconds");
	CHECK(loaded.stamina.sprintCostPerSec,  expected.stamina.sprintCostPerSec,  "stamina.sprintCostPerSec");
	CHECK(loaded.stamina.jumpCost,          expected.stamina.jumpCost,          "stamina.jumpCost");

	CHECK(loaded.combat.baseDamage,         expected.combat.baseDamage,         "combat.baseDamage");
	CHECK(loaded.combat.damageMultiplier,   expected.combat.damageMultiplier,   "combat.damageMultiplier");
	CHECK(loaded.combat.criticalChance,     expected.combat.criticalChance,     "combat.criticalChance");
	CHECK(loaded.combat.criticalMultiplier, expected.combat.criticalMultiplier, "combat.criticalMultiplier");

	if (loaded.combat.attackChain.size() != expected.combat.attackChain.size()) {
		throw std::runtime_error("preset parity mismatch: " + label + ".attackChain size");
	}
	for (std::size_t i = 0; i < expected.combat.attackChain.size(); ++i) {
		const auto& l = loaded.combat.attackChain[i];
		const auto& e = expected.combat.attackChain[i];
		const std::string pfx = "attackChain[" + std::to_string(i) + "].";
		CHECK(l.damageMultiplier,   e.damageMultiplier,   pfx + "damageMultiplier");
		CHECK(l.range,              e.range,              pfx + "range");
		CHECK(l.duration,           e.duration,           pfx + "duration");
		CHECK(l.movementMultiplier, e.movementMultiplier, pfx + "movementMultiplier");
		CHECK(l.chainWindow,        e.chainWindow,        pfx + "chainWindow");
		CHECK(l.attackAngle,        e.attackAngle,        pfx + "attackAngle");
		CHECK(l.staminaCost,        e.staminaCost,        pfx + "staminaCost");
	}

	auto checkSkill = [&](const SkillDefinition& l, const SkillDefinition& e, const std::string& name) {
		CHECK(l.cooldown,     e.cooldown,     name + ".cooldown");
		CHECK(l.castDuration, e.castDuration, name + ".castDuration");
		CHECK(l.staminaCost,  e.staminaCost,  name + ".staminaCost");
		const auto* lp = std::get_if<MeleeAOE>(&l.params);
		const auto* ep = std::get_if<MeleeAOE>(&e.params);
		if (!lp || !ep) throw std::runtime_error("preset parity: " + name + " skill variant mismatch");
		CHECK(lp->range,              ep->range,              name + ".params.range");
		CHECK(lp->movementMultiplier, ep->movementMultiplier, name + ".params.movementMultiplier");
		CHECK(lp->dmgMultiplier,      ep->dmgMultiplier,      name + ".params.dmgMultiplier");
	};
	checkSkill(loaded.combat.skill1, expected.combat.skill1, "skill1");
	checkSkill(loaded.combat.skill2, expected.combat.skill2, "skill2");

	#undef CHECK
}

class World : public ISpawner {
public:
	World();
	~World();

	// Lifecycle
	void initialize();
	void shutdown();

	// Update phases
	void earlyUpdate(float deltaTime);       // Phase 1: Input processing
	void fixedUpdate(float fixedDeltaTime);   // Phase 2: Physics & Collision
	void update(float deltaTime);             // Phase 3: Game logic, Combat
	void lateUpdate(float deltaTime);         // Phase 4: Post-processing

	// Set game mode
	void setGameMode(GameModeType mode);

	// Clear events collected during the previous frame
	void clearNetrowEvents();

	// Move all queued network events out of the ECS component (one registry lookup).
	std::vector<NetEvents::NetworkEvent> takeNetworkEvents();

	// Entity management (delegates to EntityFactory)
	entt::entity createActor(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer = Components::CollisionLayer::Enemy);
	entt::entity createBot(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer);
	entt::entity createProjectile(const Vector3D& pos, const Vector3D& velocity);
	entt::entity createWall(const Vector3D& pos, const Vector3D& halfExtents);
	entt::entity createTrigger(const Vector3D& pos, float radius);

	bool destroyEntity(entt::entity entity);
	void clearEntities();

	// Player management
	bool addPlayer(PlayerID id, const std::string& name, const std::string& characterClass);
	entt::entity createPlayer(PlayerID id, const std::string& name,
							  const std::string& characterClass,
							  Vector3D pos);
	void respawnPlayer(entt::entity player, const Vector3D& pos);
	bool removePlayer(PlayerID id);
	size_t getPlayerCount() const { return m_playerToEntity.size(); }

	// Input handling (forwards to controller component)
	void setPlayerInput(PlayerID id, const InputState& input);

	// PlayerID ↔ entt::entity mapping (for FFI compatibility)
	entt::entity getEntityByPlayerID(PlayerID id) const;
	PlayerID getPlayerIDByEntity(entt::entity entity) const;

	// Registry access (for systems)
	entt::registry& getRegistry() { return m_registry; }
	const entt::registry& getRegistry() const { return m_registry; }

	// Factory access (for MapLoader and other external producers)
	EntityFactory& getFactory() { return m_factory; }

	// Map data access
	const MapData& getMapData() const { return m_mapData; }

	// System access
	CharacterControllerSystem* getCharacterControllerSystem() { return m_characterControllerSystem; }
	PhysicsSystem* getPhysicsSystem() { return m_physicsSystem; }
	CollisionSystem* getCollisionSystem() { return m_collisionSystem; }
	CombatSystem* getCombatSystem() { return m_combatSystem; }
	SystemManager* getSystemManager() { return &m_systemManager; }

private:
	// EnTT registry (core data structure)
	entt::registry m_registry;

	// Entity factory (must be declared after m_registry for initialization order)
	EntityFactory m_factory;

	// System management
	SystemManager m_systemManager;

	// Cached system pointers (for convenience)
	CharacterControllerSystem* m_characterControllerSystem;
	PhysicsSystem* m_physicsSystem;
	CollisionSystem* m_collisionSystem;
	CombatSystem* m_combatSystem;
	GameModeSystem* m_gameModeSystem;

	// Loaded map data (arena dimensions, spawn points)
	MapData m_mapData;

	// Game manager entity
	entt::entity m_gameManager;

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
	: m_factory(m_registry)
	, m_characterControllerSystem(nullptr)
	, m_physicsSystem(nullptr)
	, m_collisionSystem(nullptr)
	, m_combatSystem(nullptr)
	, m_gameModeSystem(nullptr)
	, m_gameManager(entt::null)
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
	auto gameModeSystem = std::make_unique<GameModeSystem>();
	auto staminaSystem = std::make_unique<StaminaSystem>();

	m_gameManager = m_factory.createGameManager();

	// Load map data from JSON (path relative to backend/ working directory)
	MapLoader mapLoader(m_factory);
	m_mapData = mapLoader.loadFromFile(GameConfig::MAP_PATH);

	// TEMPORARY — parity check during preset migration. Removed in Task 8.
	{
		CharacterPresetLoader presetLoader;
		auto knight = presetLoader.loadFromFile(std::string(GameConfig::PRESETS_DIR) + "/players/knight.json");
		verifyPresetParity(knight, Presets::KNIGHT, "knight");
		auto rogue  = presetLoader.loadFromFile(std::string(GameConfig::PRESETS_DIR) + "/players/rogue.json");
		verifyPresetParity(rogue, Presets::ROGUE, "rogue");
	}

	// Pass registry to systems
	characterControllerSystem->setRegistry(&m_registry);
	physicsSystem->setRegistry(&m_registry);
	collisionSystem->setRegistry(&m_registry);
	combatSystem->setRegistry(&m_registry);
	gameModeSystem->setRegistry(&m_registry);
	staminaSystem->setRegistry(&m_registry);
	gameModeSystem->setSpawner(this);
	gameModeSystem->setMapData(&m_mapData);

	// Configure physics arena bounds from map data
	PhysicsSystem::Config physConfig;
	physConfig.arenaMinX = -(m_mapData.arenaWidth  / 2.0f);
	physConfig.arenaMaxX =  (m_mapData.arenaWidth  / 2.0f);
	physConfig.arenaMinZ = -(m_mapData.arenaLength / 2.0f);
	physConfig.arenaMaxZ =  (m_mapData.arenaLength / 2.0f);
	physicsSystem->setConfig(physConfig);

	// Pass GameManager to systems
	characterControllerSystem->setGameManager(m_gameManager);
	physicsSystem->setGameManager(m_gameManager);
	collisionSystem->setGameManager(m_gameManager);
	combatSystem->setGameManager(m_gameManager);
	gameModeSystem->setGameManager(m_gameManager);
	staminaSystem->setGameManager(m_gameManager);

	// Store raw pointers for convenience
	m_characterControllerSystem = characterControllerSystem.get();
	m_physicsSystem = physicsSystem.get();
	m_collisionSystem = collisionSystem.get();
	m_combatSystem = combatSystem.get();
	m_gameModeSystem = gameModeSystem.get();

	// Add to system manager (order matters: CharacterController -> Physics -> Collision -> Combat)
	m_systemManager.addSystem(std::move(characterControllerSystem));
	m_systemManager.addSystem(std::move(physicsSystem));
	m_systemManager.addSystem(std::move(collisionSystem));
	m_systemManager.addSystem(std::move(combatSystem));
	m_systemManager.addSystem(std::move(gameModeSystem));
	m_systemManager.addSystem(std::move(staminaSystem));

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

// Set Game mode
inline void World::setGameMode(GameModeType mode) {
	auto* gm = m_registry.try_get<Components::GameModeComponent>(m_gameManager);
	if (gm) {
		gm->modeType = mode;
		gm->matchStatus = MatchStatus::InProgress;
	}

	auto* ne = m_registry.try_get<Components::NetworkEventsComponent>(m_gameManager);
	if(ne) ne->events.clear();

	auto* ie = m_registry.try_get<Components::InternalEventsComponent>(m_gameManager);
	if(ie) ie->events.clear();

	auto* stats = m_registry.try_get<Components::MatchStatsComponent>(m_gameManager);
	if(stats) stats->playerStats.clear();

	// Do we handle it after player creation?
	// auto* pp = m_registry.try_get<Components::PendingPlayersComponent>(m_gameManager);
	// if(pp) pp->players.clear();

	if(m_gameModeSystem) m_gameModeSystem->startMode();
}

inline void World::clearNetrowEvents() {
	auto* ne = m_registry.try_get<Components::NetworkEventsComponent>(m_gameManager);
	if (ne) ne->events.clear();
}

inline std::vector<NetEvents::NetworkEvent> World::takeNetworkEvents() {
	auto* ne = m_registry.try_get<Components::NetworkEventsComponent>(m_gameManager);
	if (!ne || ne->events.empty()) return {};
	return std::exchange(ne->events, {});  // move out, leave component empty
}

// Entity management — delegates to EntityFactory
inline entt::entity World::createActor(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer) {
	return m_factory.createActor(pos, preset, layer);
}
inline entt::entity World::createBot(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer) {
	return m_factory.createBot(pos, preset, layer);
}
inline entt::entity World::createProjectile(const Vector3D& pos, const Vector3D& velocity) {
	return m_factory.createProjectile(pos, velocity);
}
inline entt::entity World::createWall(const Vector3D& pos, const Vector3D& halfExtents) {
	return m_factory.createWall(pos, halfExtents);
}
inline entt::entity World::createTrigger(const Vector3D& pos, float radius) {
	return m_factory.createTrigger(pos, radius);
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

// Player
inline entt::entity World::getEntityByPlayerID(PlayerID id) const {
	auto it = m_playerToEntity.find(id);
	return (it != m_playerToEntity.end()) ? it->second : entt::null;
}
inline PlayerID World::getPlayerIDByEntity(entt::entity entity) const {
	auto it = m_entityToPlayer.find(entity);
	return (it != m_entityToPlayer.end()) ? it->second : 0;
}

inline entt::entity World::createPlayer(PlayerID id, const std::string& name,
										const std::string& characterClass,
										Vector3D pos) {

	// Check if entity already exists
	if (m_playerToEntity.find(id) != m_playerToEntity.end()) {
		return entt::null;
	}

	const CharacterPreset& preset = presetFromClass(characterClass);
	entt::entity entity = m_factory.createActor(pos, preset, Components::CollisionLayer::Player);

	m_registry.emplace<PlayerTag>(entity);
	m_registry.emplace<Components::PlayerInfo>(entity, id, name, characterClass);
	m_registry.emplace<Components::CharacterController>(entity, Components::CharacterController::createFromPreset(preset.movement));

	registerPlayerIDMapping(entity, id);

	auto* ne = m_registry.try_get<Components::NetworkEventsComponent>(m_gameManager);
	if (ne) ne->events.push_back(NetEvents::SpawnEvent{ id, pos, characterClass });

	return entity;
}
inline bool World::removePlayer(PlayerID id) {

	entt::entity entity = getEntityByPlayerID(id);

	if (entity == entt::null) {
		return false;
	}

	// Notify game mode before destruction so it can purge stale entity refs
	if (m_gameModeSystem) m_gameModeSystem->notifyPlayerRemove(entity);

	// Unregister PlayerID mapping
	unregisterPlayerIDMapping(entity);

	destroyEntity(entity);

	return true;
}
inline void World::respawnPlayer(entt::entity player, const Vector3D& pos) {
	auto* health = m_registry.try_get<Components::Health>(player);
	if (!health || !health->isDead) return;
	auto* physicsBody = m_registry.try_get<Components::PhysicsBody>(player);
	auto* transform   = m_registry.try_get<Components::Transform>(player);

	auto* controller = m_registry.try_get<Components::CharacterController>(player);

	if (transform)   transform->setPosition(pos.x, pos.y, pos.z);
	if (physicsBody) physicsBody->setVelocity(0, 0, 0);
	if (health)      health->revive();
	auto* stamina = m_registry.try_get<Components::Stamina>(player);
	if (stamina) stamina->restore();
	if (controller) {
		controller->setState(CharacterState::Idle);
		controller->canMove = true;
	}

	auto* ne   = m_registry.try_get<Components::NetworkEventsComponent>(m_gameManager);
	auto* info = m_registry.try_get<Components::PlayerInfo>(player);
	if (ne && info) ne->events.push_back(NetEvents::SpawnEvent{ info->playerID, pos, info->characterClass });
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
inline bool World::addPlayer(PlayerID id, const std::string& name, const std::string& characterClass) {
	auto* pp = m_registry.try_get<Components::PendingPlayersComponent>(m_gameManager);
	if (!pp) return false;
	pp->players.push_back({ id, name, characterClass });
	return true;
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


} // namespace ArenaGame
