# ECS Architecture & Multi-Phase Update Loop

## Overview

The game engine uses Entity-Component-System (ECS) architecture with a multi-phase update loop.

## Architecture

```
ArenaGame (API)
└── World (Entity Manager)
    ├── Entities (map<ID, Entity>)
    │   └── Components (optional data)
    └── SystemManager
        └── Systems (logic, different phases)
```

## Components (Data Only)

Located in `include/components/`

| Component | Data |
|-----------|------|
| **Transform** | position, rotation, scale |
| **PhysicsBody** | velocity, mass, friction, gravity settings |
| **Collider** | shape (cylinder/sphere/box), layers, radius/height |
| **Health** | current HP, max HP, armor, resistance |
| **CharacterController** | input state, movement speed, jump velocity |
| **CombatController** | damage, attack cooldown, combo system |

## Systems (Logic Only)

Located in `include/Systems/`

| System | Phase | Operates On |
|--------|-------|-------------|
| **PhysicsSystem** | FixedUpdate | Transform + PhysicsBody |
| **CollisionSystem** | FixedUpdate | Transform + Collider |
| **CombatSystem** | Update | Health + CombatController |

## Multi-Phase Update Loop

```cpp
void ArenaGame::update() {
    // Phase 1: EarlyUpdate (variable dt) - Input processing
    world.earlyUpdate(deltaTime);

    // Phase 2: FixedUpdate (fixed 1/60s) - Physics (0-N times)
    while (accumulator >= 0.01667f) {
        world.fixedUpdate(0.01667f);  // Deterministic
        accumulator -= 0.01667f;
    }

    // Phase 3: Update (variable dt) - Game logic
    world.update(deltaTime);

    // Phase 4: LateUpdate (variable dt) - Post-processing
    world.lateUpdate(deltaTime);
}
```

### Phase Details

- **EarlyUpdate**: Input processing, pre-physics logic
- **FixedUpdate**: Physics simulation (always 60 FPS, deterministic)
- **Update**: Combat, AI, game logic (responsive)
- **LateUpdate**: Camera, interpolation, rendering

## Entity Types

```cpp
// Player (all 6 components)
Entity* player = world.createCharacter(1, "Player", spawnPos);

// Projectile (3 components: Transform + PhysicsBody + Collider)
Entity* bullet = world.createProjectile(100, pos, velocity);

// Wall (2 components: Transform + Collider)
Entity* wall = world.createWall(200, pos, halfExtents);
```

## Creating Custom Systems

```cpp
class AISystem : public System {
    void update(float dt) override {
        // Your logic here
    }

    bool needsUpdate() const override { return true; }
    const char* getName() const override { return "AISystem"; }
};

// Add to world
world.getSystemManager()->addSystem(std::make_unique<AISystem>());
```

## FFI (Rust Integration)

C++ side: `game_engine/src/game_bindings.cpp`
Rust side: `backend/src/game/ffi.rs`

### New Functions

```rust
// Entity management
game.create_projectile(id, pos, vel);
game.create_wall(id, pos, size);
game.destroy_entity(id);

// Component access
game.get_entity_position(id);
game.set_entity_velocity(id, vel);
game.get_entity_health(id);
```

## Key Benefits

1. **Separation**: Data (components) ≠ Logic (systems)
2. **Flexibility**: Mix components to create any entity type
3. **Determinism**: Physics at fixed 60 FPS
4. **Performance**: Systems only update what they need
5. **Extensibility**: Add new components/systems without changing existing code

## File Structure

```
include/
├── ArenaGame.hpp           # Main API
├── GameTypes.hpp           # Base types
├── components/             # All components
│   ├── Transform.hpp
│   ├── PhysicsBody.hpp
│   ├── Collider.hpp
│   ├── Health.hpp
│   ├── CharacterController.hpp
│   └── CombatController.hpp
├── Systems/                # All systems
│   ├── System.hpp          # Base class
│   ├── SystemManager.hpp
│   ├── GameLoop.hpp        # Update loop manager
│   ├── PhysicsSystem.hpp
│   ├── CollisionSystem.hpp
│   └── CombatSystem.hpp
└── core/                   # ECS core
    ├── Entity.hpp
    └── World.hpp
```

## Quick Reference

### Create Entities

```cpp
world.addPlayer(id, "Name", pos);           // Player
world.createProjectile(id, pos, vel);       // Bullet
world.createWall(id, pos, size);            // Wall
```

### Access Components

```cpp
Entity* e = world.getEntity(id);
e->transform->position = Vector3D(x, y, z);
e->physics->velocity = Vector3D(vx, vy, vz);
e->health->takeDamage(damage);
```

### Update Loop

```cpp
game.update();  // Handles all 4 phases automatically
```

## Migration Notes

- **Old**: Character class with mixed data/logic
- **New**: Entity with components, Systems with logic
- **FFI**: Backwards compatible + new entity functions
- **API**: ArenaGame API unchanged (internally uses ECS)
