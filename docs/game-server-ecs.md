# Game Server & ECS Engine

The game server is a hybrid Rust + C++ system. Rust handles networking, lobby management, persistence, and the game loop thread. C++ handles the real-time simulation using an ECS architecture built on EnTT.

---

## Rust Layer

### Game Manager

Central coordinator. Holds all lobbies and maps users to their current lobby.

```rust
// backend/src/game/manager.rs
struct GameManagerState {
    lobbies: IndexMap<Ulid, Arc<Mutex<Lobby>>>,
    user_lobby: IndexMap<i32, Ulid>,
}
```

Responsibilities:
- Lobby CRUD (create, join, leave, destroy)
- Stream setup (lobby uni-streams, game bidi-streams)
- Game start orchestration (4-phase async process)
- Post-match stat persistence and achievement checks

### Lobby State Machine

Each lobby tracks players, spectators, ready state, countdown, and the active game instance.

```rust
// backend/src/game/lobby.rs
pub struct Lobby {
    players: IndexMap<i32, PlayerState>,      // user_id → state
    spectators: IndexSet<i32>,
    game: Option<Arc<Game>>,
    game_active: bool,
    countdown: CountdownState,                // Idle | Running | Finished
    lobby_streams: Arc<StreamGroup<LobbyServerMessage>>,
    game_streams: Arc<StreamGroup<GameServerMessage>>,
}
```

**Countdown rules:**
- All players ready → 3 seconds
- Lobby full → 10 seconds
- At least one player ready → 60 seconds
- Players unready during countdown → cancellation evaluated

### Game Start (4-phase)

`GameManager::start_game_async()` runs in phases to avoid holding the lobby lock during async stream setup:

1. **Sync (under lock):** validate player count, mark `game_active`, broadcast `GameStarting`, collect membership snapshot
2. **Async (no lock):** open bidi `StreamType::Game` for each player with a receive loop that feeds input to the engine
3. **Async (no lock):** open bidi streams for spectators (input ignored)
4. **Thread spawn:** dedicated `std::thread` runs `Game::update_loop()` at 60 Hz

### Game Loop (Rust side)

```rust
// backend/src/game/game.rs
pub fn update_loop(&self, broadcast, _send) {
    const TICK_DURATION: Duration = Duration::from_micros(1_000_000 / 60);

    loop {
        let tick_start = Instant::now();

        handle.update();                           // FFI → C++ engine
        let snapshot = handle.get_snapshot();       // read world state
        let events = handle.drain_network_events(); // consume event queue

        for event in events {
            broadcast(convert_to_server_message(event));
        }
        broadcast(GameServerMessage::Snapshot(snapshot));

        if let Some(remaining) = TICK_DURATION.checked_sub(tick_start.elapsed()) {
            sleep(remaining);
        }
    }
}
```

Each tick: update engine → read snapshot → drain events → broadcast everything → sleep to maintain 60 Hz.

### Post-Match

When `MatchEnd` is emitted:
1. `record_match_end_stats()` persists per-player stats to the database
2. `check_achievements()` evaluates achievement conditions
3. Achievement notifications sent via the notification stream
4. `lobby.clear_game()` resets state for potential rematch
5. 30-second cleanup timer starts; lobby destroyed if empty

---

## FFI Bridge (CXX)

Type-safe Rust ↔ C++ interop via the `cxx` crate. Layout-compatible shared types enable zero-copy conversion.

```rust
// backend/src/game/ffi.rs
#[cxx::bridge(namespace = "arena_game")]
mod bridge {
    extern "C++" {
        type GameBridge;

        fn create_bridge() -> UniquePtr<GameBridge>;
        fn start(self: Pin<&mut GameBridge>, mode: GameModeType);
        fn update(self: Pin<&mut GameBridge>);
        fn is_running(self: &GameBridge) -> bool;

        fn add_player(self: Pin<&mut GameBridge>, id: u32, name: &str, class: &str) -> bool;
        fn remove_player(self: Pin<&mut GameBridge>, id: u32);
        fn set_player_input(self: Pin<&mut GameBridge>, id: u32, input: &PlayerInput);

        fn get_snapshot(self: &GameBridge) -> GameStateSnapshot;
        fn take_events(self: Pin<&mut GameBridge>) -> UniquePtr<EventQueue>;
    }
}
```

**Shared types** (zero-copy between Rust and C++):
- `Vec3` ↔ `Vector3D` — position, velocity
- `PlayerInput` — movement, look direction, action booleans
- `CharacterSnapshot` — full per-character state
- `GameStateSnapshot` — frame number + array of character snapshots
- `NetworkEvent` — variant-dispatched event queue

**Key files:** `backend/src/game/ffi.rs` (509 lines), `game-core/src/cxx_bridge.hpp`, `game-core/src/cxx_bridge.cpp`

---

## C++ ECS Engine

### Architecture

```
ArenaGame (facade)
└── World (ECS registry + entity factory)
    ├── entt::registry        component storage
    ├── EntityFactory          entity creation templates
    ├── SystemManager          ordered system execution
    └── playerToEntity map     PlayerID → entt::entity
```

### Components (data only)

All components are plain structs with no logic. Located in `game-core/src/components/`.

| Component | Fields | Purpose |
|-----------|--------|---------|
| Transform | position, rotation, scale | Spatial placement |
| PhysicsBody | velocity, acceleration, mass, friction, gravity | Movement forces |
| Collider | shape (cylinder), radius, height, layers | Collision geometry |
| Health | current, max, armor, resistance | Damage tracking |
| Stamina | current, max, regen rate | Energy pool |
| CharacterController | input state, move speed, jump velocity | Player control |
| CombatController | damage, cooldown, combo chain, skills | Attack system |
| PlayerInfo | player ID, name, character class | Identity |
| MatchStatsComponent | kills, deaths, damage dealt/taken, placement | Scoring |
| NetworkEventsComponent | event queue | Outbound network events |
| GameModeComponent | mode type, mode-specific data | Match rules |

### Systems (logic only)

Systems operate on component queries each tick. Located in `game-core/src/systems/`.

```cpp
class System {
    virtual void earlyUpdate(float dt);   // Phase 1: input
    virtual void fixedUpdate(float dt);   // Phase 2: physics
    virtual void update(float dt);        // Phase 3: game logic
    virtual void lateUpdate(float dt);    // Phase 4: post-processing
};
```

#### CharacterControllerSystem — earlyUpdate

Reads `CharacterController` input state, computes movement direction and yaw rotation. Applies to `PhysicsBody` velocity and `Transform` rotation.

#### PhysicsSystem — fixedUpdate

Arcade physics simulation:
- Gravity: `velocity.y += gravity * dt` (only when airborne)
- Friction: `velocity.xz *= friction` (horizontal damping)
- Integration: `position += velocity * dt` (Euler)
- Ground collision: clamp `position.y` to ground plane
- Arena bounds: clamp position to `[-25, 25]` on X and Z

```cpp
struct PhysicsSystem::Config {
    float gravity = -20.0f;
    float friction = 0.85f;
    float minVelocity = 0.1f;
    float groundY = 0.0f;
    float arenaMinX = -25, arenaMaxX = 25;
    float arenaMinZ = -25, arenaMaxZ = 25;
};
```

#### CollisionSystem — fixedUpdate

O(n²) cylinder-cylinder detection. When two colliders overlap, separates them along the penetration vector. No broad-phase optimization (player counts are small).

#### CombatSystem — update

Manages attack chains (3-stage combos), skill execution, damage application, and knockback. Emits `NetworkEvent` variants: `DeathEvent`, `DamageEvent`, `AttackStartedEvent`, `SkillUsedEvent`.

Skills are defined as `SkillDefinition` structs with type, cast time, cooldown, range, and damage. Dispatched via `std::variant` in `CombatSystem::executeSkill()`.

#### GameModeSystem — update

Mode-specific logic:
- **Deathmatch:** time-limited FFA, track kills
- **LastStanding:** eliminate all but one player
- **WaveSurvival:** PvE wave spawning
- **TeamDeathmatch:** team score limit

Emits `MatchEndEvent` when win condition is met.

#### StaminaSystem — update

Regenerates stamina over time. Deducts stamina for sprinting, dodging, and abilities. Blocks actions when stamina is insufficient.

### Update Loop (C++ side)

```cpp
// game-core/src/ArenaGame.hpp
void ArenaGame::update() {
    float deltaTime = elapsed_since_last_call;
    m_accumulator += deltaTime;

    // Fixed timestep for deterministic physics
    while (m_accumulator >= FIXED_TICK_TIME) {   // 1/60 s
        m_world.fixedUpdate(FIXED_TICK_TIME);
        m_accumulator -= FIXED_TICK_TIME;
    }

    // Variable timestep for responsive logic
    m_world.earlyUpdate(deltaTime);
    m_world.update(deltaTime);
    m_world.lateUpdate(deltaTime);

    m_frameNumber++;
}
```

The accumulator pattern ensures physics runs at a fixed 60 Hz regardless of actual tick timing, while input and game logic run at the real delta.

### Entity Creation

```cpp
// World creates entities by composing components
entt::entity player = m_registry.create();
m_registry.emplace<Transform>(player, spawnPos);
m_registry.emplace<PhysicsBody>(player, ...);
m_registry.emplace<Collider>(player, cylinderShape);
m_registry.emplace<Health>(player, maxHp);
m_registry.emplace<Stamina>(player, maxStamina);
m_registry.emplace<CharacterController>(player, ...);
m_registry.emplace<CombatController>(player, ...);
m_registry.emplace<PlayerInfo>(player, id, name, charClass);
m_registry.emplace<MatchStatsComponent>(player);
m_registry.emplace<NetworkEventsComponent>(player);
```

### Network Event Pipeline

Systems push events into `NetworkEventsComponent` attached to entities. After `update()`, the engine collects all events into an `EventQueue` that Rust drains via `take_events()`.

```
CombatSystem detects kill
  → push DeathEvent into victim's NetworkEventsComponent
  → push DamageEvent into attacker's NetworkEventsComponent

Rust calls take_events()
  → iterate all NetworkEventsComponent, collect into EventQueue
  → clear all component queues
  → return EventQueue to Rust

Rust converts each event → GameServerMessage variant
  → broadcast to all players & spectators
```

---

## Game Modes

```cpp
enum class GameModeType : uint8_t {
    Deathmatch      = 0,
    LastStanding    = 1,
    WaveSurvival    = 2,
    TeamDeathmatch  = 3,
};
```

To add a new mode:
1. Add enum value in `GameMode.hpp`
2. Add mode-specific logic branch in `GameModeSystem`
3. Map the string name in the FFI bridge
4. Add lobby settings support in `LobbySettings`

---

## Directory Structure

```
backend/src/game/
├── manager.rs          GameManager — lobby CRUD, game orchestration
├── game.rs             Game — 60 Hz loop thread
├── lobby.rs            Lobby — state machine, countdown, membership
├── lobby_messages.rs   LobbyServerMessage enum
├── messages.rs         GameServerMessage / GameClientMessage enums
├── ffi.rs              CXX bridge definitions (509 lines)
└── router.rs           REST endpoints for /game/*

game-core/src/
├── ArenaGame.hpp       Engine facade (start, update, snapshot)
├── core/
│   └── World.hpp       ECS registry, entity factory, system manager
├── components/         25+ data-only structs
│   ├── Transform.hpp
│   ├── PhysicsBody.hpp
│   ├── Collider.hpp
│   ├── Health.hpp
│   ├── Stamina.hpp
│   ├── CharacterController.hpp
│   ├── CombatController.hpp
│   ├── PlayerInfo.hpp
│   ├── MatchStatsComponent.hpp
│   ├── NetworkEventsComponent.hpp
│   └── GameModeComponent.hpp
├── systems/
│   ├── System.hpp              Base class
│   ├── SystemManager.hpp       Ordered execution
│   ├── CharacterControllerSystem.hpp
│   ├── PhysicsSystem.hpp
│   ├── CollisionSystem.hpp
│   ├── CombatSystem.hpp
│   ├── GameModeSystem.hpp
│   └── StaminaSystem.hpp
├── cxx_bridge.hpp/cpp  C++ side of FFI
├── GameMode.hpp        Mode enum
└── Skills.hpp          Skill definitions
```
