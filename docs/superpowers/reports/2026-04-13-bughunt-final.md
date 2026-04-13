# Bug Hunt Final Report — 2026-04-13

## Bug we were hunting
We hunted an intermittent native crash in `game-core` that kills the backend process (no Rust panic), appears only with >=3 active inputting players, is timing-sensitive (bursty repro rate), and does not require player deaths/disconnects. Scope was static-analysis-only orchestration across 10 domains with dual independent investigators per domain (Hunter + Skeptic), reconciled under strict anti-false-positive filtering.

## Top suspects (ranked)
No hard findings survived anti-FP filtering. All domains were `NO HARD FINDINGS` at the hard-finding bar.

## Top concrete leads (ranked)
### Lead 1 — FFI vector reinterpret-cast UB on hot input path
**Domain:** 1 — CXX bridge and event queue marshalling (also echoed in Domain 5)
**Status:** corroborated-lead
**Lead:** `to_vec3` / `from_vec3` use `reinterpret_cast` dereference between unrelated struct types in `game-core/src/cxx_bridge.cpp:18-35`, and this is exercised on each input in `GameBridge::set_player_input` (`game-core/src/cxx_bridge.cpp:83-87`).
**Missing proof link:** Need runtime evidence that current compiler/build flags exploit aliasing UB in a way that causes the observed crash.
**How to verify in code execution:** Run 4+ bot stress with UBSan/ASan and A/B build (reinterpret-cast vs field-wise/`bit_cast` conversion). Add per-tick checksum logging for movement/look vectors pre/post bridge. Confirm whether crash reproduces only in cast variant.

### Lead 2 — Unchecked attack-chain stage indexing in combat paths
**Domain:** 6 — Combat action buffering, timers, and pending-hit queue (echoed in Domain 8)
**Status:** corroborated-lead
**Lead:** `CombatController::currentStage()` indexes `attackChain[chainStage]` unchecked (`game-core/src/components/CombatController.hpp:86`) and is used in swing/timer hot paths (`game-core/src/components/CombatController.hpp:137`, `game-core/src/systems/CombatSystem.hpp:412`).
**Missing proof link:** No proven current writer path that corrupts/desynchronizes `chainStage` vs `attackChain` under live gameplay.
**How to verify in code execution:** Add hard assertions before every `currentStage()` use (`chainStage < attackChain.size()`), plus ring-buffer trace of state transitions (`isAttacking`, `chainStage`, `attackChain.size`, buffered action). Run >=3-player attack spam and capture first invariant violation frame.

### Lead 3 — Event queue unchecked index + typed getter crash surface
**Domain:** 4 — Event pipeline: write paths in systems, drain path in bridge (echoed in Domains 1 and 9)
**Status:** corroborated-lead
**Lead:** `EventQueue` uses unchecked `events[idx]` and typed `std::get<T>` (`game-core/src/cxx_bridge.cpp:162-212`), while Rust drains by `0..queue.len()` dispatch (`backend/src/game/ffi.rs:423-491`).
**Missing proof link:** Need concrete evidence of current index/type contract break (not hypothetical future misuse).
**How to verify in code execution:** Instrument C++ getters with `idx < size` and `holds_alternative<T>` assertions + event kind logging for each `i`. Stress mixed attack/skill/deathless scenarios with >=3 players; if any mismatch occurs before crash, this lead upgrades.

### Lead 4 — PlayerID/entity mapping stale-handle risk if destroy path bypasses unregister
**Domain:** 5 — CharacterController input processing and movement state machine (echoed in Domain 3)
**Status:** corroborated-lead
**Lead:** `World::destroyEntity` destroys directly (`game-core/src/core/World.hpp:300-303`) while input routing trusts map lookup (`game-core/src/core/World.hpp:387-397`); safe path is `removePlayer` unregister then destroy (`game-core/src/core/World.hpp:359-362`).
**Missing proof link:** No concrete current call path proved that destroys player entities via raw `destroyEntity` while mappings remain live.
**How to verify in code execution:** Add runtime guard in `setPlayerInput` (`registry.valid(entity)` + map consistency assert) and trace all calls to `destroyEntity` with caller tags. Repro with >=3 players and aggressive join/leave/input churn.

### Lead 5 — Fixed-step truncation may violate downstream timing assumptions
**Domain:** 2 — Arena loop timing and phase orchestration
**Status:** corroborated-lead
**Lead:** under overload, fixed-step debt is dropped (`m_accumulator = 0.0f`) after max iterations (`game-core/src/ArenaGame.hpp:165-178`).
**Missing proof link:** No direct crash dereference was proven from this condition alone.
**How to verify in code execution:** Log frames where `iterations == MAX_PHYSICS_ITERATIONS`, then correlate with crash timestamps. Add invariant checks in systems sensitive to fixed-step continuity.

### Lead 6 — Class lookup assert/release-UB on unknown class strings
**Domain:** 10 — Entity construction, preset lookup, and class-dependent runtime shape (echoed in Domain 3)
**Status:** corroborated-lead
**Lead:** `presetFromClass` asserts then dereferences lookup iterator (`game-core/src/CharacterClassLookup.hpp:11-18`), creating debug abort and potential release UB if unknown class reaches C++.
**Missing proof link:** Current Rust pipeline appears enum-constrained to `knight|rogue`; no present bypass proven.
**How to verify in code execution:** Log/validate class strings at Rust->C++ add-player boundary and fuzz join/start pipeline with malformed class injection only in controlled test harness.

## All other findings and leads (full list, lower priority)
- **Domain 2:** D2-L2 unconfirmed (match-over check ordering), D2-L3 unconfirmed (system vector mutation), D2-L4 disputed-lead dropped by anti-FP (race claim without required mutex-gap proof).
- **Domain 3:** D3-L2 unconfirmed (destroy without unregister), D3-L3 unconfirmed (`PlayerID == 0` unregister edge), D3-L4 disputed-lead (pending-player replay semantics).
- **Domain 4:** D4-L2 unconfirmed (match-end stats/entity coupling), D4-L3 unconfirmed (`m_gameManager` lifecycle after `clearEntities`), D4-L4 disputed-lead dropped by anti-FP (future schema drift only).
- **Domain 6:** D6-L2 unconfirmed (`attackChain[chainStage-1]` site), D6-L3 unconfirmed (snapshot division denominator safety).
- **Domain 7:** D7-L1 unconfirmed (entity snapshot + unchecked `get<>` if lifecycle shifts), D7-L2 unconfirmed (bridge reinterpret-cast UB echoed from D1).
- **Domain 8:** D8-L1 corroborated (stamina ratio denominator), D8-L3 unconfirmed (`deltaTime` sensitivity).
- **Domain 9:** D9-L1 unconfirmed (`GameMode::None` null deref path, weak profile match), D9-L2 corroborated (`m_spawner` null-assumption), D9-L3 corroborated (bridge unchecked index echoed from D1/D4).

## Clean domains
- **Domain 1:** both agents reported `NO HARD FINDINGS`; coverage included bridge conversion, queue ownership transfer, getter/index contract, and Rust drain contract.
- **Domain 2:** both agents reported `NO HARD FINDINGS`; coverage included frame-phase ordering, fixed-step cap, and system manager iteration behavior.
- **Domain 3:** both agents reported `NO HARD FINDINGS`; coverage included add/remove/create/input mapping lifecycle and unregister semantics.
- **Domain 4:** both agents reported `NO HARD FINDINGS`; coverage included event write/drain ownership, internal event consumption, and bridge event accessors.
- **Domain 5:** both agents reported `NO HARD FINDINGS`; coverage included input ingestion, movement state transition, and input-to-velocity math path.
- **Domain 6:** both agents reported `NO HARD FINDINGS`; coverage included buffered actions, attack timers, chain stage access, and pending-hit processing.
- **Domain 7:** both agents reported `NO HARD FINDINGS`; coverage included collision pair loops, separation math guards, and fixed-step entity iteration.
- **Domain 8:** both agents reported `NO HARD FINDINGS`; coverage included spend/regen ordering, exhaustion transitions, and stamina arithmetic.
- **Domain 9:** both agents reported `NO HARD FINDINGS`; coverage included mode start, respawn queue handling, and match-end event emission.
- **Domain 10:** both agents reported `NO HARD FINDINGS`; coverage included class lookup, preset wiring, and entity construction shape.

## Gaps / domains needing a second pass
- **Disputed items:** D2-L4, D3-L4, D4-L4 had agent disagreement or anti-FP rejection; these should be revisited only with runtime instrumentation, not additional static speculation.
- **Cross-domain convergence gap:** multiple independent domains converged on two themes (`reinterpret_cast` UB; unchecked indexed access assumptions), but neither has runtime proof in this pass.
- **Profile-fit gap:** several leads are crash-capable but weakly aligned to intermittent >=3-player timing signature (e.g., class lookup assert path, null wiring assumptions).
- **Recommended follow-up:** run instrumented bot scenarios (>=3 concurrent input streams) with ASan/UBSan and targeted assertions at leads 1-4 above; prioritize attack-chain invariants and bridge conversion checks.

## Rules that were enforced
- Real, current bugs only (no theoretical failure modes)
- No malloc-fail, OOM, hardware-fault findings
- Bug must match profile: >=3 players, intermittent, no deaths/DCs, process-kill without Rust panic
- Every finding backed by a concrete code quote
