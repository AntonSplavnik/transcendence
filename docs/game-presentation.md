# Game Presentation Guide

A tight walkthrough of the game system for a live evaluation. Read top-to-bottom, each section is a short talking block. The **→ Deep dive** pointers tell you which companion doc has the full detail if evaluators go deep.

- Overview & lifecycle → `game-architecture-overview.md`
- Server + ECS internals → `game-server-ecs.md`
- Network protocol → `game-communication.md`
- Frontend internals → `game-frontend.md`

---

## 1. What the game is (30 seconds)

A real-time multiplayer isometric 3D arena brawler. Up to 6 character classes (Knight, Rogue, Barbarian, Ranger, Mage, RogueHooded), four game modes (Deathmatch, Last Standing, Wave Survival, Team Deathmatch). Players move, attack in combo chains, use two skills per class, and fight until the win condition is met.

**What makes it interesting technically:** it's a three-language system — Rust, C++, TypeScript — each language doing what it's best at, with authoritative server simulation.

---

## 2. The three-tier architecture (1 minute)

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend   — TypeScript + Babylon.js                       │
│  Renders the world, captures input, plays animations/audio  │
└─────────────────────────┬───────────────────────────────────┘
                          │  WebTransport (CBOR + Zstd)
┌─────────────────────────┴───────────────────────────────────┐
│  Backend    — Rust (Salvo + Tokio)                          │
│  Lobbies, networking, auth, persistence, 60 Hz game thread  │
└─────────────────────────┬───────────────────────────────────┘
                          │  CXX FFI (zero-copy shared types)
┌─────────────────────────┴───────────────────────────────────┐
│  Game Engine — C++ (EnTT ECS)                               │
│  Physics, collision, combat, scoring — the simulation        │
└─────────────────────────────────────────────────────────────┘
```

**Point to make:** the server is **authoritative**. The client never simulates. It sends input, the server simulates, the client renders. This is the standard design for cheat-resistant multiplayer.

**Why Rust ↔ C++ together?** Rust is excellent at safe async networking but has no mature ECS the size of EnTT. C++ is fast at simulation but verbose at networking. We let each language do what it's good at and bridge with CXX (zero-copy, type-safe FFI).

**→ Deep dive:** `game-architecture-overview.md` §Three-Tier Runtime

---

## 3. Match lifecycle (1 minute)

```
1. Lobby created       POST /game/lobby
2. Players join        uni stream opened (lobby state deltas)
3. Everyone readies    countdown starts (3s / 10s / 60s depending on conditions)
4. Game starts         bidi stream opened per player + spectator
                       C++ engine spawns entities for each player
                       dedicated Rust thread runs game loop at 60 Hz
5. Gameplay            client sends input → server simulates → server
                       broadcasts snapshot + events → client renders
6. Match end           C++ emits MatchEnd → stats saved → achievements checked
7. Cleanup             lobby resets for rematch; destroyed after 30s idle
```

**→ Deep dive:** `game-architecture-overview.md` §Match Lifecycle, `game-communication.md` §Message Flow.

---

## 4. One tick — the full pipeline (1 minute)

Every 16.67 ms the whole system runs one round-trip:

```
Client                     Rust server                  C++ engine
──────                     ───────────                  ──────────
capture WASD, skills
   │
   └─► Input ────────────► receive loop
                           set_player_input(id, input)
                                       │
                           handle.update() ─────────► earlyUpdate (input)
                                                     fixedUpdate (physics/collision)
                                                     update     (combat, stamina, game mode)
                                                     lateUpdate (post)
                                       │
                           get_snapshot()     ◄───── world state
                           drain_events()     ◄───── queued events
                                       │
   ◄── Snapshot (60 Hz) ───┤
   ◄── Damage/Death/... ───┘
   │
   EventProcessor → one-shot animations (attack swing, death)
   SnapshotProcessor → positions, health bars, fallback anims (walk, idle)
   scene.render()
```

**The trick:** two parallel streams from server — continuous **snapshot** (60 Hz state dump) + discrete **events** (things that just happened). The client treats them differently on render.

**→ Deep dive:** `game-architecture-overview.md` §Data Flow Per Tick.

---

## 5. Server side — Why ECS? (1 minute)

**The problem with OOP for games:** if you write `class Player extends Character extends Entity`, and then you want an NPC that has physics but no health, or a projectile that has collision but no stamina — inheritance trees get messy fast. Every new feature touches five classes.

**ECS inverts the model:**

- **Entity** = just an ID. An empty tag. `entt::entity` is literally a 32-bit integer.
- **Component** = plain data. `struct Health { float current; float max; };`
- **System** = pure logic that queries for entities with specific components and runs over them.

To make a player: you take an empty entity ID, attach a `Transform`, `PhysicsBody`, `Collider`, `Health`, `Stamina`, `CharacterController`, `CombatController`. To make a wall: give it only `Transform` + `Collider`. Same registry, same systems — the `PhysicsSystem` just iterates whatever has `PhysicsBody`, and ignores everything else.

**Result:** features compose. Adding a new entity type is "pick components", not "design class hierarchy". Adding a new behavior is "add a system".

We use **EnTT** — a battle-tested header-only ECS library used in production games (Minecraft, Starbreeze titles).

**→ Deep dive:** `game-server-ecs.md` §Architecture, §Components, §Systems.

---

## 6. Components (quick table)

All live in `game-core/src/components/`. They are plain structs — zero methods.

| Component | What it holds | Which entities get it |
|-----------|---------------|----------------------|
| `Transform` | position, rotation, scale | everything in the world |
| `PhysicsBody` | velocity, mass, friction, gravity | anything that moves |
| `Collider` | cylinder shape, radius, height | anything that blocks / hits |
| `Health` | current, max, armor | players, destructibles |
| `Stamina` | current, max, regen rate | players |
| `CharacterController` | input state, move speed, jump | players |
| `CombatController` | damage, cooldowns, combo stage, skills | players |
| `PlayerInfo` | player id, name, class | players |
| `MatchStatsComponent` | kills, deaths, damage | players |
| `NetworkEventsComponent` | queue of events to send to the client | players |
| `GameModeComponent` | mode type, mode state | one per match |

**Key point:** no component has logic. If you see `void Health::takeDamage(...)` — that's *not* ECS. Logic lives in systems.

---

## 7. Systems & the 4-phase loop (1–2 minutes)

Each tick runs four phases, in order:

```
earlyUpdate   → read input, set intent
fixedUpdate   → physics & collision (deterministic, fixed timestep)
update        → game logic (combat, stamina, game mode, scoring)
lateUpdate    → post-processing / cleanup
```

Six systems fill these phases:

| System | Phase | One-line purpose |
|--------|-------|------------------|
| `CharacterControllerSystem` | earlyUpdate | Input → movement direction & yaw |
| `PhysicsSystem` | fixedUpdate | Gravity, friction, velocity integration, arena bounds |
| `CollisionSystem` | fixedUpdate | O(n²) cylinder-vs-cylinder, resolves penetration |
| `CombatSystem` | update | Attack combos, skills, damage, knockback, emits events |
| `StaminaSystem` | update | Regen, deducts stamina for sprint/skills |
| `GameModeSystem` | update | Win conditions, respawning, match end |

**The fixed-timestep trick** (say this if they ask about determinism): `ArenaGame::update()` uses an accumulator — it runs `fixedUpdate` exactly every 1/60 s regardless of how long the real tick took, so physics is deterministic. `update` runs with the real delta, so game logic stays responsive.

**→ Deep dive:** `game-server-ecs.md` §Systems, §Update Loop.

---

## 8. One system in detail — `CombatSystem` (if you have time)

Worth zooming in on one system. `CombatSystem` is the richest.

- **Attack combos:** each player has a 3-stage combo. Pressing attack advances `CombatController.chainStage`. Each stage plays a different animation and has a window — move or wait too long, the chain resets.
- **Skills:** defined as `SkillDefinition` structs with cast time, cooldown, range, damage. Dispatched through a `std::variant` in `executeSkill()` — so each skill can have its own execution logic without virtual dispatch.
- **Damage:** when an attack hit-box overlaps a target collider, apply damage to `Health`, knockback to `PhysicsBody`, emit a `DamageEvent`. If health drops to zero, emit a `DeathEvent`, update `MatchStatsComponent` on both attacker and victim.
- **Events out:** `DamageEvent`, `DeathEvent`, `AttackStartedEvent`, `SkillUsedEvent` — pushed into the victim's (or attacker's) `NetworkEventsComponent`. Rust drains these each tick and broadcasts them over the bidi game stream.

The barbarian's **rotating-axe sweep** (skill 2) is a concrete example: it's a channeled skill that rotates the weapon transform each sub-tick and emits damage events against any collider it passes through, suppressing stamina regen while active.

---

## 9. FFI — how Rust talks to C++ (30 seconds)

We use the **`cxx` crate**. You declare a bridge module in Rust listing the C++ types and functions, and a matching C++ header. Code generation on both sides produces type-safe bindings.

```rust
#[cxx::bridge(namespace = "arena_game")]
mod bridge {
    extern "C++" {
        type GameBridge;
        fn update(self: Pin<&mut GameBridge>);
        fn set_player_input(self: Pin<&mut GameBridge>, id: u32, input: &PlayerInput);
        fn get_snapshot(self: &GameBridge) -> GameStateSnapshot;
        fn take_events(self: Pin<&mut GameBridge>) -> UniquePtr<EventQueue>;
    }
}
```

**Zero-copy:** `Vec3`, `PlayerInput`, `CharacterSnapshot` are laid out identically in both languages, so a C++ `std::vector<CharacterSnapshot>` can be iterated from Rust without copying.

**→ Deep dive:** `game-server-ecs.md` §FFI Bridge.

---

## 10. Network protocol (30 seconds)

- **Transport:** WebTransport (HTTP/3 over QUIC). Bidirectional streams, multiplexed.
- **Serialization:** CBOR (binary JSON-like). Auto-compressed with Zstd above a threshold (1 KiB server, 512 B client).
- **Frame:** `[4B length][1B flags][payload]`. Flag bit 0 = compressed.
- **Streams per player:** one uni-stream for lobby state, one bidi-stream for the game itself, one for notifications.

Server → client: `Snapshot` (60 Hz continuous), `Damage`, `Death`, `AttackStarted`, `SkillUsed`, `Spawn`, `MatchEnd` (discrete events).
Client → server: `Input` (movement vector + action booleans), `Leave`.

**→ Deep dive:** `game-communication.md`.

---

## 11. Frontend — What it does (30 seconds)

The frontend is a **pure renderer**. It does not simulate physics, collision, or damage. It:
1. Captures keyboard input and sends it up.
2. Receives snapshots + events from the server.
3. Draws the 3D scene with Babylon.js.
4. Plays animations and sounds that match server state/events.
5. Shows HUD (health, stamina, cooldowns).

That's the whole mental model. Every position you see on screen came from the server on the previous tick.

---

## 12. Frontend stack (30 seconds)

| Tech | Why |
|------|-----|
| **Babylon.js 8** | Mature WebGL 3D engine. glTF model loading, skeletal animation, orthographic camera out of the box. |
| **React 19** | UI overlay — menus, lobby, HUD components. But **not** game state. |
| **TypeScript** | Strict types that mirror Rust's message enums. Protocol bugs become compile errors. |
| **AudioEngineV2** (Babylon) | Spatial 3D audio bus. |
| **WebTransport API** | Native browser API. QUIC streams directly from JavaScript. |

---

## 13. Frontend structure (1 minute)

```
frontend/src/game/
├── GameClient.ts            top-level coordinator
├── CharacterManager.ts      tracks all players (local + remote)
├── AnimatedCharacter.ts     one entity — mesh, skeleton, anim groups, trail
├── SnapshotProcessor.ts     snapshot → positions, health, HUD
├── EventProcessor.ts        events → one-shot animations
├── AnimationStateMachine.ts state: Idle/Attack/Skill/Death
├── HUD.ts                   bars and cooldown rings
├── SwingTrail.ts            ribbon effect behind the weapon
├── characterConfigs.ts      per-class asset + stat definitions
└── types.ts                 TS mirrors of Rust message types
```

**The render loop** (runs every frame, driven by Babylon):

```
1. drain events from ref queue     → EventProcessor → one-shot anims
2. read latest snapshot from ref   → SnapshotProcessor → positions, health
3. update local animation SM
4. send input to server
5. update weapon trail ribbon
6. update HUD (own bars + world-space remote health bars)
7. position camera behind local player
8. scene.render()
```

**→ Deep dive:** `game-frontend.md` §Render Loop.

---

## 14. Dual-track animation (key design point)

This is worth highlighting — it's an elegant solve.

A character has two sources of animation:

- **Continuous state** from the snapshot: are they walking, sprinting, idle? This is "background" animation.
- **Discrete events** from the event stream: "attack just started", "skill just fired", "died right now". These are "foreground" one-shots.

**Two processors, one state machine:**

```
snapshot.state  ──► fallback animation (idle / walk / sprint)
events[]        ──► priority animation (attack / skill / death)
                    (plays once, blocks fallback while active, then releases)
```

Priority order: Death > Skill > Attack > Spawn > Idle.

The `AnimationStateMachine` arbitrates. Event animations take precedence. When they finish, the machine drops back to the snapshot-driven fallback.

**Why this matters:** snapshots arrive at 60 Hz and describe *steady state*. If you only drove animation off snapshots, you'd miss brief attacks because the window between snapshots is too coarse. Events fix that — they're fired at the exact moment the event happens on the server.

---

## 15. Why refs, not React state (briefly, if they ask about React)

Game data updates 60 times per second. If we put snapshots into `useState`, React would re-render the whole tree 60 times per second — ruinous for frame rate.

```
ConnectionManager receives snapshot
  └── writes to snapshotRef.current         (React ref, NOT state)

Babylon render loop reads snapshotRef.current each frame.

React only re-renders on lifecycle events (match end, join/leave).
```

Refs give the render loop O(1) access without triggering reconciliation. React still owns the overlay (menus, modals, match results). Two worlds, clean boundary.

---

## 16. Audio (30 seconds)

Decoupled from game logic — `AudioEventSystem` maps events to sound IDs via four trigger tables:

| Trigger table | Source | Example |
|---------------|--------|---------|
| `LOCAL_INPUT_TRIGGERS` | local key press edges | footstep start |
| `LOCAL_CONTINUOUS_TRIGGERS` | held inputs | footstep loop |
| `REMOTE_SNAPSHOT_TRIGGERS` | remote character state changes | enemy footsteps |
| `GAME_EVENT_TRIGGERS` | server events | hit impact, death cry |

Class-specific sounds resolve by ID — `knight_footstep` with `player_footstep` as fallback. Adding sounds for a new class is a config edit, not a code change.

---

## 17. Character classes & game modes (if they ask)

**6 classes**, all share a `CharacterConfig` schema: Knight, Rogue, Barbarian, Ranger, Mage, RogueHooded. Each defines model, animation files, equipment attachments, stats, combo chain, two skills, trail color.

**4 modes:** Deathmatch (time-limited FFA), Last Standing (battle royale), Wave Survival (PvE), Team Deathmatch.

Adding a new class is a config edit on the frontend. Adding a new mode is an enum value + branch in `GameModeSystem`.

---

## 18. Q&A anchors — likely questions

| Question | Where it's answered |
|----------|---------------------|
| "Why not just sockets?" | §Network protocol — WebTransport = multiplexed QUIC streams, not head-of-line blocked like TCP. |
| "Why authoritative server?" | Prevents cheating. Client is dumb = trusts nothing. |
| "How does collision scale?" | Currently O(n²), player counts are small (≤8). Broad-phase would be a grid or AABB tree if we scale up. |
| "Is there client-side prediction?" | No — `DirectPositionStrategy` is the current impl, but `PositionStrategy` interface is ready for interpolation swap. |
| "Why C++ and Rust?" | Rust for safe concurrent networking, C++ for EnTT ECS maturity. CXX makes the bridge safe. |
| "What happens on reconnect?" | Exponential backoff (1s → 40s cap), streams re-established via `on_connect()` hooks. |
| "What if two tabs open?" | Server sends `CtrlMessage::Displaced` to old connection, UI shows "session replaced". |
| "Is the physics deterministic?" | Fixed 60 Hz timestep accumulator → yes for the physics phase. Game logic runs on real delta. |
| "How do you serialize?" | CBOR (binary, typed) with Zstd above a size threshold. Wire frame = `[4B len][1B flags][payload]`. |

---

## Suggested speaking order (~8–10 minutes)

1. **What it is** (§1) — 30s
2. **Three-tier architecture** (§2) — show the diagram, name what each layer owns
3. **Lifecycle overview** (§3) — 1 min
4. **One tick** (§4) — the single most important diagram
5. **ECS rationale** (§5) — the "why", not just the "what"
6. **Components** (§6) — flip through the table
7. **Systems & 4-phase loop** (§7) — zoom in on CombatSystem if time
8. **FFI bridge** (§9) — 30s, just name the `cxx` crate
9. **Frontend overview** (§11, §12) — state the rendering-only philosophy
10. **Frontend flow** (§13) — render loop
11. **Dual-track animation** (§14) — the elegant bit, worth showing off
12. **Refs not state** (§15) — only if React comes up
13. **Take questions** — use §18 as anchor points
