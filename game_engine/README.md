# ArenaGame Engine

A server-authoritative 3D multiplayer arena combat engine written in C++ for Diablo 2-style dungeon looter gameplay.

## Overview

This is a physics-based game engine designed for online multiplayer arena combat with 2+ players. The engine uses:

- **Server-authoritative architecture** - All physics and combat calculations run on the server
- **Fixed timestep physics loop** - Deterministic 60 FPS physics simulation
- **3D movement system** - Full 3D character movement with gravity and jumping
- **Collision detection** - Character-to-character and arena boundary collision
- **Network-ready snapshots** - State snapshots for efficient client synchronization

## Architecture

### Core Components

1. **GameTypes.hpp** - Fundamental types and structures
   - `Vector3D` - 3D vector math
   - `Cylinder` - Collision primitives
   - `CharacterStats` - Health, damage, speed, etc.
   - `InputState` - Player input representation
   - `GameConfig` - Global game constants

2. **Character.hpp** - Player character class
   - Movement with WASD-style input
   - Gravity and jumping physics
   - Attack system with cooldowns
   - Health and damage handling
   - State machine (Idle, Moving, Attacking, Dead, etc.)

3. **ArenaGame.hpp** - Main game loop manager
   - Fixed timestep physics loop (60 FPS)
   - Player management (add/remove)
   - Collision detection and resolution
   - State snapshot generation for networking
   - Combat processing

### Coordinate System

- **X axis**: Arena width (left/right)
- **Y axis**: Up/down (Y+ is up, gravity pulls down on Y-)
- **Z axis**: Arena length (forward/backward)

## Usage

### Basic Server Integration

```cpp
#include "ArenaGame.hpp"

ArenaGame::ArenaGame game;

// Start the game
game.start();

// Add players
game.addPlayer(1, "Player1");
game.addPlayer(2, "Player2");

// Game loop
while (game.isRunning()) {
    // Update physics (call this as fast as possible)
    game.update();

    // Get state snapshot for network sync (20Hz recommended)
    GameStateSnapshot snapshot = game.createSnapshot();

    // Send snapshot to clients via WebTransport/WebSocket
    sendToClients(snapshot);
}
```

### Handling Player Input

```cpp
// Receive input from client
InputState input;
input.movementDirection = Vector3D(x, 0.0f, z);  // Normalized
input.isJumping = keySpace;
input.isAttacking = mouseButton;

// Apply to character
game.setPlayerInput(playerID, input);
```

### Integration with Rust Backend

The engine provides a C API (see `example_usage.cpp`) that can be called from Rust using FFI:

```rust
// In your Rust code
extern "C" {
    fn game_create() -> *mut ArenaGame;
    fn game_update(game: *mut ArenaGame);
    fn game_set_player_input(game: *mut ArenaGame, player_id: u32, ...);
}
```

## Game Loop Details

### Fixed Timestep

The engine uses a **fixed timestep loop** for deterministic physics:

- **Target**: 60 FPS (16.67ms per frame)
- **Accumulator pattern**: Decouples rendering from physics
- **Spiral of death prevention**: Caps max iterations per update

### Physics Updates

Each physics tick:
1. Update all character movement and gravity
2. Resolve character-to-character collisions
3. Process combat (attacks, projectiles)
4. Update character states

### Network Sync

Recommended approach:
- **Server**: Send state snapshots at 20Hz (every 50ms)
- **Clients**: Interpolate between snapshots for smooth rendering
- **Input**: Send player input to server at 60Hz

## Movement System

### Horizontal Movement (XZ Plane)

- Input is normalized direction vector on XZ plane
- Movement speed defined in `CharacterStats::movementSpeed`
- Friction applied when no input (smooth stop)
- Clamped to max speed

### Vertical Movement (Y Axis)

- Gravity constantly pulls character down
- Jumping applies upward velocity
- Ground detection sets `isGrounded` flag
- Can only jump when grounded

### Collision

- Characters are represented as cylinders
- Horizontal collision (XZ plane) with push-apart resolution
- Arena boundaries enforce min/max X and Z positions

## Configuration

Key constants in `GameConfig`:

```cpp
// Arena
ARENA_WIDTH = 100.0f      // X dimension
ARENA_LENGTH = 100.0f     // Z dimension
ARENA_HEIGHT = 20.0f      // Y dimension (ceiling)

// Physics
GRAVITY = -20.0f          // m/s²
JUMP_VELOCITY = 8.0f      // Initial jump speed
FRICTION = 0.85f          // Deceleration factor

// Character
CHARACTER_RADIUS = 0.5f   // Collision radius
CHARACTER_HEIGHT = 1.8f   // Height in meters

// Timing
TARGET_FPS = 60           // Physics rate
SNAPSHOT_RATE = 20.0f     // Network update rate
```

## Building

### Standalone Example

```bash
cd game_engine
g++ -std=c++17 -I./include src/example_usage.cpp -o game_server
./game_server
```

### With Rust Backend

1. Build C++ as a static library
2. Link from Rust using `cc` crate or `build.rs`
3. Use FFI to call game functions

## Combat System

### Current Implementation

- Attack cooldown based on `attackSpeed` stat
- `tryAttack()` returns true if attack initiated successfully
- Damage application via `takeDamage()`
- Death and respawn system

### To Be Implemented

- Melee attack hitboxes
- Projectile system
- Ability system (ability1, ability2)
- Damage types and resistances
- Status effects (stun, slow, etc.)

## Next Steps

To extend the engine for full Diablo 2-style gameplay:

1. **Projectile System** - Flying projectiles with collision
2. **Abilities** - Special attacks with cooldowns and mana cost
3. **Item System** - Equipment that modifies stats
4. **Loot Drops** - Items spawn when enemies die
5. **PvE Enemies** - AI-controlled monsters
6. **Dungeon Generation** - Procedural level generation
7. **Experience/Leveling** - Character progression
8. **Classes** - Different character types with unique abilities

## Performance Notes

- Current collision detection is O(n²) - fine for <16 players
- For larger player counts, implement spatial partitioning (quadtree/grid)
- Physics loop is single-threaded - suitable for dedicated game servers
- Network snapshots are lightweight (position, velocity, state per character)

## License

Part of the ft_transcendence project.
