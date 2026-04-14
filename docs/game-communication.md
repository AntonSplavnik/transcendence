# Game Communication Protocol

How the frontend and backend exchange game data in real time. Builds on the general streaming architecture (`docs/streaming-architecture.md`) and wire protocol (`docs/wire-protocol.md`).

---

## Transport

- **Protocol:** WebTransport (HTTP/3 over QUIC)
- **Serialization:** CBOR with optional Zstd compression
- **Frame format:** `[4B length][1B flags][payload]` (see `docs/wire-protocol.md`)
- **Compression threshold:** 1024 bytes (server), 512 bytes (client)
- **Stream ownership:** server opens all streams; client reads headers and dispatches

---

## Stream Types Used in Game

| StreamType | Direction | Purpose |
|------------|-----------|---------|
| `Lobby(Ulid)` | uni: server → client | Lobby state deltas |
| `Game` | bidi: server ↔ client | Player input + game state |
| `Notifications` | uni: server → client | Achievements after match |

---

## Lobby Stream

Opened when a user joins a lobby. Server sends delta events as the lobby changes.

### Messages (LobbyServerMessage)

```rust
enum LobbyServerMessage {
    LobbySnapshot(LobbyInfo),                // first message: full state
    PlayerJoined { user_id, nickname },
    PlayerLeft { user_id },
    SpectatorJoined { user_id, nickname },
    SpectatorLeft { user_id },
    ReadyChanged { user_id, ready },
    CountdownUpdate { start_timestamp },      // ISO-8601 UTC
    CountdownCancelled,
    GameStarting,
    GameEnded,
    SettingsChanged(LobbySettings),
    LobbyClosed { reason },
}
```

### LobbyInfo Snapshot

```typescript
interface LobbyInfo {
    id: string;                   // ULID
    host_id: number;
    settings: LobbySettings;
    player_count: number;
    spectator_count: number;
    players: LobbyPlayerInfo[];
    game_active: boolean;
    countdown_start_at: string | null;  // ISO-8601
}
```

### Frontend Handling

`LobbyContext.tsx` registers a handler with `ConnectionManager`. On each message:
- `LobbySnapshot` → initialize full lobby state
- Delta events → patch React state (triggers UI updates)
- `GameStarting` → transition to game view
- `GameEnded` → show results, return to lobby

---

## Game Stream

Opened per player (and spectator) when the match starts. Bidirectional: server sends state, client sends input.

### Server → Client (GameServerMessage)

```rust
#[serde(tag = "type")]
enum GameServerMessage {
    // 60 Hz continuous state
    Snapshot(GameStateSnapshot),

    // Discrete events
    PlayerJoined { player_id: u32, name: String, character_class: CharacterClass },
    PlayerLeft { player_id: u32 },
    Death { killer: u32, victim: u32 },
    Damage { attacker: u32, victim: u32, damage: f32 },
    Spawn { player_id: u32, position: Vector3D, name: String, character_class: CharacterClass },
    StateChange { player_id: u32, state: u8 },
    AttackStarted { player_id: u32, chain_stage: u8 },
    SkillUsed { player_id: u32, skill_slot: u8 },
    MatchEnd { players: Vec<PlayerMatchStatsPayload> },
    Error { message: String },
}
```

### Client → Server (GameClientMessage)

```rust
#[serde(tag = "type")]
enum GameClientMessage {
    Input {
        movement: Vector3D,
        look_direction: Vector3D,
        attacking: bool,
        jumping: bool,
        ability1: bool,
        ability2: bool,
        dodging: bool,
        sprinting: bool,
    },
    Leave,
}
```

### GameStateSnapshot

Sent at 60 Hz. Contains the full state of every character in the match.

```typescript
interface GameStateSnapshot {
    frame_number: number;
    timestamp: number;
    characters: CharacterSnapshot[];
}

interface CharacterSnapshot {
    player_id: number;
    position: Vector3D;       // { x, y, z }
    velocity: Vector3D;
    yaw: number;              // rotation around Y axis
    state: number;            // CharacterState enum
    health: number;
    max_health: number;
    stamina: number;
    max_stamina: number;
    ability1_timer: number;   // remaining cooldown
    ability1_cooldown: number; // total cooldown duration
    ability2_timer: number;
    ability2_cooldown: number;
    swing_progress: number;   // 0–1, drives weapon trail visual
    is_grounded: boolean;
}
```

### PlayerMatchStats (in MatchEnd)

```typescript
interface PlayerMatchStats {
    player_id: number;
    name: string;
    character_class: string;
    kills: number;
    deaths: number;
    damage_dealt: number;
    damage_taken: number;
    placement: number;
}
```

---

## Message Flow: Full Match Lifecycle

### Phase 1 — Lobby

```
Client                              Server
──────                              ──────
POST /game/lobby          ──────►   create_lobby()
                          ◄──────   { id: "01J..." }

POST /game/lobby/{id}/join ─────►   join_lobby()
                          ◄──────   uni stream opened
                          ◄──────   LobbySnapshot (first message)

                          ◄──────   PlayerJoined (other users join)

PATCH .../player/ready    ──────►   set_ready()
                          ◄──────   ReadyChanged { user_id, ready: true }
                          ◄──────   CountdownUpdate { start_timestamp }
```

### Phase 2 — Countdown & Start

```
Client                              Server
──────                              ──────
                                    countdown reaches zero
                          ◄──────   GameStarting (lobby stream)

                                    start_game_async():
                                      open bidi Game stream per player
                                      connect players to C++ engine
                                      spawn game loop thread

                          ◄──────   Spawn { player_id, position, name, class }
                          ◄──────   Spawn { ... } (for each player)
```

### Phase 3 — Gameplay (60 Hz loop)

```
Client                              Server                          C++ Engine
──────                              ──────                          ──────────

Input { movement, attacking, ... }
    ──────────────────────────────►  receive loop
                                    on_client_msg()  ──────────────► set_player_input()
                                                                        │
                                                                    update()
                                                                      earlyUpdate (input)
                                                                      fixedUpdate (physics)
                                                                      update     (combat)
                                                                      lateUpdate (post)
                                                                        │
                                    get_snapshot() ◄────────────────────┘
                                    drain_events() ◄────────────────────┘
                                        │
◄── Damage { attacker, victim, dmg } ──┤
◄── Death { killer, victim }  ──────────┤
◄── AttackStarted { id, chain_stage } ──┤
◄── Snapshot { frame, characters[] } ───┘

processEvents()  → trigger animations
processSnapshot() → update positions
scene.render()
```

### Phase 4 — Match End

```
Client                              Server
──────                              ──────
                                    C++ emits MatchEndEvent
◄── MatchEnd { players: [...] }     broadcast to all
                                    record_match_end_stats() → DB
                                    check_achievements()
                          ◄──────   GameEnded (lobby stream)
                                    clear_game()
                                    start 30s cleanup timer

show results UI
navigate to lobby or home
```

### Phase 5 — Leave

```
Client                              Server
──────                              ──────
Leave  ────────────────────────────► receive loop returns false
                                    leave_lobby()
                          ◄──────   PlayerLeft (lobby stream)
                                    if empty: schedule destroy in 30s
```

---

## Frontend Data Flow

Game data deliberately avoids React state to prevent 60 re-renders per second:

```
ConnectionManager
  └── Game stream handler
        ├── Snapshot → snapshotRef.current = snapshot    (React ref)
        └── Event → eventsRef.current.push(event)       (React ref)

Babylon render loop (onBeforeRenderObservable, ~60 FPS):
  1. events = eventsRef.current.splice(0)    drain queue
  2. snapshot = snapshotRef.current           read latest
  3. EventProcessor.processEvents(events)    one-shot animations
  4. SnapshotProcessor.processSnapshot(snap) positions, HUD
  5. sendInput(inputState)                   send via bidi stream
  6. scene.render()
```

### Why Refs Not State

React re-renders on state change. At 60 Hz, state-driven updates would cause:
- 60 React reconciliation passes per second
- Unnecessary DOM diffing for the React overlay
- Potential frame drops in the Babylon render loop

Using refs, the Babylon loop reads data directly — React only re-renders for UI events (match end, player join/leave).

---

## Reconnection & Disconnection

### Automatic Reconnect

```
BASE_RETRY_MS = 1000
MAX_RETRY_MS  = 40000
delay = min(1000 * 2^attempt, 40000) + random(0, 500)
```

Unlimited retries with exponential backoff. Stops only on intentional disconnect or displacement.

### Displacement

When a user connects from another tab/device:
1. Server sends `CtrlMessage::Displaced` on the old connection's control stream
2. Old `ConnectionManager` sets state to `'displaced'` and stops reconnecting
3. UI shows "session replaced" message

### Stream Closure

- **Lobby stream closes:** cleanup task removes user from lobby after delay
- **Game stream closes:** game state transitions to idle
- **Connection drops:** `ConnectionManager` triggers reconnect; streams re-established on reconnect via `on_connect()` hooks

### Session Expiry

Each connection has an expiry based on the JWT access token. An auto-disconnect task fires at `session.access_expiry()`. Calling `StreamManager::refresh_auth()` reschedules it.

---

## Spectator Stream

Spectators receive the same `GameServerMessage` broadcast as players. Their bidi stream ignores any received input (receive loop returns `true` but discards the message). Spectators:
- See all `Snapshot`, `Death`, `Damage`, `AttackStarted`, `SkillUsed` events
- Cannot send `Input` messages that affect the game
- Use WASD to pan camera locally (no server interaction)

---

## Key Files

| Layer | File | Purpose |
|-------|------|---------|
| Backend messages | `backend/src/game/messages.rs` | `GameServerMessage` / `GameClientMessage` |
| Backend lobby messages | `backend/src/game/lobby_messages.rs` | `LobbyServerMessage` |
| Backend stream group | `backend/src/stream/stream_group.rs` | `StreamGroup<S>` broadcast |
| Backend stream manager | `backend/src/stream/stream_manager.rs` | Connection lifecycle |
| Backend codec | `backend/src/stream/compress_cbor_codec.rs` | CBOR + Zstd |
| Frontend types | `frontend/src/game/types.ts` | TS mirrors of Rust types |
| Frontend stream types | `frontend/src/stream/types.ts` | Stream/lobby message types |
| Frontend codec | `frontend/src/stream/CompressedCborCodec.ts` | CBOR + Zstd |
| Frontend connection | `frontend/src/stream/ConnectionManager.ts` | WebTransport lifecycle |
| Frontend game context | `frontend/src/contexts/GameContext.tsx` | Stream handler + refs |
| Frontend lobby context | `frontend/src/contexts/LobbyContext.tsx` | Lobby stream handler |
