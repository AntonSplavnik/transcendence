#pragma once

#include "Core/Core.hpp"
#include "GameTypes.hpp"
#include <vector>
#include <chrono>
#include <cmath>

namespace ArenaGame {

// Forward declarations (for backwards compatibility)
class Character;

// =============================================================================
// GameState - Snapshot of the entire game state for network sync
// =============================================================================

struct CharacterSnapshot {
    PlayerID playerID;
    Vector3D position;
    Vector3D velocity;
    float yaw;
    CharacterState state;
    float health;
    float maxHealth;

    CharacterSnapshot() = default;
};

struct GameStateSnapshot {
    uint64_t frameNumber;
    std::vector<CharacterSnapshot> characters;
    double timestamp;

    GameStateSnapshot() : frameNumber(0), timestamp(0.0) {}
};

// =============================================================================
// ArenaGame - Main game loop with server-authoritative physics
// =============================================================================
// Now built on top of World and Entity-Component-System architecture
//
// This maintains backwards compatibility with the old Character-based API
// while using the new World/Entity system internally.
//
// Usage:
//   ArenaGame game;
//   game.start();
//   game.addPlayer(1, "Player1");
//   game.update();  // Updates all systems
//   GameStateSnapshot snapshot = game.createSnapshot();
// =============================================================================

class ArenaGame {
public:
    ArenaGame();
    ~ArenaGame() = default;

    // Game lifecycle
    void start();
    void stop();
    bool isRunning() const { return m_isRunning; }

    // Main game loop - call this continuously
    // Uses fixed timestep internally for deterministic physics
    void update();

    // Player management
    bool addPlayer(PlayerID playerID, const std::string& name);
    bool removePlayer(PlayerID playerID);

    // Backwards compatibility: Get entity as Character-like interface
    // Note: Returns nullptr - Character class is deprecated
    Character* getCharacter(PlayerID playerID);
    const Character* getCharacter(PlayerID playerID) const;

    // New API: Direct entity access
    Core::Entity* getEntity(PlayerID playerID) { return m_world.getEntity(playerID); }
    const Core::Entity* getEntity(PlayerID playerID) const { return m_world.getEntity(playerID); }

    // Input handling
    void setPlayerInput(PlayerID playerID, const InputState& input);

    // State queries
    GameStateSnapshot createSnapshot() const;
    uint64_t getFrameNumber() const { return m_frameNumber; }
    double getGameTime() const { return m_gameTime; }
    size_t getPlayerCount() const { return m_world.getPlayerCount(); }

    // Combat
    void registerHit(PlayerID attackerID, PlayerID victimID, float damage);

    // World access (for advanced usage)
    Core::World& getWorld() { return m_world; }
    const Core::World& getWorld() const { return m_world; }

private:
    // World manages all entities and systems
    Core::World m_world;

    // Game state
    bool m_isRunning;
    uint64_t m_frameNumber;
    double m_gameTime;
    float m_accumulator;
    std::chrono::steady_clock::time_point m_lastUpdateTime;

    // Spawn positions for players
    std::vector<Vector3D> m_spawnPositions;
    size_t m_nextSpawnIndex;

    void initializeSpawnPositions();
    Vector3D getSpawnPosition();
};

// =============================================================================
// ArenaGame Implementation
// =============================================================================

inline ArenaGame::ArenaGame()
    : m_isRunning(false)
    , m_frameNumber(0)
    , m_gameTime(0.0)
    , m_accumulator(0.0)
    , m_nextSpawnIndex(0)
{
    // Initialize world (creates and initializes all systems)
    m_world.initialize();

    // Setup spawn positions in a circle around center
    initializeSpawnPositions();
}

inline void ArenaGame::start() {
    m_isRunning = true;
    m_frameNumber = 0;
    m_gameTime = 0.0;
    m_accumulator = 0.0;
    m_lastUpdateTime = std::chrono::steady_clock::now();
}

inline void ArenaGame::stop() {
    m_isRunning = false;
}

inline void ArenaGame::update() {
    if (!m_isRunning) {
        return;
    }

    // Calculate delta time since last update
    auto currentTime = std::chrono::steady_clock::now();
    float deltaTime = std::chrono::duration<float>(currentTime - m_lastUpdateTime).count();
    m_lastUpdateTime = currentTime;

    // Clamp delta time to prevent spiral of death
    if (deltaTime > 0.1f) {
        deltaTime = 0.1f;
    }

    // Accumulate time for fixed timestep
    m_accumulator += deltaTime;

    // PHASE 1: EarlyUpdate - Input processing (variable dt)
    m_world.earlyUpdate(deltaTime);

    // PHASE 2: FixedUpdate - Physics & Collision (fixed dt, deterministic)
    int iterations = 0;
    while (m_accumulator >= GameConfig::FIXED_TIMESTEP && iterations < GameConfig::MAX_PHYSICS_ITERATIONS) {
        m_world.fixedUpdate(GameConfig::FIXED_TIMESTEP);

        m_accumulator -= GameConfig::FIXED_TIMESTEP;
        m_frameNumber++;
        m_gameTime += GameConfig::FIXED_TIMESTEP;
        iterations++;
    }

    // If we hit the iteration limit, reset accumulator to prevent spiral of death
    if (iterations >= GameConfig::MAX_PHYSICS_ITERATIONS) {
        m_accumulator = 0.0f;
    }

    // PHASE 3: Update - Game logic, Combat, AI (variable dt)
    m_world.update(deltaTime);

    // PHASE 4: LateUpdate - Post-processing, interpolation (variable dt)
    m_world.lateUpdate(deltaTime);
}

inline bool ArenaGame::addPlayer(PlayerID playerID, const std::string& name) {
    // Get spawn position
    Vector3D spawnPos = getSpawnPosition();

    // Create player entity through World
    Core::Entity* entity = m_world.addPlayer(playerID, name, spawnPos);

    return entity != nullptr;
}

inline bool ArenaGame::removePlayer(PlayerID playerID) {
    return m_world.removePlayer(playerID);
}

inline Character* ArenaGame::getCharacter(PlayerID playerID) {
    // Backwards compatibility: Return nullptr
    // The Character class is deprecated in favor of Entity
    // This method exists only for FFI compatibility and will be removed
    return nullptr;
}

inline const Character* ArenaGame::getCharacter(PlayerID playerID) const {
    // Backwards compatibility: Return nullptr
    return nullptr;
}

inline void ArenaGame::setPlayerInput(PlayerID playerID, const InputState& input) {
    // Delegate to World
    m_world.setPlayerInput(playerID, input);
}

inline GameStateSnapshot ArenaGame::createSnapshot() const {
    GameStateSnapshot snapshot;
    snapshot.frameNumber = m_frameNumber;
    snapshot.timestamp = m_gameTime;

    // Get all entities that represent players (have all player components)
    auto& world = const_cast<Core::World&>(m_world);
    auto entities = world.getEntitiesWith(
        true,   // Transform
        true,   // Physics
        false,  // Collider (don't filter on this)
        true,   // Health
        true,   // Controller
        false   // Combat (don't filter on this)
    );

    // Convert entities to character snapshots
    for (const auto* entity : entities) {
        if (!entity || !entity->isAlive()) {
            continue;
        }

        CharacterSnapshot charSnapshot;
        charSnapshot.playerID = entity->id;
        charSnapshot.position = entity->transform->position;
        charSnapshot.velocity = entity->physics->velocity;
        charSnapshot.yaw = entity->transform->getYaw();
        charSnapshot.state = entity->controller->state;
        charSnapshot.health = entity->health->current;
        charSnapshot.maxHealth = entity->health->maximum;

        snapshot.characters.push_back(charSnapshot);
    }

    return snapshot;
}

inline void ArenaGame::registerHit(PlayerID attackerID, PlayerID victimID, float damage) {
    // Delegate to World (which delegates to CombatSystem)
    m_world.registerHit(attackerID, victimID, damage);
}

inline void ArenaGame::initializeSpawnPositions() {
    // Create spawn positions in a circle around the center of the arena
    const float centerX = GameConfig::ARENA_WIDTH / 2.0f;
    const float centerZ = GameConfig::ARENA_LENGTH / 2.0f;
    const float radius = GameConfig::ARENA_WIDTH * 0.3f;  // 30% of arena width
    const int numSpawns = GameConfig::MAX_PLAYERS;
    const float angleStep = 2.0f * 3.14159265359f / numSpawns;

    m_spawnPositions.clear();
    m_spawnPositions.reserve(numSpawns);

    for (int i = 0; i < numSpawns; ++i) {
        float angle = i * angleStep;
        float x = centerX + radius * std::cos(angle);
        float z = centerZ + radius * std::sin(angle);
        m_spawnPositions.push_back(Vector3D(x, GameConfig::GROUND_Y, z));
    }
}

inline Vector3D ArenaGame::getSpawnPosition() {
    if (m_spawnPositions.empty()) {
        // Fallback: center of arena
        return Vector3D(
            GameConfig::ARENA_WIDTH / 2.0f,
            GameConfig::GROUND_Y,
            GameConfig::ARENA_LENGTH / 2.0f
        );
    }

    // Round-robin spawn selection
    Vector3D pos = m_spawnPositions[m_nextSpawnIndex];
    m_nextSpawnIndex = (m_nextSpawnIndex + 1) % m_spawnPositions.size();
    return pos;
}

} // namespace ArenaGame
