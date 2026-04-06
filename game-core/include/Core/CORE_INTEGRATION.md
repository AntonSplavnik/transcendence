# Core Architecture Integration Guide

This guide shows how to integrate the World and Entity system into ArenaGame.

## Architecture Overview

### Before (Old)
```
ArenaGame
├── manages map<PlayerID, Character*>
├── PhysicsSystem (new)
├── CollisionSystem (new)
└── CombatSystem (new)
```

### After (New)
```
ArenaGame
└── World
    ├── manages map<PlayerID, Entity*>
    └── SystemManager
        ├── PhysicsSystem
        ├── CollisionSystem
        └── CombatSystem
```

## File Structure

```
game_engine/include/Core/
├── Core.hpp           ← Convenience header
├── Entity.hpp         ← Entity with components
└── World.hpp          ← Manages entities & systems
```

## Step 1: Update ArenaGame.hpp

Replace Character management with World:

```cpp
#pragma once

#include "Core/Core.hpp"
#include <chrono>

namespace ArenaGame {

class ArenaGame {
public:
    ArenaGame();

    // Game lifecycle
    void start();
    void stop();
    bool isRunning() const { return m_isRunning; }
    void update();

    // Player management (now delegates to World)
    bool addPlayer(PlayerID playerID, const std::string& name);
    bool removePlayer(PlayerID playerID);
    size_t getPlayerCount() const;

    // Input handling (delegates to World)
    void setPlayerInput(PlayerID playerID, const InputState& input);

    // State queries
    GameStateSnapshot createSnapshot() const;
    uint64_t getFrameNumber() const { return m_frameNumber; }
    double getGameTime() const { return m_gameTime; }

    // Combat (delegates to World)
    void registerHit(PlayerID attackerID, PlayerID victimID, float damage);

    // World access
    Core::World& getWorld() { return m_world; }
    const Core::World& getWorld() const { return m_world; }

private:
    // World manages everything
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
    Vector3D getNextSpawnPosition();
};

} // namespace ArenaGame
```

## Step 2: Implement ArenaGame (Inline Implementation)

```cpp
inline ArenaGame::ArenaGame()
    : m_isRunning(false)
    , m_frameNumber(0)
    , m_gameTime(0.0)
    , m_accumulator(0.0)
    , m_nextSpawnIndex(0)
{
    // Initialize world (creates systems)
    m_world.initialize();

    // Setup spawn positions
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

    // Calculate delta time
    auto currentTime = std::chrono::steady_clock::now();
    float deltaTime = std::chrono::duration<float>(currentTime - m_lastUpdateTime).count();
    m_lastUpdateTime = currentTime;

    // Clamp delta time to prevent spiral of death
    deltaTime = std::min(deltaTime, 0.1f);

    // Accumulate time for fixed timestep
    m_accumulator += deltaTime;

    // Fixed timestep updates
    while (m_accumulator >= GameConfig::FIXED_TIMESTEP) {
        // Update world (which updates all systems)
        m_world.update(GameConfig::FIXED_TIMESTEP);

        m_accumulator -= GameConfig::FIXED_TIMESTEP;
        m_frameNumber++;
        m_gameTime += GameConfig::FIXED_TIMESTEP;
    }
}

inline bool ArenaGame::addPlayer(PlayerID playerID, const std::string& name) {
    Vector3D spawnPos = getNextSpawnPosition();
    Core::Entity* entity = m_world.addPlayer(playerID, name, spawnPos);
    return entity != nullptr;
}

inline bool ArenaGame::removePlayer(PlayerID playerID) {
    return m_world.removePlayer(playerID);
}

inline size_t ArenaGame::getPlayerCount() const {
    return m_world.getPlayerCount();
}

inline void ArenaGame::setPlayerInput(PlayerID playerID, const InputState& input) {
    m_world.setPlayerInput(playerID, input);
}

inline void ArenaGame::registerHit(PlayerID attackerID, PlayerID victimID, float damage) {
    m_world.registerHit(attackerID, victimID, damage);
}

inline GameStateSnapshot ArenaGame::createSnapshot() const {
    GameStateSnapshot snapshot;
    snapshot.frameNumber = m_frameNumber;
    snapshot.timestamp = m_gameTime;

    // Get all entities with required components
    // Note: This is a const_cast workaround - ideally getEntitiesWith should have const version
    auto& world = const_cast<Core::World&>(m_world);
    auto entities = world.getEntitiesWith(true, true, false, true, false, false);

    for (const auto* entity : entities) {
        if (!entity->isAlive()) {
            continue;
        }

        CharacterSnapshot charSnapshot;
        charSnapshot.playerID = entity->id;
        charSnapshot.position = entity->transform->position;
        charSnapshot.velocity = entity->physics->velocity;
        charSnapshot.yaw = entity->transform->getYaw();
        charSnapshot.state = entity->hasController() ? entity->controller->state : CharacterState::Idle;
        charSnapshot.health = entity->health->current;
        charSnapshot.maxHealth = entity->health->maximum;

        snapshot.characters.push_back(charSnapshot);
    }

    return snapshot;
}

inline void ArenaGame::initializeSpawnPositions() {
    // Create spawn positions in a circle around the center
    const float radius = GameConfig::ARENA_WIDTH * 0.3f;
    const int numSpawns = GameConfig::MAX_PLAYERS;
    const float angleStep = 2.0f * 3.14159f / numSpawns;

    for (int i = 0; i < numSpawns; ++i) {
        float angle = i * angleStep;
        float x = GameConfig::ARENA_WIDTH / 2.0f + radius * std::cos(angle);
        float z = GameConfig::ARENA_LENGTH / 2.0f + radius * std::sin(angle);
        m_spawnPositions.push_back(Vector3D(x, 0.0f, z));
    }
}

inline Vector3D ArenaGame::getNextSpawnPosition() {
    if (m_spawnPositions.empty()) {
        return Vector3D(
            GameConfig::ARENA_WIDTH / 2.0f,
            0.0f,
            GameConfig::ARENA_LENGTH / 2.0f
        );
    }

    Vector3D pos = m_spawnPositions[m_nextSpawnIndex];
    m_nextSpawnIndex = (m_nextSpawnIndex + 1) % m_spawnPositions.size();
    return pos;
}
```

## Step 3: Usage Examples

### Create Players
```cpp
ArenaGame game;
game.start();

// Add players
game.addPlayer(1, "Player1");
game.addPlayer(2, "Player2");

// Access entities directly through World
Core::Entity* player1 = game.getWorld().getPlayer(1);
if (player1) {
    player1->health->takeDamage(10.0f);
    player1->combat->baseDamage = 20.0f;
}
```

### Create Projectiles
```cpp
// Get attacker position and direction
Core::Entity* attacker = game.getWorld().getPlayer(1);
Vector3D spawnPos = attacker->transform->position;
Vector3D velocity = attacker->transform->getForwardDirection() * 20.0f;

// Create projectile entity
PlayerID projectileId = 2000; // Use high IDs for projectiles
Core::Entity* bullet = game.getWorld().createProjectile(projectileId, spawnPos, velocity);
```

### Create Walls
```cpp
// Create a wall at the edge of the arena
Vector3D wallPos(GameConfig::ARENA_WIDTH / 2.0f, 1.0f, 0.0f);
Vector3D halfExtents(GameConfig::ARENA_WIDTH / 2.0f, 2.0f, 0.5f);
game.getWorld().createWall(3000, wallPos, halfExtents);
```

### Update Game
```cpp
// Game loop
while (game.isRunning()) {
    game.update();  // Updates all systems through World

    // Get snapshot for network
    GameStateSnapshot snapshot = game.createSnapshot();
    // Send to clients...
}
```

## Benefits of World Architecture

### 1. Clean Separation
```cpp
// Before: Mixed concerns
Character character;
character.applyMovement();     // Physics
character.tryAttack();          // Combat
character.takeDamage();         // Health

// After: Separate systems
World world;
world.update();  // All systems update automatically
```

### 2. Flexible Entity Types
```cpp
// Character: All components
Entity player = Entity::createCharacter(1, "Player", pos);

// Projectile: Only Transform + Physics + Collider
Entity bullet = Entity::createProjectile(2, pos, velocity);

// Wall: Only Transform + Collider
Entity wall = Entity::createWall(3, pos, halfExtents);
```

### 3. Easy Queries
```cpp
// Get all entities with physics
auto movingEntities = world.getEntitiesWith(true, true);

// Get all entities with health (for damage effects)
auto damageableEntities = world.getEntitiesWith(true, false, false, true);

// Get all players (health + controller)
auto players = world.getEntitiesWith(true, false, false, true, true);
```

## Migration Checklist

- [x] Create Core/Entity.hpp
- [x] Create Core/World.hpp
- [x] Create Core/Core.hpp
- [ ] Update ArenaGame to use World
- [ ] Update systems to work with Entity* instead of Character*
- [ ] Update FFI bindings to work with World
- [ ] Test that existing functionality works
- [ ] Add projectile support
- [ ] Add wall collision support

## Next Steps

1. **Update Systems**: Modify PhysicsSystem, CollisionSystem, CombatSystem to work with Entity* instead of Character*
2. **Add Projectile System**: Create system to handle projectile logic
3. **Add Raycast System**: For hitscan weapons
4. **Update FFI**: Update game_bindings.cpp to use World API

## Testing

```cpp
// Test entity creation
World world;
world.initialize();

// Create character
Entity* player = world.createCharacter(1, "Test", Vector3D(0, 0, 0));
assert(player != nullptr);
assert(player->hasTransform());
assert(player->hasPhysics());
assert(player->hasHealth());

// Create projectile
Entity* bullet = world.createProjectile(100, Vector3D(0, 0, 0), Vector3D(10, 0, 0));
assert(bullet != nullptr);
assert(bullet->hasPhysics());
assert(!bullet->hasHealth());  // Projectiles don't have health

// Update world
world.update(0.016f);

// Check projectile moved
assert(bullet->transform->position.x > 0.0f);
```
