#pragma once

#include "GameTypes.hpp"
#include "Character.hpp"
#include <vector>
#include <unordered_map>
#include <memory>
#include <chrono>

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
    CharacterSnapshot(const Character& character)
        : playerID(character.getPlayerID())
        , position(character.getPosition())
        , velocity(character.getVelocity())
        , yaw(character.getYaw())
        , state(character.getState())
        , health(character.getStats().currentHealth)
        , maxHealth(character.getStats().maxHealth)
    {}
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

class ArenaGame {
public:
    ArenaGame();

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
    Character* getCharacter(PlayerID playerID);
    const Character* getCharacter(PlayerID playerID) const;

    // Input handling
    void setPlayerInput(PlayerID playerID, const InputState& input);

    // State queries
    GameStateSnapshot createSnapshot() const;
    uint64_t getFrameNumber() const { return m_frameNumber; }
    double getGameTime() const { return m_gameTime; }
    size_t getPlayerCount() const { return m_characters.size(); }

    // Combat
    void registerHit(PlayerID attackerID, PlayerID victimID, float damage);

private:
    // Physics simulation with fixed timestep
    void physicsUpdate(float deltaTime);

    // Collision detection and resolution
    void resolveCollisions();
    void resolveCharacterCollision(Character& a, Character& b);

    // Combat processing
    void processCombat();

    // Spawn logic
    Vector3D getSpawnPosition() const;

    // Game state
    bool m_isRunning;
    uint64_t m_frameNumber;
    double m_gameTime;

    // Timing for fixed timestep
    std::chrono::steady_clock::time_point m_lastUpdateTime;
    float m_accumulator;

    // Network snapshot timing
    float m_snapshotAccumulator;

    // Characters (players)
    std::unordered_map<PlayerID, std::unique_ptr<Character>> m_characters;

    // Spawn points
    std::vector<Vector3D> m_spawnPoints;
    size_t m_nextSpawnIndex;
};

// =============================================================================
// ArenaGame Implementation
// =============================================================================

inline ArenaGame::ArenaGame()
    : m_isRunning(false)
    , m_frameNumber(0)
    , m_gameTime(0.0)
    , m_lastUpdateTime()
    , m_accumulator(0.0f)
    , m_snapshotAccumulator(0.0f)
    , m_nextSpawnIndex(0)
{
    // Initialize spawn points around the arena
    // Place spawn points in a circle pattern
    const float spawnRadius = GameConfig::ARENA_WIDTH * 0.3f;
    const float centerX = GameConfig::ARENA_WIDTH * 0.5f;
    const float centerZ = GameConfig::ARENA_LENGTH * 0.5f;

    for (int i = 0; i < GameConfig::MAX_PLAYERS; ++i) {
        float angle = (2.0f * 3.14159f * i) / GameConfig::MAX_PLAYERS;
        float x = centerX + spawnRadius * std::cos(angle);
        float z = centerZ + spawnRadius * std::sin(angle);
        m_spawnPoints.push_back(Vector3D(x, GameConfig::GROUND_Y, z));
    }
}

inline void ArenaGame::start() {
    m_isRunning = true;
    m_frameNumber = 0;
    m_gameTime = 0.0;
    m_accumulator = 0.0f;
    m_snapshotAccumulator = 0.0f;
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
    std::chrono::duration<float> elapsed = currentTime - m_lastUpdateTime;
    float deltaTime = elapsed.count();
    m_lastUpdateTime = currentTime;

    // Cap delta time to prevent spiral of death
    if (deltaTime > GameConfig::FIXED_TIMESTEP * GameConfig::MAX_PHYSICS_ITERATIONS) {
        deltaTime = GameConfig::FIXED_TIMESTEP * GameConfig::MAX_PHYSICS_ITERATIONS;
    }

    // Accumulate time for fixed timestep updates
    m_accumulator += deltaTime;

    // Fixed timestep physics loop
    int iterations = 0;
    while (m_accumulator >= GameConfig::FIXED_TIMESTEP && iterations < GameConfig::MAX_PHYSICS_ITERATIONS) {
        physicsUpdate(GameConfig::FIXED_TIMESTEP);
        m_accumulator -= GameConfig::FIXED_TIMESTEP;
        m_gameTime += GameConfig::FIXED_TIMESTEP;
        m_frameNumber++;
        iterations++;
    }

    // Update snapshot timing
    m_snapshotAccumulator += deltaTime;
}

inline void ArenaGame::physicsUpdate(float deltaTime) {
    // Update all characters
    for (auto& [playerID, character] : m_characters) {
        if (character->isAlive()) {
            character->update(deltaTime);
        }
    }

    // Resolve collisions between characters
    resolveCollisions();

    // Process combat
    processCombat();
}

inline void ArenaGame::resolveCollisions() {
    // Simple O(n^2) collision detection
    // For larger player counts, use spatial partitioning (quadtree, grid, etc.)

    std::vector<Character*> activeCharacters;
    activeCharacters.reserve(m_characters.size());

    for (auto& [playerID, character] : m_characters) {
        if (character->isAlive()) {
            activeCharacters.push_back(character.get());
        }
    }

    // Check all pairs
    for (size_t i = 0; i < activeCharacters.size(); ++i) {
        for (size_t j = i + 1; j < activeCharacters.size(); ++j) {
            Cylinder cylA = activeCharacters[i]->getCollisionCylinder();
            Cylinder cylB = activeCharacters[j]->getCollisionCylinder();

            if (cylA.intersects(cylB)) {
                resolveCharacterCollision(*activeCharacters[i], *activeCharacters[j]);
            }
        }
    }
}

inline void ArenaGame::resolveCharacterCollision(Character& a, Character& b) {
    // Simple push-apart collision resolution
    Vector3D posA = a.getPosition();
    Vector3D posB = b.getPosition();

    // Calculate horizontal separation vector (ignore Y)
    Vector3D separation(posB.x - posA.x, 0.0f, posB.z - posA.z);
    float distance = separation.length();

    if (distance < 0.0001f) {
        // Characters are at exactly the same position, push them apart arbitrarily
        separation = Vector3D(1.0f, 0.0f, 0.0f);
        distance = 1.0f;
    }

    // Calculate overlap
    float minDistance = GameConfig::CHARACTER_COLLISION_RADIUS * 2.0f;
    float overlap = minDistance - distance;

    if (overlap > 0.0f) {
        // Normalize separation vector
        Vector3D direction = separation * (1.0f / distance);

        // Push both characters apart equally
        Vector3D pushVector = direction * (overlap * 0.5f);

        posA = posA - pushVector;
        posB = posB + pushVector;

        a.setPosition(posA);
        b.setPosition(posB);
    }
}

inline void ArenaGame::processCombat() {
    // This is where you'd process melee attacks, projectile collisions, etc.
    // For now, this is a placeholder for combat logic

    for (auto& [playerID, character] : m_characters) {
        if (!character->isAlive()) {
            continue;
        }

        const InputState& input = character->getInput();

        // Handle attack input
        if (input.isAttacking) {
            if (character->tryAttack()) {
                // Attack was initiated successfully
                // TODO: Create projectile or melee attack hitbox
                // TODO: Check for hits against other players
            }
        }
    }
}

inline bool ArenaGame::addPlayer(PlayerID playerID, const std::string& name) {
    // Check if player already exists
    if (m_characters.find(playerID) != m_characters.end()) {
        return false;
    }

    // Check if we've reached max players
    if (m_characters.size() >= GameConfig::MAX_PLAYERS) {
        return false;
    }

    // Create new character at spawn position
    Vector3D spawnPos = getSpawnPosition();
    auto character = std::make_unique<Character>(playerID, name, spawnPos);

    m_characters[playerID] = std::move(character);
    return true;
}

inline bool ArenaGame::removePlayer(PlayerID playerID) {
    auto it = m_characters.find(playerID);
    if (it == m_characters.end()) {
        return false;
    }

    m_characters.erase(it);
    return true;
}

inline Character* ArenaGame::getCharacter(PlayerID playerID) {
    auto it = m_characters.find(playerID);
    if (it != m_characters.end()) {
        return it->second.get();
    }
    return nullptr;
}

inline const Character* ArenaGame::getCharacter(PlayerID playerID) const {
    auto it = m_characters.find(playerID);
    if (it != m_characters.end()) {
        return it->second.get();
    }
    return nullptr;
}

inline void ArenaGame::setPlayerInput(PlayerID playerID, const InputState& input) {
    Character* character = getCharacter(playerID);
    if (character && character->isAlive()) {
        character->setInput(input);
    }
}

inline GameStateSnapshot ArenaGame::createSnapshot() const {
    GameStateSnapshot snapshot;
    snapshot.frameNumber = m_frameNumber;
    snapshot.timestamp = m_gameTime;

    snapshot.characters.reserve(m_characters.size());
    for (const auto& [playerID, character] : m_characters) {
        snapshot.characters.emplace_back(*character);
    }

    return snapshot;
}

inline void ArenaGame::registerHit(PlayerID attackerID, PlayerID victimID, float damage) {
    Character* victim = getCharacter(victimID);
    if (victim && victim->isAlive()) {
        victim->takeDamage(damage, attackerID);

        // TODO: Track kill/death statistics
        // TODO: Handle respawning
    }
}

inline Vector3D ArenaGame::getSpawnPosition() const {
    if (m_spawnPoints.empty()) {
        // Fallback: center of arena
        return Vector3D(
            GameConfig::ARENA_WIDTH * 0.5f,
            GameConfig::GROUND_Y,
            GameConfig::ARENA_LENGTH * 0.5f
        );
    }

    // Simple round-robin spawn selection
    return m_spawnPoints[m_nextSpawnIndex % m_spawnPoints.size()];
}

} // namespace ArenaGame
