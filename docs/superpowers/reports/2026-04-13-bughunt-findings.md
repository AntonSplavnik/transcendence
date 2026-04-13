# Bug Hunt Reconciled Findings — 2026-04-13

## Domain 1 — CXX bridge and event queue marshalling

### Hard findings reconciliation
## Hard Findings for Domain: CXX bridge and event queue marshalling

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D1-L1 — `reinterpret_cast` bridge vector conversion UB
**Status:** corroborated-lead
**Canonical location:** `game-core/src/cxx_bridge.cpp:18-35`, `game-core/src/cxx_bridge.cpp:83-87`
**Suspected mechanism:** UB from strict-aliasing/type-punning (`Vec3` <-> `Vector3D`) that can surface as intermittent native crash under optimizer/load.
**Canonical text:** Both agents independently flagged the zero-copy reinterpret conversions in `to_vec3` / `from_vec3` as undefined behavior risk in high-frequency paths (`set_player_input`, snapshot conversion). This matches intermittent/timing-sensitive behavior and higher trigger likelihood with >=3 players increasing call frequency, but neither agent proved current build miscompilation or a direct downstream crash dereference.
**Evidence (quoted code):**
```cpp
inline Vec3 to_vec3(const ::ArenaGame::Vector3D& v) {
    return *reinterpret_cast<const Vec3*>(&v);
}

inline ::ArenaGame::Vector3D from_vec3(const Vec3& v) {
    return *reinterpret_cast<const ::ArenaGame::Vector3D*>(&v);
}
```
```cpp
void GameBridge::set_player_input(uint32_t id, const PlayerInput& input) {
    ::ArenaGame::InputState state;
    state.movementDirection = from_vec3(input.movement);
    state.lookDirection     = from_vec3(input.look_direction);
```

#### Lead D1-L2 — Unchecked event index + variant getter termination path
**Status:** corroborated-lead
**Canonical location:** `game-core/src/cxx_bridge.cpp:142-172`, `backend/src/game/ffi.rs:421-427`
**Suspected mechanism:** unchecked `events[idx]` and `std::get<T>` mismatch can crash/terminate if invariant breaks (OOB or `bad_variant_access`/terminate behavior).
**Canonical text:** Both agents independently flagged the two-phase access pattern (`kind_at(i)` then `get_*_at(i)`) with unchecked index and typed variant extraction. They could not prove an in-repo invariant break in current loop semantics (`0..len()` + same-index dispatch), so this remains a concrete but unproven lead.
**Evidence (quoted code):**
```cpp
NetworkEventType EventQueue::kind_at(size_t idx) const {
    return std::visit([](auto&& ev) -> NetworkEventType {
        using T = std::decay_t<decltype(ev)>;
```
```cpp
DeathEvent EventQueue::get_death_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::DeathEvent>(events[idx]);
```
```rust
let queue = self.game.pin_mut().take_events();
(0..queue.len())
    .map(|i| match queue.kind_at(i) {
```

### Reconciled eliminated candidates
- **Corroborated elimination:** Rust-side lock serialization blocks concurrent C++ bridge access (`backend/src/game/game.rs:14`, `backend/src/game/game.rs:75`, `backend/src/game/game.rs:110-119`, `backend/src/game/ffi.rs:153-156`).
- **Corroborated elimination:** direct caller-driven OOB index in Rust drain loop is not evidenced (`backend/src/game/ffi.rs:421-425`).
- **Corroborated elimination:** `GameBridge::take_events` returns owned queue via `std::unique_ptr`, no immediate transfer-point UAF evidence (`game-core/src/cxx_bridge.cpp:134-137`).

---

## Domain 10 — Entity construction, preset lookup, and class-dependent runtime shape

### Hard findings reconciliation
## Hard Findings for Domain: Entity construction, preset lookup, and class-dependent runtime shape

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D10-L1 — `presetFromClass` assert/UB boundary on unexpected class string
**Status:** corroborated-lead
**Canonical location:** `game-core/src/CharacterClassLookup.hpp:11-18`, `backend/build.rs:65`, `backend/src/game/ffi.rs:373`, `game-core/src/cxx_bridge.cpp:73`
**Suspected mechanism:** debug abort via `assert`; release UB if `it == end()` and assert compiled out.
**Canonical text:** Both agents independently reported this as concrete crash-capable path if unknown class reaches C++ boundary. Both also found current typed Rust path likely constrains values (`knight|rogue`) so active trigger remains unproven.
**Evidence (quoted code):**
```cpp
auto it = table.find(characterClass);
assert(it != table.end() && "Unknown character class received from Rust");
return *it->second;
```

#### Lead D10-L2 — `createPlayer` emplaces components without null-entity guard
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/core/World.hpp:334-338`
**Suspected mechanism:** if `createActor` returns `entt::null`, subsequent `emplace` could abort/assert in debug EnTT build.
**Canonical text:** Skeptic-only lead. No current call path proving `createActor` returns null under normal runtime constraints.
**Evidence (quoted code):**
```cpp
entt::entity player = m_factory.createActor(name, preset);
m_registry.emplace<Components::PlayerTag>(player);
m_registry.emplace<Components::CharacterController>(player);
```

#### Lead D10-L3 — Bridge trusts raw class string if alternate caller bypasses enum path
**Status:** disputed-lead (and anti-FP-invalid)
**Canonical location:** `game-core/src/cxx_bridge.cpp:73`, `backend/src/game/game.rs:50`, `backend/src/game/ffi.rs:188`
**Mechanism claim:** alternate caller/refactor could pass arbitrary class and trigger D10-L1.
**Reconciliation:** both agents mention this as fragility, but both also show current path is enum-constrained.
**Disposition under anti-FP rules:** dropped from actionable leads as future/hypothetical unless a concrete current bypass is shown.

### Reconciled eliminated candidates
- **Corroborated elimination:** current API path to unknown class is constrained by Rust enum and `as_str()` mapping (`backend/src/game/router.rs:45`, `backend/src/game/lobby.rs:46`, `backend/src/game/lobby.rs:238`, `backend/src/game/manager.rs:582`, `backend/src/game/game.rs:50`, `backend/src/game/ffi.rs:188`).
- **Corroborated elimination:** Rust/C++ concurrent mutation race is not evidenced due shared mutex (`backend/src/game/game.rs:14`, `backend/src/game/game.rs:30`, `backend/src/game/game.rs:48`, `backend/src/game/game.rs:57`, `backend/src/game/game.rs:75`, `backend/src/game/game.rs:110`).
- **Corroborated elimination:** class-shape immediate attack OOB is guarded in normal flow (`game-core/src/components/CombatController.hpp:95`, `game-core/src/systems/CombatSystem.hpp:248`, `game-core/src/systems/CombatSystem.hpp:271`).

---

## Domain 9 — Game mode start flow, pending players, respawn queues, and match-end emission

### Hard findings reconciliation
## Hard Findings for Domain: Game mode start flow, pending players, respawn queues, and match-end emission

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D9-L1 — `GameMode::None` factory result can null-deref at start
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/systems/GameModeSystem.hpp:80-82`, `game-core/src/GameMode.hpp:326-328`
**Suspected mechanism:** `create` may return `nullptr` (for `None`), then `m_mode->onStart` dereferences null.
**Canonical text:** Skeptic-only lead. Mechanically process-killing, but not profile-aligned as intermittent >=3-player timing bug and likely blocked by upstream mode selection.
**Evidence (quoted code):**
```cpp
m_mode = IGameMode::create(gm->modeType);
m_mode->onStart(ctx);
```
```cpp
case GameModeType::None:
default: return nullptr;
```

#### Lead D9-L2 — `m_spawner` assumed non-null in start/tick contexts
**Status:** corroborated-lead
**Canonical location:** `game-core/src/systems/GameModeSystem.hpp:81`, `game-core/src/systems/GameModeSystem.hpp:93`, `game-core/src/core/World.hpp:188`, `game-core/src/core/World.hpp:217`
**Suspected mechanism:** null dereference if lifecycle/wiring order violated.
**Canonical text:** Both agents flagged unconditional `*m_spawner` dereference. Both also noted current initialization path wires the dependency before start, so active trigger in current flow is unproven.
**Evidence (quoted code):**
```cpp
GameModeContext ctx { *m_registry, *m_spawner };
```
```cpp
gameModeSystem->setSpawner(this);
...
m_systemManager.start();
```

#### Lead D9-L3 — Unchecked bridge event index in mode-adjacent flow
**Status:** corroborated-lead
**Canonical location:** `game-core/src/cxx_bridge.cpp:162`, `game-core/src/cxx_bridge.cpp:166`, `backend/src/game/ffi.rs:423`
**Suspected mechanism:** unchecked `events[idx]` could hard-crash if caller contract is broken.
**Canonical text:** Both agents reported this bridge fragility in this domain context; both acknowledged current Rust loop uses bounded indexing and did not prove active mismatch.
**Evidence (quoted code):**
```cpp
}, events[idx]);
```
```rust
(0..queue.len())
```

### Reconciled eliminated candidates
- **Corroborated elimination:** respawn queue stale-entity UAF not evidenced due removal cleanup and guarded access (`game-core/src/GameMode.hpp:253`, `game-core/src/core/World.hpp:366`).
- **Corroborated elimination:** match-end stale entity deref not evidenced (`game-core/src/systems/GameModeSystem.hpp:29-33`).
- **Corroborated elimination:** Rust/C++ race claim unsupported; same mutex serializes mode/update/input paths (`backend/src/game/game.rs:14`, `backend/src/game/game.rs:30`, `backend/src/game/game.rs:55`, `backend/src/game/game.rs:75`, `backend/src/game/game.rs:110`).

---

## Domain 8 — Stamina consumption/regeneration cross-phase interactions

### Hard findings reconciliation
## Hard Findings for Domain: Stamina consumption/regeneration cross-phase interactions

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D8-L1 — Stamina ratio division without zero guard
**Status:** corroborated-lead
**Canonical location:** `game-core/src/systems/StaminaSystem.hpp:88`, `game-core/src/components/Stamina.hpp:105`
**Suspected mechanism:** `stamina.current / stamina.maximum` can generate non-finite values if maximum is bad input/preset.
**Canonical text:** Both agents independently flagged unguarded denominator in regen path; both also noted no immediate in-domain memory-safety crash was proven under current preset assumptions.
**Evidence (quoted code):**
```cpp
float ratio = stamina.current / stamina.maximum;
```
```cpp
s.maximum = preset.maxStamina;
```

#### Lead D8-L2 — Unchecked combat stage index referenced from stamina/combat overlap windows
**Status:** corroborated-lead
**Canonical location:** `game-core/src/components/CombatController.hpp:86-88`, `game-core/src/components/CombatController.hpp:137`, `game-core/src/systems/CombatSystem.hpp:249`, `game-core/src/systems/CombatSystem.hpp:412`
**Suspected mechanism:** unchecked `attackChain[chainStage]` could crash if invariants are corrupted.
**Canonical text:** Both agents highlighted this as contingent crash primitive affecting high-input combat windows; neither found current flow violating invariants.
**Evidence (quoted code):**
```cpp
return attackChain[static_cast<size_t>(chainStage)];
```

#### Lead D8-L3 — Delta-time sensitivity in spend/regen path
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/systems/CharacterControllerSystem.hpp:85`, `game-core/src/systems/StaminaSystem.hpp:72`
**Suspected mechanism:** extreme/non-finite `deltaTime` can produce unstable stamina state transitions.
**Canonical text:** Hunter-only lead; Skeptic acknowledged as stress angle but not a demonstrated active crash mechanism.
**Evidence (quoted code):**
```cpp
float frameCost = stamina.sprintCostPerSec * deltaTime;
```
```cpp
stamina.drainDelayTimer -= deltaTime;
```

### Reconciled eliminated candidates
- **Corroborated elimination:** Rust-side concurrent race claim not supported; same mutex serializes access (`backend/src/game/game.rs:14`, `backend/src/game/game.rs:30-31`, `backend/src/game/game.rs:75`, `backend/src/game/game.rs:110`, `backend/src/game/ffi.rs:153`).
- **Corroborated elimination:** stamina underflow/overspend path is clamped (`game-core/src/components/Stamina.hpp:87-89`).
- **Corroborated elimination:** normal attack start path prevents empty-chain crash (`game-core/src/components/CombatController.hpp:94-97`, `game-core/src/systems/CombatSystem.hpp:247-250`).

---

## Domain 7 — Physics and collision iteration safety under dense actor updates

### Hard findings reconciliation
## Hard Findings for Domain: Physics and collision iteration safety under dense actor updates

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D7-L1 — Unchecked `get<>` after entity snapshot in collision pass
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/systems/CollisionSystem.hpp:103-127`
**Suspected mechanism:** stale entity IDs in snapshot vector could cause invalid `get<>` access if entity lifecycle changes before retrieval.
**Canonical text:** Hunter reported this as potential crash primitive but did not prove any current same-tick destruction/mutation path within audited flow.
**Evidence (quoted code):**
```cpp
std::vector<entt::entity> entities;
for (auto entity : view) {
    entities.push_back(entity);
}
...
auto& colliderA = m_registry->get<Components::Collider>(entityA);
```

#### Lead D7-L2 — C++/Rust vector reinterpret-cast UB on hot state path
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/cxx_bridge.cpp:29`, `game-core/src/cxx_bridge.cpp:34`
**Suspected mechanism:** strict-aliasing UB from pointer reinterprets can become intermittent native crash under load.
**Canonical text:** Skeptic reported this as likely cross-domain contributor to physics/collision instability; Hunter did not independently report in this domain.
**Evidence (quoted code):**
```cpp
return *reinterpret_cast<const Vec3*>(&v);
...
return *reinterpret_cast<const ::ArenaGame::Vector3D*>(&v);
```

### Reconciled eliminated candidates
- **Corroborated elimination:** no proven Rust/C++ concurrent mutation race during physics/collision tick due shared mutex (`backend/src/game/game.rs:14`, `backend/src/game/game.rs:75-86`, `backend/src/game/game.rs:109-121`, `backend/src/game/lobby.rs:254-258`, `backend/src/game/ffi.rs:153-156`).
- **Corroborated elimination:** divide-by-zero in collision separation paths is guarded (`game-core/src/systems/CollisionSystem.hpp:279-282`, `game-core/src/systems/CollisionSystem.hpp:330-337`, `game-core/src/systems/CollisionSystem.hpp:340-357`, `game-core/src/GameTypes.hpp:57-62`).
- **Corroborated elimination:** pair-loop OOB indexing not evidenced with current loop bounds (`game-core/src/systems/CollisionSystem.hpp:111`, `game-core/src/systems/CollisionSystem.hpp:124`).

---

## Domain 6 — Combat action buffering, timers, and pending-hit queue

### Hard findings reconciliation
## Hard Findings for Domain: Combat action buffering, timers, and pending-hit queue

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D6-L1 — Unchecked `attackChain[chainStage]` index in hot combat paths
**Status:** corroborated-lead
**Canonical location:** `game-core/src/components/CombatController.hpp:86`, `game-core/src/components/CombatController.hpp:137`, `game-core/src/systems/CombatSystem.hpp:412`
**Suspected mechanism:** OOB read UB if `chainStage` invariant breaks.
**Canonical text:** Both agents independently flagged unchecked stage indexing through `currentStage()` in timer/swing paths as a concrete crash primitive. Both reported missing proof of a current in-scope writer that violates invariants.
**Evidence (quoted code):**
```cpp
const AttackStage& currentStage() const {
    return attackChain[static_cast<size_t>(chainStage)];
}
```
```cpp
if (combat.swingTimer >= combat.currentStage().duration) {
```

#### Lead D6-L2 — Second unchecked index path `attackChain[chainStage - 1]`
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/components/CombatController.hpp:145-147`
**Suspected mechanism:** OOB read in chain window timer when `chainStage` inconsistent.
**Canonical text:** Hunter-only lead; related to D6-L1 invariant class but distinct index site. Skeptic did not independently report this exact site.
**Evidence (quoted code):**
```cpp
chainWindowTimer += dt;
if (chainWindowTimer > attackChain[static_cast<size_t>(chainStage - 1)].chainWindow)
```

#### Lead D6-L3 — Snapshot divides by `currentStage().duration` without denominator guard
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/ArenaGame.hpp:255-256`, `game-core/src/Presets.hpp:50-57`, `game-core/src/Presets.hpp:106-110`
**Suspected mechanism:** non-finite progress from zero/invalid duration could cascade to downstream failure.
**Canonical text:** Skeptic-only lead; current presets appear non-zero, so active crash path remains unproven in current code.
**Evidence (quoted code):**
```cpp
charSnapshot.swingProgress = (combat.isAttacking && !combat.attackChain.empty())
    ? combat.swingTimer / combat.currentStage().duration
    : 0.0f;
```

### Reconciled eliminated candidates
- **Corroborated elimination:** unproven Rust/C++ race; same mutex serializes input and update (`backend/src/game/game.rs:14`, `backend/src/game/game.rs:75`, `backend/src/game/game.rs:110-120`, `backend/src/game/ffi.rs:153-156`).
- **Corroborated elimination:** pending-hit victim UAF is guarded by `try_get` + alive check (`game-core/src/systems/CombatSystem.hpp:344-346`).
- **Corroborated elimination:** empty attack chain normal-start path is gated (`game-core/src/components/CombatController.hpp:94-97`, `game-core/src/systems/CombatSystem.hpp:247-250`).

---

## Domain 5 — CharacterController input processing and movement state machine

### Hard findings reconciliation
## Hard Findings for Domain: CharacterController input processing and movement state machine

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D5-L1 — FFI vector conversion strict-aliasing UB on hot input path
**Status:** corroborated-lead
**Canonical location:** `game-core/src/cxx_bridge.cpp:28-35`, `game-core/src/cxx_bridge.cpp:83-94`
**Suspected mechanism:** UB from `reinterpret_cast` dereference between unrelated vector structs.
**Canonical text:** Both agents independently flagged this same mechanism and tied it to high-frequency `set_player_input` traffic under >=3 players. Neither agent proved current-build miscompile/crash causality.
**Evidence (quoted code):**
```cpp
inline ::ArenaGame::Vector3D from_vec3(const Vec3& v) {
    return *reinterpret_cast<const ::ArenaGame::Vector3D*>(&v);
}
```
```cpp
state.movementDirection = from_vec3(input.movement);
state.lookDirection     = from_vec3(input.look_direction);
```

#### Lead D5-L2 — Unsanitized non-finite input propagation into movement state
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/components/CharacterController.hpp:75-92`, `game-core/src/systems/CharacterControllerSystem.hpp:101-182`
**Suspected mechanism:** NaN/Inf values could propagate through movement/velocity math and trigger downstream native failure.
**Canonical text:** Both agents raised this general path as plausible with malformed/high-rate client inputs, but no direct in-domain process-kill dereference was proven.
**Evidence (quoted code):**
```cpp
void setInput(const InputState& newInput) {
    input = newInput;
}
```
```cpp
float inv = maxStep / std::sqrt(distSq);
physics.velocity.x += dvx * inv;
physics.velocity.z += dvz * inv;
```

#### Lead D5-L3 — Stale player mapping if destruction bypasses `removePlayer`
**Status:** corroborated-lead
**Canonical location:** `game-core/src/core/World.hpp:300-303`, `game-core/src/core/World.hpp:387-397`, `game-core/src/core/World.hpp:359-362`
**Suspected mechanism:** direct entity destroy without unregister can leave stale PlayerID mapping used by input path.
**Canonical text:** Both agents independently identified mapping/destruction coupling risk. Neither established a concrete current call site that destroys player entities outside `removePlayer`.
**Evidence (quoted code):**
```cpp
inline bool World::destroyEntity(entt::entity entity) {
    m_registry.destroy(entity);
    return true;
}
```
```cpp
entt::entity entity = getEntityByPlayerID(id);
...
auto* controller = m_registry.try_get<Components::CharacterController>(entity);
```
```cpp
unregisterPlayerIDMapping(entity);
destroyEntity(entity);
```

### Reconciled eliminated candidates
- **Corroborated elimination:** direct input/update race across Rust/C++ boundary not evidenced due shared mutex lock (`backend/src/game/game.rs:75-86`, `backend/src/game/game.rs:109-121`).
- **Corroborated elimination:** divide-by-zero from zero movement vector is guarded (`game-core/src/components/CharacterController.hpp:87-92`, `game-core/src/GameTypes.hpp:56-62`).
- **Corroborated elimination:** null controller dereference blocked by `try_get` + null check (`game-core/src/core/World.hpp:394-397`).

---

## Domain 4 — Event pipeline: write paths in systems, drain path in bridge

### Hard findings reconciliation
## Hard Findings for Domain: Event pipeline: write paths in systems, drain path in bridge

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D4-L1 — Unchecked event index/getter crash surface
**Status:** corroborated-lead
**Canonical location:** `game-core/src/cxx_bridge.cpp:162-212`, `backend/src/game/ffi.rs:423-491`
**Suspected mechanism:** unchecked `events[idx]` plus typed `std::get<T>` can hard-crash if kind/index contract breaks.
**Canonical text:** Both agents flagged this same mechanism at the bridge boundary. Both also acknowledged current Rust caller contract appears internally consistent, so no present trigger sequence was proven in current code execution path.
**Evidence (quoted code):**
```cpp
}, events[idx]);
...
const auto& ev = std::get<::ArenaGame::NetEvents::DeathEvent>(events[idx]);
```
```rust
(0..queue.len())
    .map(|i| match queue.kind_at(i) {
```

#### Lead D4-L2 — Match-end stats map/entity validity coupling
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/systems/GameModeSystem.hpp:28-33`, `game-core/src/systems/GameModeSystem.hpp:127`, `game-core/src/systems/CombatSystem.hpp:353-355`
**Suspected mechanism:** stale `playerStats` entity keys could interact with entity lookups during match-end event build.
**Canonical text:** Skeptic-only lead. Mechanism remains speculative in this domain because no concrete stale-key generation path was proven in current in-match flow.
**Evidence (quoted code):**
```cpp
for (const auto& [entity, pstats] : stats.playerStats) {
    if (const auto* info = registry.try_get<Components::PlayerInfo>(entity)) {
```

#### Lead D4-L3 — Stale `m_gameManager` after `clearEntities` edge
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/core/World.hpp:273-280`, `game-core/src/core/World.hpp:305-312`
**Suspected mechanism:** cached manager entity used for event components after registry clear/reinit lifecycle edge.
**Canonical text:** Hunter-only lead. No concrete production call path to execute event drains after `clearEntities()` was proven.
**Evidence (quoted code):**
```cpp
auto* ne = m_registry.try_get<Components::NetworkEventsComponent>(m_gameManager);
```
```cpp
inline void World::clearEntities() {
    m_registry.clear();
}
```

#### Lead D4-L4 — Variant/schema drift or API misuse risk at bridge boundary
**Status:** disputed-lead (and anti-FP-invalid)
**Canonical location:** `game-core/src/cxx_bridge.hpp:33-42`, `game-core/src/cxx_bridge.cpp:143-212`, `backend/src/game/ffi.rs:424-495`
**Mechanism claim:** desync/misuse could call wrong getter and terminate.
**Reconciliation:** both agents noted fragility but also stated current mapping and caller pattern are consistent. The argument depends on future drift/misuse rather than a currently proven bug.
**Disposition under anti-FP rules:** dropped from actionable leads as hypothetical-only/future-regression claim.

### Reconciled eliminated candidates
- **Corroborated elimination:** no proven concurrent writer/drainer race; Rust mutex serializes update and drain (`backend/src/game/game.rs:110-120`, `backend/src/game/game.rs:75`).
- **Corroborated elimination:** no move-transfer UAF evidence in `takeNetworkEvents` + bridge ownership handoff (`game-core/src/core/World.hpp:277-280`, `game-core/src/cxx_bridge.cpp:135-137`).
- **Corroborated elimination:** `InternalEvents` mutate-while-iterate path not evidenced in current phase ordering (`game-core/src/systems/GameModeSystem.hpp:95-99`, `game-core/src/systems/GameModeSystem.hpp:118`, `game-core/src/ArenaGame.hpp:180-184`).

---

## Domain 3 — World player mapping and entity lifecycle

### Hard findings reconciliation
## Hard Findings for Domain: World player mapping and entity lifecycle

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D3-L1 — Character class lookup assert abort
**Status:** corroborated-lead
**Canonical location:** `game-core/src/CharacterClassLookup.hpp:11-18`, `game-core/src/core/World.hpp:333-335`
**Suspected mechanism:** process-killing `assert` abort when unexpected class string reaches `presetFromClass`.
**Canonical text:** Both agents independently identified `assert(it != table.end())` as a concrete native abort path. It is mechanically valid crash mechanism but currently unproven against observed sessions because no evidence yet that invalid class values are entering runtime.
**Evidence (quoted code):**
```cpp
auto it = table.find(characterClass);
assert(it != table.end() && "Unknown character class received from Rust");
return *it->second;
```
```cpp
const CharacterPreset& preset = presetFromClass(characterClass);
```

#### Lead D3-L2 — Stale mapping when entity destroyed outside `removePlayer`
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/core/World.hpp:300-303`, `game-core/src/core/World.hpp:409-414`
**Suspected mechanism:** if `destroyEntity` is used directly on player entity, mapping may remain stale and route later ops to invalid/recycled entity.
**Canonical text:** Skeptic flagged this as lifecycle hazard; Hunter did not corroborate and no concrete current call path was shown that destroys `PlayerTag` entities through `destroyEntity` without `unregisterPlayerIDMapping`.
**Evidence (quoted code):**
```cpp
inline bool World::destroyEntity(entt::entity entity) {
    m_registry.destroy(entity);
    return true;
}
```
```cpp
PlayerID id = getPlayerIDByEntity(entity);
if (id != 0) {
    m_playerToEntity.erase(id);
    m_entityToPlayer.erase(entity);
}
```

#### Lead D3-L3 — `PlayerID == 0` unregister guard can preserve stale mapping
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/core/World.hpp:409-414`
**Suspected mechanism:** `if (id != 0)` guard prevents map cleanup for zero ID, potentially leaving stale mapping.
**Canonical text:** Hunter-only lead. Mechanically concrete but depends on production possibility of zero-valued player IDs, which was not proven.
**Evidence (quoted code):**
```cpp
PlayerID id = getPlayerIDByEntity(entity);
if (id != 0) {
    m_playerToEntity.erase(id);
    m_entityToPlayer.erase(entity);
}
```

#### Lead D3-L4 — Pending player queue lifetime / duplicate replay across starts
**Status:** disputed-lead
**Canonical location:** `game-core/src/core/World.hpp:399-403`, `game-core/src/GameMode.hpp:135-139`, `game-core/src/GameMode.hpp:212-216`
**Suspected mechanism:** pending entries may persist and be replayed across mode starts, potentially causing stale/duplicate spawn intents.
**Reconciliation:** both agents raised variants of this risk; Skeptic cited possible stale accumulation, while Hunter explicitly noted no clear crash consequence and missing proof of repeated-start path in current lifecycle.
**Evidence (quoted code):**
```cpp
pp->players.push_back({ id, name, characterClass });
```
```cpp
for (const auto& p : pp->players) {
    entt::entity entity = ctx.spawner.createPlayer(p.id, p.name, p.characterClass, m_spawns.next());
```

### Reconciled eliminated candidates
- **Corroborated elimination:** direct null dereference in `setPlayerInput` is guarded by `entt::null` check + `try_get` null-check (`game-core/src/core/World.hpp:388-397`).
- **Corroborated elimination:** normal remove path unregisters mapping before destruction (`game-core/src/core/World.hpp:355-362`).
- **Corroborated elimination:** unproven Rust/C++ unsynchronized race; lock serialization exists (`backend/src/game/game.rs:14`, `backend/src/game/game.rs:75`, `backend/src/game/game.rs:109-120`).

---

## Domain 2 — Arena loop timing and phase orchestration

### Hard findings reconciliation
## Hard Findings for Domain: Arena loop timing and phase orchestration

NO HARD FINDINGS.

Reconciliation: both Hunter and Skeptic reported `NO HARD FINDINGS` (hard-clean).

### Reconciled concrete leads

#### Lead D2-L1 — Fixed-step debt truncation can violate downstream timing invariants
**Status:** corroborated-lead
**Canonical location:** `game-core/src/ArenaGame.hpp:165-178`
**Suspected mechanism:** dropping accumulated fixed-step debt (`m_accumulator = 0.0f`) under load may violate implicit invariants assumed by downstream systems and surface as intermittent crash in later phases.
**Canonical text:** Both agents independently flagged the capped fixed-step loop and accumulator truncation under overload as timing-sensitive behavior that becomes more likely with higher input load. Neither agent produced a concrete crash dereference in this domain alone.
**Evidence (quoted code):**
```cpp
while (m_accumulator >= GameConfig::FIXED_TIMESTEP &&
       iterations < GameConfig::MAX_PHYSICS_ITERATIONS) {
    m_world.fixedUpdate(GameConfig::FIXED_TIMESTEP);
    m_accumulator -= GameConfig::FIXED_TIMESTEP;
    iterations++;
}

if (iterations >= GameConfig::MAX_PHYSICS_ITERATIONS) {
    m_accumulator = 0.0f;
}
```

#### Lead D2-L2 — Match-over check after all phases can allow same-frame stale-state access
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/ArenaGame.hpp:161-188`
**Suspected mechanism:** `checkMatchOver()` runs after all phases; if earlier phase transitions invalidate assumptions, later same-frame phase could access stale ECS state.
**Canonical text:** Reported by Skeptic only. Plausible as ordering hazard, but no concrete component/entity invalidation path to crash was proven in this domain.
**Evidence (quoted code):**
```cpp
m_world.earlyUpdate(deltaTime);
...
m_world.update(deltaTime);
m_world.lateUpdate(deltaTime);
checkMatchOver();
```

#### Lead D2-L3 — Mid-iteration system vector mutation
**Status:** unconfirmed-lead
**Canonical location:** `game-core/src/systems/SystemManager.hpp:175-205`, `game-core/src/systems/SystemManager.hpp:112-118`
**Suspected mechanism:** `removeSystem`/`addSystem` during phase iteration could invalidate iterators and crash.
**Canonical text:** Reported by Hunter only; Skeptic found no current runtime caller evidence for `removeSystem` during active phase loops, so this remains unconfirmed.
**Evidence (quoted code):**
```cpp
for (auto& system : m_systems) {
    if (system->needsEarlyUpdate()) {
        system->earlyUpdate(deltaTime);
    }
}
```
```cpp
inline void SystemManager::removeSystem(const char* systemName) {
    m_systems.erase(
        std::remove_if(m_systems.begin(), m_systems.end(), ...),
        m_systems.end());
}
```

#### Lead D2-L4 — Claimed Rust-side cross-thread race on GameBridge access
**Status:** disputed-lead (and anti-FP-invalid)
**Canonical location:** `backend/src/game/ffi.rs:153-156`, `backend/src/game/game.rs:14`, `backend/src/game/game.rs:75`, `backend/src/game/game.rs:110-119`
**Mechanism claim:** potential unsynchronized cross-thread FFI access.
**Reconciliation:** Hunter raised it as a lead lacking mutex-gap proof. Skeptic explicitly refuted with concrete lock-path evidence showing both input and update loop take the same mutex around FFI calls.
**Disposition under anti-FP rules:** dropped from actionable leads due missing required mutex-gap proof.

### Reconciled eliminated candidates
- **Corroborated elimination:** infinite fixed-update loop is prevented by hard cap (`game-core/src/ArenaGame.hpp:166`, `game-core/src/GameTypes.hpp:228-230`).
- **Corroborated elimination:** update-before-init/uninitialized-world path is not evidenced (`game-core/src/ArenaGame.hpp:35-37`, `game-core/src/ArenaGame.hpp:150-152`).
- **Corroborated elimination:** active Rust/C++ race without mutex is not evidenced (`backend/src/game/game.rs:14`, `backend/src/game/game.rs:75`, `backend/src/game/game.rs:110-119`, `backend/src/game/ffi.rs:153-156`).

---
