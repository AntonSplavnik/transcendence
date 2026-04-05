#pragma once

#include "Core/World.hpp"
#include "GameTypes.hpp"
#include "Presets.hpp"
#include <vector>
#include <chrono>
#include <cmath>

namespace ArenaGame {

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
// ArenaGame - EnTT-based game loop implementation
// =============================================================================
// Drop-in replacement for ArenaGame using World
// - Uses EnTT registry for entity storage (10-20x faster iteration)
// - Identical public interface to ArenaGame
// - Identical snapshot format (FFI compatible)
// - Deterministic physics (same as original)
//
// Performance improvements:
// - Faster system updates (packed component storage)
// - Lower memory usage (no std::optional overhead)
// - Better cache locality
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
    void start(GameModeType mode);
    void stop();
    bool isRunning() const { return m_isRunning; }

    // Main game loop - call this continuously
    // Uses fixed timestep internally for deterministic physics
    void update();

    // Player management
    bool addPlayer(PlayerID playerID, const std::string& name);
    bool removePlayer(PlayerID playerID);

    // Input handling
    void setPlayerInput(PlayerID playerID, const InputState& input);

    // State queries
    GameStateSnapshot createSnapshot() const;
    uint64_t getFrameNumber() const { return m_frameNumber; }
    double getGameTime() const { return m_gameTime; }
    size_t getPlayerCount() const { return m_world.getPlayerCount(); }

    // World access (for advanced usage)
    World& getWorld() { return m_world; }
    const World& getWorld() const { return m_world; }

private:
    // World manages all entities and systems
    World m_world;

    // Game state (identical to ArenaGame)
    bool m_isRunning;
    uint64_t m_frameNumber;
    double m_gameTime;
    float m_accumulator;
    std::chrono::steady_clock::time_point m_lastUpdateTime;

    // Spawn positions for players
    std::vector<Vector3D> m_spawnPositions;
    size_t m_nextSpawnIndex;

    void initializeSpawnPositions(int numPlayers = GameConfig::MAX_PLAYERS);
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

    // Pre-compute spawn positions for MAX_PLAYERS as a safe default.
    // start() will recompute based on actual player count.
    initializeSpawnPositions(GameConfig::MAX_PLAYERS);
}

inline void ArenaGame::start(GameModeType mode) {
    // Compute spawn circle based on the players already registered
    const int playerCount = static_cast<int>(m_world.getPlayerCount());
    initializeSpawnPositions(playerCount > 0 ? playerCount : GameConfig::MAX_PLAYERS);

    m_isRunning = true;
    m_frameNumber = 0;
    m_gameTime = 0.0;
    m_accumulator = 0.0;
    m_lastUpdateTime = std::chrono::steady_clock::now();

    m_world.setGameMode(mode);
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

    // Clear events collected during the previous frame
    m_world.clearNetrowEvents();

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
    entt::entity entity = m_world.createPlayer(playerID, name, spawnPos, Presets::KNIGHT);

    if (entity != entt::null) {
        // Face the arena centre (origin): yaw = atan2(-x, -z) for convention yaw=0 → +Z
        float yaw = std::atan2(-spawnPos.x, -spawnPos.z);
        m_world.getRegistry().get<Components::Transform>(entity).setRotation(0.0f, yaw, 0.0f);
    }

    return entity != entt::null;
}

inline bool ArenaGame::removePlayer(PlayerID playerID) {
    return m_world.removePlayer(playerID);
}

inline void ArenaGame::setPlayerInput(PlayerID playerID, const InputState& input) {
    m_world.setPlayerInput(playerID, input);
}

inline GameStateSnapshot ArenaGame::createSnapshot() const {
    GameStateSnapshot snapshot;
    snapshot.frameNumber = m_frameNumber;
    snapshot.timestamp = m_gameTime;

    // Get all entities that represent players (have all player components)
    auto& registry = const_cast<World&>(m_world).getRegistry();

    // View of all entities with player components
    auto view = registry.view<
        Components::PlayerInfo,
        Components::Transform,
        Components::PhysicsBody,
        Components::Health,
        Components::CharacterController
    >();

    // Convert entities to character snapshots
    view.each([&](Components::PlayerInfo& playerInfo,
                  Components::Transform& transform,
                  Components::PhysicsBody& physics,
                  Components::Health& health,
                  Components::CharacterController& controller) {

        // Skip dead entities
        /**
         * Inside a lambda, continue doesn't exist — return is used instead,
         * which exits thecurrent lambda call and each() moves on to the next entity.
         */
        if (!health.isAlive()) {
            return;  // continue in lambda
        }

        CharacterSnapshot charSnapshot;
        charSnapshot.playerID = playerInfo.playerID;
        charSnapshot.position = transform.position;
        charSnapshot.velocity = physics.velocity;
        charSnapshot.yaw = transform.getYaw();
        charSnapshot.state = controller.state;
        charSnapshot.health = health.current;
        charSnapshot.maxHealth = health.maximum;

        snapshot.characters.push_back(charSnapshot);
    });

    return snapshot;
}

inline void ArenaGame::initializeSpawnPositions(int numPlayers) {
    // Arena is centered at (0, 0, 0): positions range from -ARENA_WIDTH/2 to ARENA_WIDTH/2.
    // Divide the full circle equally among the given number of players.
    const float radius = GameConfig::ARENA_WIDTH * 0.35f;  // 35% of arena width (~17.5 units)
    const int numSpawns = numPlayers > 0 ? numPlayers : GameConfig::MAX_PLAYERS;
    const float angleStep = 2.0f * 3.14159265359f / numSpawns;

    m_spawnPositions.clear();
    m_spawnPositions.reserve(numSpawns);

    for (int i = 0; i < numSpawns; ++i) {
        float angle = i * angleStep;
        float x = radius * std::cos(angle);
        float z = radius * std::sin(angle);
        m_spawnPositions.push_back(Vector3D(x, GameConfig::GROUND_Y, z));
    }
}

inline Vector3D ArenaGame::getSpawnPosition() {
    if (m_spawnPositions.empty()) {
        // Fallback: center of arena (origin in centered coordinate system)
        return Vector3D(0.0f, GameConfig::GROUND_Y, 0.0f);
    }

    // Round-robin spawn selection
    Vector3D pos = m_spawnPositions[m_nextSpawnIndex];
    m_nextSpawnIndex = (m_nextSpawnIndex + 1) % m_spawnPositions.size();
    return pos;
}

} // namespace ArenaGame
