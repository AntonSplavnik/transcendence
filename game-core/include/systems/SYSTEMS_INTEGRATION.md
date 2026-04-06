# Systems Integration Guide

This guide shows how to integrate the new systems architecture with the existing ArenaGame code.

## Overview

We've extracted three core systems from the monolithic Character and ArenaGame classes:

1. **PhysicsSystem** - Handles physics simulation (gravity, velocity, position)
2. **CollisionSystem** - Handles collision detection and resolution
3. **CombatSystem** - Handles combat logic (attacks, damage, death)

## Architecture

```
Before:
  ArenaGame
    ├── manages Characters
    ├── physics update (mixed with Character)
    ├── collision resolution
    └── combat processing

After:
  ArenaGame
    ├── SystemManager
    │   ├── PhysicsSystem
    │   ├── CollisionSystem
    │   └── CombatSystem
    └── manages Characters
```

## Step 1: Update ArenaGame.hpp

Add the SystemManager to ArenaGame:

```cpp
#include "SystemManager.hpp"
#include "PhysicsSystem.hpp"
#include "CollisionSystem.hpp"
#include "CombatSystem.hpp"

class ArenaGame {
public:
    ArenaGame();
    // ... existing methods ...

private:
    // Add system manager
    SystemManager m_systemManager;

    // Keep references to systems for easy access
    PhysicsSystem* m_physicsSystem;
    CollisionSystem* m_collisionSystem;
    CombatSystem* m_combatSystem;

    // ... existing members ...
};
```

## Step 2: Initialize Systems in Constructor

```cpp
inline ArenaGame::ArenaGame()
    : m_isRunning(false)
    , m_frameNumber(0)
    , m_gameTime(0.0)
    , m_accumulator(0.0)
{
    // Create and register systems
    auto physicsSystem = std::make_unique<PhysicsSystem>();
    auto collisionSystem = std::make_unique<CollisionSystem>();
    auto combatSystem = std::make_unique<CombatSystem>();

    // Store raw pointers for easy access
    m_physicsSystem = physicsSystem.get();
    m_collisionSystem = collisionSystem.get();
    m_combatSystem = combatSystem.get();

    // Add to system manager (order matters!)
    m_systemManager.addSystem(std::move(physicsSystem));
    m_systemManager.addSystem(std::move(collisionSystem));
    m_systemManager.addSystem(std::move(combatSystem));

    // Initialize all systems
    m_systemManager.initialize();
}
```

## Step 3: Register Characters with Systems

When adding a player:

```cpp
inline bool ArenaGame::addPlayer(PlayerID playerID, const std::string& name) {
    // ... existing player creation code ...

    Character* character = m_characters[playerID].get();

    // Register with systems
    m_physicsSystem->addCharacter(character);
    m_collisionSystem->addCharacter(character);
    m_combatSystem->addCharacter(character);

    return true;
}
```

When removing a player:

```cpp
inline bool ArenaGame::removePlayer(PlayerID playerID) {
    Character* character = getCharacter(playerID);
    if (!character) {
        return false;
    }

    // Unregister from systems
    m_physicsSystem->removeCharacter(character);
    m_collisionSystem->removeCharacter(character);
    m_combatSystem->removeCharacter(character);

    // ... existing removal code ...
}
```

## Step 4: Update Game Loop

Replace the existing `physicsUpdate()` with system updates:

```cpp
inline void ArenaGame::update() {
    if (!m_isRunning) {
        return;
    }

    // Calculate delta time (existing code)
    auto currentTime = std::chrono::steady_clock::now();
    float deltaTime = std::chrono::duration<float>(currentTime - m_lastUpdateTime).count();
    m_lastUpdateTime = currentTime;

    // Accumulator for fixed timestep (existing code)
    m_accumulator += deltaTime;

    while (m_accumulator >= GameConfig::FIXED_TIMESTEP) {
        // OLD WAY (remove these):
        // for (auto& [playerID, character] : m_characters) {
        //     character->update(GameConfig::FIXED_TIMESTEP);
        // }
        // resolveCollisions();
        // processCombat();

        // NEW WAY: Update all systems
        m_systemManager.update(GameConfig::FIXED_TIMESTEP);

        m_accumulator -= GameConfig::FIXED_TIMESTEP;
        m_frameNumber++;
        m_gameTime += GameConfig::FIXED_TIMESTEP;
    }
}
```

## Step 5: Update Combat Integration

Replace `registerHit()` to use CombatSystem:

```cpp
inline void ArenaGame::registerHit(PlayerID attackerID, PlayerID victimID, float damage) {
    m_combatSystem->registerHit(attackerID, victimID, damage);
}
```

## Migration Strategy

### Phase 1: Parallel Execution (Current)
- Keep existing Character methods
- Run systems alongside existing code
- Verify systems produce identical results

### Phase 2: Remove Duplicated Logic
- Remove `Character::applyMovement()` (replaced by PhysicsSystem)
- Remove `Character::applyGravity()` (replaced by PhysicsSystem)
- Remove `ArenaGame::resolveCollisions()` (replaced by CollisionSystem)
- Remove `ArenaGame::processCombat()` (replaced by CombatSystem)

### Phase 3: Extract Character Data
- Move physics data to PhysicsBody component
- Move collision data to Collider component
- Move combat data to Health component
- Character becomes thin wrapper

## Benefits

1. **Single Responsibility** - Each system handles one aspect
2. **Testable** - Can unit test PhysicsSystem independently
3. **Extensible** - Easy to add ProjectileSystem, RaycastSystem
4. **Maintainable** - Physics bugs? Look in PhysicsSystem only
5. **Configurable** - Each system has its own config struct

## Next Steps

1. Add `setVelocity()` to Character for full PhysicsSystem migration
2. Add ProjectileSystem for projectile weapons
3. Add RaycastSystem for hitscan weapons and wall detection
4. Add WallSystem for static collision geometry

## Testing

Test that systems work correctly:

```cpp
// Test PhysicsSystem
PhysicsSystem physics;
Character testChar(1, "Test", Vector3D(0, 10, 0));
physics.addCharacter(&testChar);
physics.update(0.016f);  // Should apply gravity

// Test CollisionSystem
CollisionSystem collision;
Character char1(1, "A", Vector3D(0, 0, 0));
Character char2(2, "B", Vector3D(0.5, 0, 0));  // Overlapping
collision.addCharacter(&char1);
collision.addCharacter(&char2);
collision.update(0.016f);  // Should push apart
```
