# Bug Hunt Domains — 2026-04-13

## Domain 1 — CXX bridge and event queue marshalling
**Scope:** Ownership and type conversion at the Rust/C++ boundary: `GameBridge` calls, snapshot conversion, and drained event access by index/type. Out of scope: Rust lobby orchestration beyond direct FFI invocation semantics.
**Primary files:**
- `game-core/src/cxx_bridge.hpp`
- `game-core/src/cxx_bridge.cpp`
- `backend/src/game/ffi.rs`
**Secondary files (read for context):**
- `backend/src/game/manager.rs`
- `game-core/src/events/NetworkEvents.hpp`
**Key functions / entry points to trace:**
- `GameBridge::set_player_input` (Rust side call) in `backend/src/game/ffi.rs:384`
- `GameBridge::set_player_input` (C++ binding) in `game-core/src/cxx_bridge.cpp:83`
- `GameBridge::take_events` in `game-core/src/cxx_bridge.cpp:134`
- `EventQueue::kind_at` in `game-core/src/cxx_bridge.cpp:142`
- `GameHandle::drain_network_events` in `backend/src/game/ffi.rs:421`
**Why this domain matters for the bug:**
With 3+ active players, event volume and input-call frequency rise; any index/type mismatch, stale queue ownership, or variant access mismatch can crash as a native abort/segfault without Rust panic. Timing-sensitive crash patterns often surface at boundaries that drain mutable queues while another phase is producing events.

## Domain 2 — Arena loop timing and phase orchestration
**Scope:** The frame/timestep loop and ordering guarantees between `earlyUpdate`, `fixedUpdate`, `update`, and `lateUpdate`, including fixed-step catch-up behavior. Out of scope: per-system internal logic details.
**Primary files:**
- `game-core/src/ArenaGame.hpp`
- `game-core/src/systems/SystemManager.hpp`
**Secondary files (read for context):**
- `game-core/src/core/World.hpp`
- `game-core/src/systems/System.hpp`
**Key functions / entry points to trace:**
- `ArenaGame::update` in `game-core/src/ArenaGame.hpp:143`
- `ArenaGame::checkMatchOver` in `game-core/src/ArenaGame.hpp:190`
- `SystemManager::earlyUpdate` in `game-core/src/systems/SystemManager.hpp:175`
- `SystemManager::fixedUpdate` in `game-core/src/systems/SystemManager.hpp:183`
- `SystemManager::update` in `game-core/src/systems/SystemManager.hpp:191`
- `SystemManager::lateUpdate` in `game-core/src/systems/SystemManager.hpp:199`
**Why this domain matters for the bug:**
Intermittent multiplayer crashes are often phase-order bugs (producer/consumer assumptions violated under load). More inputs can change iteration count and timing (`MAX_PHYSICS_ITERATIONS` path), exposing stale references or ordering assumptions not hit in 1v1.

## Domain 3 — World player mapping and entity lifecycle
**Scope:** PlayerID/entity mapping, deferred player addition, creation/removal, respawn, and input routing in `World`. Out of scope: combat math or collision equations themselves.
**Primary files:**
- `game-core/src/core/World.hpp`
- `game-core/src/core/EntityFactory.hpp`
**Secondary files (read for context):**
- `game-core/src/components/PendingPlayersComponent.hpp`
- `game-core/src/components/PlayerInfo.hpp`
- `game-core/src/CharacterClassLookup.hpp`
**Key functions / entry points to trace:**
- `World::addPlayer` in `game-core/src/core/World.hpp:399`
- `World::createPlayer` in `game-core/src/core/World.hpp:324`
- `World::setPlayerInput` in `game-core/src/core/World.hpp:387`
- `World::removePlayer` in `game-core/src/core/World.hpp:347`
- `World::registerPlayerIDMapping` in `game-core/src/core/World.hpp:405`
- `World::unregisterPlayerIDMapping` in `game-core/src/core/World.hpp:409`
**Why this domain matters for the bug:**
Even without disconnects/deaths, bad mapping state can route inputs to invalid entities or null handles when enough players generate dense traffic. This is a high-value crash surface because every input and most systems depend on map integrity.

## Domain 4 — Event pipeline: write paths in systems, drain path in bridge
**Scope:** End-to-end lifecycle of `NetworkEventsComponent` and `InternalEventsComponent` vectors: who pushes, who clears, who drains/moves. Out of scope: gameplay semantics of each event type.
**Primary files:**
- `game-core/src/core/World.hpp`
- `game-core/src/systems/CombatSystem.hpp`
- `game-core/src/systems/GameModeSystem.hpp`
- `game-core/src/cxx_bridge.cpp`
**Secondary files (read for context):**
- `game-core/src/components/NetworkEventsComponent.hpp`
- `game-core/src/components/InternalEventsComponent.hpp`
- `game-core/src/events/NetworkEvents.hpp`
**Key functions / entry points to trace:**
- `World::takeNetworkEvents` in `game-core/src/core/World.hpp:277`
- `CombatSystem::processDamage` in `game-core/src/systems/CombatSystem.hpp:333`
- `CombatSystem::triggerSkill` in `game-core/src/systems/CombatSystem.hpp:203`
- `GameModeSystem::lateUpdate` in `game-core/src/systems/GameModeSystem.hpp:85`
- `GameBridge::take_events` in `game-core/src/cxx_bridge.cpp:134`
**Why this domain matters for the bug:**
This matches the bug profile closely: intermittent and timing-sensitive crashes under higher input fan-in are classic vector/variant lifecycle issues during producer-consumer handoff. No death/disconnect is required for this domain to fail.

## Domain 5 — CharacterController input processing and movement state machine
**Scope:** Translation of per-player input into movement velocity, rotation, sprint/jump decisions, and state transitions in early update. Out of scope: collision pair resolution and damage application.
**Primary files:**
- `game-core/src/systems/CharacterControllerSystem.hpp`
- `game-core/src/components/CharacterController.hpp`
**Secondary files (read for context):**
- `game-core/src/components/Stamina.hpp`
- `game-core/src/core/World.hpp`
- `backend/src/game/ffi.rs`
**Key functions / entry points to trace:**
- `CharacterControllerSystem::earlyUpdate` in `game-core/src/systems/CharacterControllerSystem.hpp:47`
- `CharacterControllerSystem::processCharacterMovement` in `game-core/src/systems/CharacterControllerSystem.hpp:64`
- `CharacterController::setInput` in `game-core/src/components/CharacterController.hpp:75`
- `World::setPlayerInput` in `game-core/src/core/World.hpp:387`
**Why this domain matters for the bug:**
Crash requires active input from multiple players, so this hot path is mandatory to inspect. Any hidden invalid state transition, NaN vector normalization edge, or movement-state interaction can be timing-dependent and absent in 1v1.

## Domain 6 — Combat action buffering, timers, and pending-hit queue
**Scope:** Attack/skill input consumption, buffered action precedence, cast/swing timers, and queued damage application. Out of scope: map loading and non-combat systems.
**Primary files:**
- `game-core/src/systems/CombatSystem.hpp`
- `game-core/src/components/CombatController.hpp`
- `game-core/src/components/Health.hpp`
**Secondary files (read for context):**
- `game-core/src/Skills.hpp`
- `game-core/src/events/InternalEvents.hpp`
- `game-core/src/events/NetworkEvents.hpp`
**Key functions / entry points to trace:**
- `CombatSystem::update` in `game-core/src/systems/CombatSystem.hpp:169`
- `CombatSystem::processInputAttacks` in `game-core/src/systems/CombatSystem.hpp:217`
- `CombatSystem::updateCooldowns` in `game-core/src/systems/CombatSystem.hpp:463`
- `CombatSystem::handleSwingEnd` in `game-core/src/systems/CombatSystem.hpp:400`
- `CombatSystem::processDamage` in `game-core/src/systems/CombatSystem.hpp:333`
- `CombatController::updateTimers` in `game-core/src/components/CombatController.hpp:133`
**Why this domain matters for the bug:**
High-input multiplayer directly stresses this logic; buffering and deferred queues are prime sources of intermittent crashes (stale entity handles, ordering bugs, re-entrancy-like assumptions). The crash can happen without any player death because this path executes continuously.

## Domain 7 — Physics and collision iteration safety under dense actor updates
**Scope:** Fixed-step entity views, O(n^2) collision pair loops, and transform mutation during collision resolution. Out of scope: lobby/network thread management.
**Primary files:**
- `game-core/src/systems/PhysicsSystem.hpp`
- `game-core/src/systems/CollisionSystem.hpp`
- `game-core/src/components/Collider.hpp`
**Secondary files (read for context):**
- `game-core/src/components/PhysicsBody.hpp`
- `game-core/src/components/Transform.hpp`
- `game-core/src/core/World.hpp`
**Key functions / entry points to trace:**
- `PhysicsSystem::fixedUpdate` in `game-core/src/systems/PhysicsSystem.hpp:64`
- `CollisionSystem::fixedUpdate` in `game-core/src/systems/CollisionSystem.hpp:93`
- `CollisionSystem::resolveCollision` in `game-core/src/systems/CollisionSystem.hpp:176`
- `CollisionSystem::computeSeparationVector` in `game-core/src/systems/CollisionSystem.hpp:252`
**Why this domain matters for the bug:**
With 3+ players, collision pairs and state mutation frequency increase sharply. Timing-sensitive crashes can stem from invalid entity/component assumptions during view iteration and repeated get/try_get access patterns in dense fixed updates.

## Domain 8 — Stamina consumption/regeneration cross-phase interactions
**Scope:** Stamina spending in movement/combat phases versus regen in late update, including exhaustion transitions and gating of actions. Out of scope: detailed hit detection geometry.
**Primary files:**
- `game-core/src/systems/StaminaSystem.hpp`
- `game-core/src/components/Stamina.hpp`
- `game-core/src/systems/CharacterControllerSystem.hpp`
- `game-core/src/systems/CombatSystem.hpp`
**Secondary files (read for context):**
- `game-core/src/components/CharacterController.hpp`
- `game-core/src/components/CombatController.hpp`
**Key functions / entry points to trace:**
- `StaminaSystem::lateUpdate` in `game-core/src/systems/StaminaSystem.hpp:48`
- `Stamina::consume` in `game-core/src/components/Stamina.hpp:87`
- `CharacterControllerSystem::processCharacterMovement` in `game-core/src/systems/CharacterControllerSystem.hpp:64`
- `CombatSystem::tickSkillSlot` in `game-core/src/systems/CombatSystem.hpp:429`
**Why this domain matters for the bug:**
Likely medium probability: not an obvious segfault surface, but cross-phase state edges (exhaustion/locking/unlocking) can produce invalid assumptions in other systems under heavy simultaneous input.

## Domain 9 — Game mode start flow, pending players, respawn queues, and match-end emission
**Scope:** Conversion of pending players to live entities, mode-specific bookkeeping, death-event handling, and match-end event generation. Out of scope: Rust lobby policy logic.
**Primary files:**
- `game-core/src/systems/GameModeSystem.hpp`
- `game-core/src/GameMode.hpp`
- `game-core/src/core/World.hpp`
**Secondary files (read for context):**
- `game-core/src/components/PendingPlayersComponent.hpp`
- `game-core/src/components/MatchStatsComponent.hpp`
- `game-core/src/events/InternalEvents.hpp`
**Key functions / entry points to trace:**
- `GameModeSystem::startMode` in `game-core/src/systems/GameModeSystem.hpp:75`
- `GameModeSystem::lateUpdate` in `game-core/src/systems/GameModeSystem.hpp:85`
- `Deathmatch::onStart` in `game-core/src/GameMode.hpp:199`
- `LastStanding::onStart` in `game-core/src/GameMode.hpp:122`
- `Deathmatch::tick` in `game-core/src/GameMode.hpp:260`
- `buildMatchEndEvent` in `game-core/src/systems/GameModeSystem.hpp:21`
**Why this domain matters for the bug:**
Lower likelihood given "no one died/disconnected," but start-of-match with 3+ players is part of the repro envelope and touches entity creation, stats maps, and event payload assembly that can crash if bookkeeping is inconsistent.

## Domain 10 — Entity construction, preset lookup, and class-dependent runtime shape
**Scope:** How entities are composed from presets (health/combat/stamina/collider) and class-string lookup assumptions (`assert` on unknown class). Out of scope: frame-by-frame system updates.
**Primary files:**
- `game-core/src/core/EntityFactory.hpp`
- `game-core/src/CharacterClassLookup.hpp`
- `game-core/src/Presets.hpp`
- `game-core/src/CharacterPreset.hpp`
**Secondary files (read for context):**
- `game-core/src/core/World.hpp`
- `backend/src/game/ffi.rs`
**Key functions / entry points to trace:**
- `EntityFactory::createActor` in `game-core/src/core/EntityFactory.hpp:77`
- `World::createPlayer` in `game-core/src/core/World.hpp:324`
- `presetFromClass` in `game-core/src/CharacterClassLookup.hpp:11`
- `GameBridge::add_player` in `game-core/src/cxx_bridge.cpp:73`
**Why this domain matters for the bug:**
Mostly completeness/guardrail domain: crashes here would be deterministic (`assert`) rather than intermittent, but multi-player sessions increase class/preset combinations and initialization pressure, so this is worth one focused sweep.

Domains I deliberately did NOT include and why: I did not split "general EnTT internals," "memory allocation failure," or "overall code quality" because they violate constraints and are not actionable investigation slices. I also did not create separate domains for Rust lobby/stream threading internals beyond FFI invocation context, because investigation targets are scoped to `game-core/src/`; those Rust paths are only useful to understand call cadence and ownership expectations at the bridge.
