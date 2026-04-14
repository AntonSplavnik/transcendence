# Game Architecture Overview

High-level map of every game subsystem and how they connect.

## Three-Tier Runtime

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend  (TypeScript / Babylon.js)                        │
│  Rendering, input capture, animation, audio, HUD            │
└────────────────────────┬────────────────────────────────────┘
                         │  WebTransport (CBOR + Zstd)
                         │  bidi stream per player
┌────────────────────────┴────────────────────────────────────┐
│  Backend  (Rust / Salvo / Tokio)                            │
│  Lobby state machine, stream multiplexing, DB, auth         │
└────────────────────────┬────────────────────────────────────┘
                         │  CXX FFI (zero-copy shared types)
┌────────────────────────┴────────────────────────────────────┐
│  Game Engine  (C++ / EnTT ECS)                              │
│  Physics, collision, combat, game modes, snapshots          │
└─────────────────────────────────────────────────────────────┘
```

**Rust** owns networking, auth, persistence, and the game loop thread.
**C++** owns the simulation — physics, collision, combat, scoring.
**TypeScript** owns presentation — 3D rendering, animation, audio, UI.

The server is **authoritative**: clients send input, the server simulates, clients render the result.

---

## Match Lifecycle

```
1. Create Lobby       POST /game/lobby              → Lobby struct created
2. Players Join       POST /game/lobby/{id}/join     → uni stream opened per member
3. Ready Up           PATCH /game/lobby/{id}/player/ready
4. Countdown          3s (all ready) / 10s (full) / 60s (default)
5. Game Start         GameManager::start_game_async()
   ├─ open bidi Game streams for each player & spectator
   ├─ on_connect() → C++ engine spawns entities
   └─ dedicated thread runs game loop at 60 Hz
6. Gameplay           server ticks → snapshot + events broadcast → clients render
7. Match End          C++ emits MatchEnd → stats persisted → achievements checked
8. Cleanup            lobby resets for rematch; 30s idle → destroyed
```

---

## Data Flow Per Tick (16.67 ms)

```
Client                          Server                          C++ Engine
──────                          ──────                          ──────────
capture input (WASD/keys)
  │
  ├─► send GameClientMessage::Input ──► receive loop ──► set_player_input()
  │                                                         │
  │                                                    update() runs:
  │                                                      earlyUpdate (input)
  │                                                      fixedUpdate (physics)
  │                                                      update     (combat)
  │                                                      lateUpdate (post)
  │                                                         │
  │                              ◄── get_snapshot()  ◄──────┘
  │                              ◄── drain_events()
  │                                     │
  ◄── GameServerMessage::Snapshot ──────┤
  ◄── GameServerMessage::Death/Damage/… ┘
  │
processEvents()  → trigger one-shot animations
processSnapshot() → update positions, health, HUD
scene.render()
```

---

## Key Subsystems

### 1. Lobby (Rust)

State machine managing pre-game flow. Tracks players, ready state, countdown, settings. Broadcasts `LobbyServerMessage` deltas over a uni stream per member.

**Key file:** `backend/src/game/lobby.rs`

### 2. Game Manager (Rust)

Orchestrates lobby CRUD, stream setup, game start/stop, and post-match stats persistence. Holds `IndexMap<Ulid, Arc<Mutex<Lobby>>>`.

**Key file:** `backend/src/game/manager.rs`

### 3. Game Loop (Rust thread)

Runs on a dedicated `std::thread` at 60 Hz. Each tick:
1. Calls `handle.update()` (FFI into C++)
2. Fetches snapshot + drains network events
3. Broadcasts via `StreamGroup`

**Key file:** `backend/src/game/game.rs`

### 4. ECS Engine (C++ / EnTT)

Entity-Component-System simulation. EnTT registry holds entities composed of data-only components. Six systems execute in a four-phase loop.

| System | Phase | Purpose |
|--------|-------|---------|
| CharacterControllerSystem | earlyUpdate | input → movement |
| PhysicsSystem | fixedUpdate | gravity, friction, velocity integration |
| CollisionSystem | fixedUpdate | cylinder-cylinder O(n²) detection |
| CombatSystem | update | attack chains, skills, damage |
| GameModeSystem | update | win conditions, spawning |
| StaminaSystem | update | regen / depletion |

**Key files:** `game-core/src/ArenaGame.hpp`, `game-core/src/core/World.hpp`

### 5. FFI Bridge (CXX)

Type-safe Rust ↔ C++ interop via the `cxx` crate. Shared types (`Vec3`, `PlayerInput`, `CharacterSnapshot`) are layout-compatible for zero-copy conversion.

**Key files:** `backend/src/game/ffi.rs`, `game-core/src/cxx_bridge.hpp`

### 6. Stream Layer (Rust + TS)

WebTransport over QUIC. CBOR serialization with Zstd compression (threshold: 1 KiB server, 512 B client). Server opens all streams; client reads the `StreamType` header and dispatches to handlers.

**Key files:** `backend/src/stream/`, `frontend/src/stream/ConnectionManager.ts`

### 7. Frontend Game Client (TypeScript / Babylon.js)

Orthographic isometric 3D scene. `CharacterManager` manages `AnimatedCharacter` entities. Dual-track animation: events trigger one-shot anims (attacks, skills), snapshots drive steady-state (walk, idle). Direct position strategy (no client-side prediction yet).

**Key files:** `frontend/src/game/GameClient.ts`, `frontend/src/game/CharacterManager.ts`

### 8. Audio (TypeScript / Babylon AudioEngineV2)

Decoupled event-to-sound system. Four trigger tables map game events to sound IDs. Supports class-specific sounds (e.g., knight vs rogue footsteps).

**Key files:** `frontend/src/audio/AudioEventSystem.ts`, `frontend/src/audio/triggerTables.ts`

---

## Game Modes

```cpp
enum class GameModeType : uint8_t {
    Deathmatch      = 0,  // Time-limited free-for-all
    LastStanding    = 1,  // Last player alive wins
    WaveSurvival    = 2,  // Co-op vs AI waves
    TeamDeathmatch  = 3,  // Team score limit
};
```

Mode-specific logic lives in `GameModeSystem`. Win conditions, respawning, and scoring vary per mode.

---

## Character Classes

Six playable characters share a common `CharacterConfig` schema:

| Class | Archetype | Weapon | Trail Color |
|-------|-----------|--------|-------------|
| Knight | Warrior | Sword + Shield | Blue |
| Rogue | Rogue | Dagger | Purple |
| Barbarian | Warrior | Two-handed Axe | — |
| Ranger | Ranger | Bow | — |
| Mage | Mage | Staff | — |
| RogueHooded | Rogue | Dagger (alt skin) | — |

Each config defines: model path, animation sets, equipment slots, stats, attack combos, and skill definitions.

**Key file:** `frontend/src/game/characterConfigs.ts`

---

## Serialization & Wire Format

All game messages use the same frame format as the rest of the streaming layer:

```
[4 bytes: length (BE u32)] [1 byte: flags] [payload]
```

- `flags = 0x00` → raw CBOR
- `flags = 0x01` → Zstd-compressed CBOR
- Serde: externally-tagged enums (`#[serde(tag = "type")]`)

See `docs/wire-protocol.md` for the full specification.

---

## Directory Map

```
backend/src/game/
├── manager.rs          Game manager (lobby CRUD, start/stop)
├── game.rs             Game loop (60 Hz tick thread)
├── lobby.rs            Lobby state machine
├── lobby_messages.rs   LobbyServerMessage enum
├── messages.rs         GameServerMessage / GameClientMessage
├── ffi.rs              CXX bridge types & bindings
└── router.rs           REST endpoints (/game/*)

game-core/src/
├── ArenaGame.hpp       Top-level engine facade
├── core/World.hpp      ECS registry + entity factory
├── components/         25+ data-only component structs
├── systems/            6 system implementations
├── cxx_bridge.hpp/cpp  C++ side of FFI
├── GameMode.hpp        Game mode enum & data
└── Skills.hpp          Skill definitions

frontend/src/game/
├── GameClient.ts       Top-level coordinator
├── CharacterManager.ts Entity manager (local + remote)
├── AnimatedCharacter.ts Entity (model, animations, trail)
├── SnapshotProcessor.ts Server snapshot → visual state
├── EventProcessor.ts   Server events → one-shot animations
├── AnimationStateMachine.ts  State: Idle/Attack/Skill/Death
├── HUD.ts              Health, stamina, cooldown bars
├── SwingTrail.ts       Weapon swing ribbon effect
├── characterConfigs.ts Character definitions
├── constants.ts        Camera, input, animation constants
└── types.ts            TS types mirroring Rust messages

frontend/src/stream/
├── ConnectionManager.ts  WebTransport lifecycle
├── CompressedCborCodec.ts  CBOR + Zstd codec
└── types.ts              Stream/message type definitions

frontend/src/contexts/
├── GameContext.tsx      Game stream handler + state
└── LobbyContext.tsx     Lobby stream handler + state

frontend/src/audio/
├── AudioEngine.ts      Babylon audio bus setup
├── AudioEventSystem.ts Event → sound dispatch
├── SoundBank.ts        Asset registry
└── triggerTables.ts    Trigger definitions
```
