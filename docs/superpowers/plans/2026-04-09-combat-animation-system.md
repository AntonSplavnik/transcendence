# Combat Animation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace input-driven animation with server-event-driven animation, add a 3-stage Knight attack chain, add skill cast durations with deferred damage, and add input buffering.

**Architecture:** The server emits `AttackStartedEvent` and `SkillUsedEvent` over the CXX bridge → Rust → WebSocket. Clients play animations from these events (not from input or snapshot state). Snapshot state is a fallback for late-joining clients only.

**Tech Stack:** C++20 (game-core, header-only), Rust (Salvo/CXX backend), TypeScript (Babylon.js frontend)

---

## File Map

| File | Change |
|------|--------|
| `game-core/src/Skills.hpp` | Extend `SkillDefinition`: add `castDuration`, `castTimer`, `hitPending`, `isCasting()`, `endCast()`, updated `trigger()` |
| `game-core/src/components/CombatController.hpp` | Add `BufferedAction` enum + `bufferedAction` field |
| `game-core/src/components/CharacterController.hpp` | Add `activeMovementMultiplier` field |
| `game-core/src/Presets.hpp` | 3-stage Knight chain, skill `castDuration` values |
| `game-core/src/systems/CharacterControllerSystem.hpp` | Remove lines 121–123 (input-driven attack state); multiply speed by `activeMovementMultiplier` |
| `game-core/src/events/NetworkEvents.hpp` | Add `AttackStartedEvent`, `SkillUsedEvent`; update `NetworkEvent` variant |
| `game-core/src/cxx_bridge.hpp` | Add `AttackStarted = 6`, `SkillUsed = 7` to `NetworkEventType`; forward-declare new structs; add `get_attack_started_at`, `get_skill_used_at` to `EventQueue` |
| `game-core/src/cxx_bridge.cpp` | Implement new accessors; add branches in `kind_at()` |
| `game-core/src/systems/CombatSystem.hpp` | Buffer logic, skill cast tick, new event emission, remove StateChange for attack/cast, set/restore `activeMovementMultiplier` |
| `backend/src/game/ffi.rs` | Add bridge structs, `NetworkEventType` values, `EventQueue` externs, `NetworkEvent` variants, drain match arms |
| `backend/src/game/messages.rs` | Add `AttackStarted`, `SkillUsed` to `GameServerMessage` |
| `backend/src/game/game.rs` | Add match arms for new events |
| `frontend/src/game/types.ts` | Add `AttackStarted`, `SkillUsed` to `GameServerMessage` and `GameEvent` |
| `frontend/src/game/characterConfigs.ts` | Add `attackAnimations`, `skillAnimations` to `CharacterConfig`; populate for Knight |
| `frontend/src/game/AnimatedCharacter.ts` | Make `currentAnimation` public |
| `frontend/src/contexts/GameContext.tsx` | Add `ability1`, `ability2` to `sendInput` signature and wire |
| `frontend/src/components/GameBoard/SimpleGameClient.tsx` | Add `characterConfigMap`; `processEvents` handles new events; rename + refactor `updateRemoteAnimation`; refactor `updateLocalAnimation`; add ability key bindings |

---

## Task 1: C++ Data Structures — Skills, CombatController, CharacterController

**Files:**
- Modify: `game-core/src/Skills.hpp`
- Modify: `game-core/src/components/CombatController.hpp`
- Modify: `game-core/src/components/CharacterController.hpp`

These are pure data changes. No callers break because new fields have safe defaults and `canUse()` gains an `!isCasting()` guard. `trigger()` now asserts `castDuration > 0` — but no existing call passes a castDuration-equipped skill yet (that comes in Task 2), so the assert is unreachable until then.

- [ ] **Step 1: Replace `SkillDefinition` in `Skills.hpp`**

Replace lines 15–21 of `game-core/src/Skills.hpp`:

```cpp
	struct SkillDefinition {
		SkillVariant params;
		float cooldown     = 0.0f;
		float castDuration = 0.0f;  // how long player is locked into this skill
		float timer        = 0.0f;  // cooldown countdown (starts after cast ends)
		float castTimer    = 0.0f;  // cast countdown — effect fires when this hits 0
		bool  hitPending   = false; // effect deferred to cast end

		bool isCasting() const { return castTimer > 0.0f; }
		bool canUse()    const { return timer <= 0.0f && !isCasting(); }

		// Starts the cast. The cooldown timer does NOT start until endCast() is called.
		// Total lockout = castDuration + cooldown. Precondition: castDuration > 0.
		// Skills with instant effects must not use this path.
		void trigger() {
			assert(castDuration > 0.0f && "SkillDefinition: castDuration must be > 0");
			castTimer  = castDuration;
			hitPending = true;
		}

		// Called by CombatSystem when castTimer reaches zero, before applying the hit.
		// Does NOT clear hitPending — CombatSystem clears it after applying the effect.
		void endCast() {
			timer     = cooldown;
			castTimer = 0.0f;
		}
	};
```

Also add `#include <cassert>` at the top of `Skills.hpp` after the `#include <variant>` line.

- [ ] **Step 2: Add `BufferedAction` to `CombatController.hpp`**

After the `// ── Capability flags` block (after line 68 of `CombatController.hpp`), add:

```cpp
	// ── Input buffer ─────────────────────────────────────────────────────────

	enum class BufferedAction : uint8_t { None, Attack, Skill1, Skill2 };
	BufferedAction bufferedAction = BufferedAction::None;
```

- [ ] **Step 3: Add `activeMovementMultiplier` to `CharacterController.hpp`**

After `bool canRotate;` (line 36 of `CharacterController.hpp`), add:

```cpp
	float activeMovementMultiplier = 1.0f;  // applied by CharacterControllerSystem; reset to 1.0f when no cast
```

Also update the default constructor initialiser list — add after `canRotate(true),`:

```cpp
		, activeMovementMultiplier(1.0f)
```

- [ ] **Step 4: Build to verify**

```bash
cd /path/to/project/backend && cargo build 2>&1 | tail -20
```

Expected: clean build (0 errors). The assert in `trigger()` is unreachable until Task 2 adds `castDuration > 0` to presets.

- [ ] **Step 5: Commit**

```bash
git add game-core/src/Skills.hpp \
        game-core/src/components/CombatController.hpp \
        game-core/src/components/CharacterController.hpp
git commit -m "feat(game): add cast duration tracking to SkillDefinition, buffered action to CombatController, movement multiplier to CharacterController"
```

---

## Task 2: Knight Preset — 3-Stage Chain and Cast Durations

**Files:**
- Modify: `game-core/src/Presets.hpp`

- [ ] **Step 1: Replace Knight's `combat` block in `Presets.hpp`**

Replace lines 37–65 (from `.combat = {` to the closing `},`) with:

```cpp
		.combat = {
			.baseDamage         = 18.0f,
			.damageMultiplier   = 1.0f,
			.criticalChance     = 0.15f,
			.criticalMultiplier = 1.5f,
			.attackChain = {
				// Stage 0 — diagonal slice: quick opener
				{ .damageMultiplier=0.8f, .range=2.0f, .duration=0.45f,
				  .movementMultiplier=0.0f, .chainWindow=0.6f },
				// Stage 1 — horizontal slice: mid combo
				{ .damageMultiplier=0.9f, .range=2.2f, .duration=0.50f,
				  .movementMultiplier=0.0f, .chainWindow=0.5f },
				// Stage 2 — stab: heavy finisher, chain resets (chainWindow=0)
				{ .damageMultiplier=1.6f, .range=1.8f, .duration=0.60f,
				  .movementMultiplier=0.0f, .chainWindow=0.0f },
			},
			.skill1 = { .params = MeleeAOE{ .range=2.5f, .movementMultiplier=0.0f, .dmgMultiplier=1.8f },
			            .cooldown=5.0f, .castDuration=0.7f },
			.skill2 = { .params = MeleeAOE{ .range=2.0f, .movementMultiplier=0.7f, .dmgMultiplier=1.5f },
			            .cooldown=10.0f, .castDuration=0.5f },
		},
```

- [ ] **Step 2: Build to verify**

```bash
cd backend && cargo build 2>&1 | tail -20
```

Expected: clean build. The `assert(castDuration > 0)` in `trigger()` is now safe since both skills have `castDuration > 0`.

- [ ] **Step 3: Commit**

```bash
git add game-core/src/Presets.hpp
git commit -m "feat(game): replace Knight 2-stage chain with 3-stage chain, add skill cast durations"
```

---

## Task 3: CharacterControllerSystem — Remove Input Attack State, Add Speed Multiplier

**Files:**
- Modify: `game-core/src/systems/CharacterControllerSystem.hpp`

The spec says `CombatSystem` is the sole authority on `CharacterState::Attacking`. Lines 121–123 set it from raw input — remove them.

Also multiply movement speed by `activeMovementMultiplier` so skill2 (0.7× multiplier) slows movement during cast.

- [ ] **Step 1: Remove lines 121–123 from `CharacterControllerSystem.hpp`**

Delete this block (lines 120–123):

```cpp
	// Handle attacking state
	if (controller.input.isAttacking) {
		controller.setState(CharacterState::Attacking);
	}
```

- [ ] **Step 2: Apply `activeMovementMultiplier` to movement speed**

In `processCharacterMovement`, after the `isSprinting` state update (line 72), locate the `float speed = controller.getEffectiveSpeed();` line (line 76). Replace it with:

```cpp
	float speed = controller.getEffectiveSpeed() * controller.activeMovementMultiplier;
```

- [ ] **Step 3: Build to verify**

```bash
cd backend && cargo build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add game-core/src/systems/CharacterControllerSystem.hpp
git commit -m "feat(game): remove input-driven attack state from CharacterControllerSystem, apply activeMovementMultiplier to speed"
```

---

## Task 4: New Network Event Types — Full Bridge Stack

**Files:**
- Modify: `game-core/src/events/NetworkEvents.hpp`
- Modify: `game-core/src/cxx_bridge.hpp`
- Modify: `game-core/src/cxx_bridge.cpp`
- Modify: `backend/src/game/ffi.rs`
- Modify: `backend/src/game/messages.rs`
- Modify: `backend/src/game/game.rs`

All six files must change together: adding a new `NetworkEvent` variant in C++ propagates through the CXX bridge to Rust, and Rust's exhaustive match on `NetworkEvent` in `game.rs` requires the new arms.

- [ ] **Step 1: Add event structs and update variant in `NetworkEvents.hpp`**

Replace lines 27–34 of `game-core/src/events/NetworkEvents.hpp` (from `struct StateChangeEvent` to the closing `}`) with:

```cpp
struct StateChangeEvent {
	PlayerID       playerID;
	CharacterState state;
};

// Emitted by CombatSystem when a player starts an attack swing.
struct AttackStartedEvent {
	PlayerID playerID;
	uint8_t  chainStage;  // 0 = first hit, 1 = second, 2 = third
};

// Emitted by CombatSystem when a player activates a skill.
struct SkillUsedEvent {
	PlayerID playerID;
	uint8_t  skillSlot;   // 1 or 2
};

struct MatchEndEvent {};

using NetworkEvent = std::variant<
	DeathEvent,
	DamageEvent,
	SpawnEvent,
	StateChangeEvent,    // Stunned only — no longer emitted for Attacking/Casting
	MatchEndEvent,
	AttackStartedEvent,
	SkillUsedEvent
>;
```

- [ ] **Step 2: Update `cxx_bridge.hpp` — forward declarations and `EventQueue` accessors**

In `cxx_bridge.hpp`, after line 20 (`struct StateChangeEvent;`), add:

```cpp
struct AttackStartedEvent;
struct SkillUsedEvent;
```

Also find `enum class NetworkEventType : uint8_t;` (line 22) and replace the entire `EventQueue` struct (lines 26–35) with:

```cpp
/// Owned snapshot of the network event queue for one tick.
/// Returned by GameBridge::take_events() and consumed by Rust via indexed access.
struct EventQueue {
    std::vector<::ArenaGame::NetEvents::NetworkEvent> events;

    size_t len() const;
    NetworkEventType kind_at(size_t idx) const;
    DeathEvent         get_death_at(size_t idx) const;
    DamageEvent        get_damage_at(size_t idx) const;
    SpawnEvent         get_spawn_at(size_t idx) const;
    StateChangeEvent   get_state_change_at(size_t idx) const;
    AttackStartedEvent get_attack_started_at(size_t idx) const;
    SkillUsedEvent     get_skill_used_at(size_t idx) const;
};
```

- [ ] **Step 3: Implement new accessors in `cxx_bridge.cpp`**

In `cxx_bridge.cpp`, update `kind_at()` to handle the two new variants. Find the `kind_at` function (lines 139–156) and replace it entirely:

```cpp
NetworkEventType EventQueue::kind_at(size_t idx) const {
    return std::visit([](auto&& ev) -> NetworkEventType {
        using T = std::decay_t<decltype(ev)>;
        if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::DeathEvent>)
            return NetworkEventType::Death;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::DamageEvent>)
            return NetworkEventType::Damage;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::SpawnEvent>)
            return NetworkEventType::Spawn;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::StateChangeEvent>)
            return NetworkEventType::StateChange;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::AttackStartedEvent>)
            return NetworkEventType::AttackStarted;
        else if constexpr (std::is_same_v<T, ::ArenaGame::NetEvents::SkillUsedEvent>)
            return NetworkEventType::SkillUsed;
        else {
            static_assert(std::is_same_v<T, ::ArenaGame::NetEvents::MatchEndEvent>,
                "Unhandled NetworkEvent variant in kind_at");
            return NetworkEventType::MatchEnd;
        }
    }, events[idx]);
}
```

After the `get_state_change_at` function (after line 175), add:

```cpp
AttackStartedEvent EventQueue::get_attack_started_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::AttackStartedEvent>(events[idx]);
    return AttackStartedEvent{ ev.playerID, ev.chainStage };
}

SkillUsedEvent EventQueue::get_skill_used_at(size_t idx) const {
    const auto& ev = std::get<::ArenaGame::NetEvents::SkillUsedEvent>(events[idx]);
    return SkillUsedEvent{ ev.playerID, ev.skillSlot };
}
```

- [ ] **Step 4: Update `ffi.rs` — bridge structs, enum values, drain arms, NetworkEvent variants**

In `ffi.rs`, locate the `#[cxx::bridge]` block.

**4a.** In the `enum NetworkEventType` block (lines 16–23), add two values:

```rust
    enum NetworkEventType {
        Death = 1,
        Damage = 2,
        Spawn = 3,
        StateChange = 4,
        MatchEnd = 5,
        AttackStarted = 6,
        SkillUsed = 7,
    }
```

**4b.** After the `struct StateChangeEvent` block (after line 82), add:

```rust
    struct AttackStartedEvent {
        player_id: u32,
        chain_stage: u8,
    }

    struct SkillUsedEvent {
        player_id: u32,
        skill_slot: u8,
    }
```

**4c.** In the `unsafe extern "C++"` block, after `fn get_state_change_at(self: &EventQueue, idx: usize) -> StateChangeEvent;` (line 109), add:

```rust
        fn get_attack_started_at(self: &EventQueue, idx: usize) -> AttackStartedEvent;
        fn get_skill_used_at(self: &EventQueue, idx: usize) -> SkillUsedEvent;
```

**4d.** In the `pub enum NetworkEvent` block (lines 250–270), add two variants before `MatchEnd`:

```rust
    AttackStarted {
        player_id: u32,
        chain_stage: u8,
    },
    SkillUsed {
        player_id: u32,
        skill_slot: u8,
    },
```

**4e.** In `drain_network_events()`, replace `_ => unreachable!(),` with actual match arms. The full match block becomes:

```rust
        (0..queue.len())
            .map(|i| match queue.kind_at(i) {
                bridge::NetworkEventType::Death => {
                    let e = queue.get_death_at(i);
                    NetworkEvent::Death { killer: e.killer, victim: e.victim }
                }
                bridge::NetworkEventType::Damage => {
                    let e = queue.get_damage_at(i);
                    NetworkEvent::Damage { attacker: e.attacker, victim: e.victim, damage: e.damage }
                }
                bridge::NetworkEventType::Spawn => {
                    let e = queue.get_spawn_at(i);
                    NetworkEvent::Spawn {
                        player_id: e.player_id,
                        position: Vector3D { x: e.position.x, y: e.position.y, z: e.position.z },
                        character_class: e.character_class.to_string(),
                    }
                }
                bridge::NetworkEventType::StateChange => {
                    let e = queue.get_state_change_at(i);
                    NetworkEvent::StateChange { player_id: e.player_id, state: e.state }
                }
                bridge::NetworkEventType::AttackStarted => {
                    let e = queue.get_attack_started_at(i);
                    NetworkEvent::AttackStarted { player_id: e.player_id, chain_stage: e.chain_stage }
                }
                bridge::NetworkEventType::SkillUsed => {
                    let e = queue.get_skill_used_at(i);
                    NetworkEvent::SkillUsed { player_id: e.player_id, skill_slot: e.skill_slot }
                }
                bridge::NetworkEventType::MatchEnd => NetworkEvent::MatchEnd,
                _ => unreachable!(),
            })
            .collect()
```

- [ ] **Step 5: Update `messages.rs` — add new `GameServerMessage` variants**

In `messages.rs`, after `/// A player's state changed\nStateChange { player_id: u32, state: u8 },` (lines 32–33), add:

```rust
    /// A player started an attack swing
    AttackStarted { player_id: u32, chain_stage: u8 },

    /// A player activated a skill
    SkillUsed { player_id: u32, skill_slot: u8 },
```

- [ ] **Step 6: Update `game.rs` — add match arms for new events**

In `game.rs`, in the `for event in events` loop (lines 121–154), add two match arms after the `NetworkEvent::StateChange` arm:

```rust
                    NetworkEvent::AttackStarted { player_id, chain_stage } => {
                        GameServerMessage::AttackStarted { player_id, chain_stage }
                    }
                    NetworkEvent::SkillUsed { player_id, skill_slot } => {
                        GameServerMessage::SkillUsed { player_id, skill_slot }
                    }
```

- [ ] **Step 7: Build to verify all six layers compile together**

```bash
cd backend && cargo build 2>&1 | tail -30
```

Expected: clean build (0 errors, 0 warnings about unhandled variants).

- [ ] **Step 8: Commit**

```bash
git add game-core/src/events/NetworkEvents.hpp \
        game-core/src/cxx_bridge.hpp \
        game-core/src/cxx_bridge.cpp \
        backend/src/game/ffi.rs \
        backend/src/game/messages.rs \
        backend/src/game/game.rs
git commit -m "feat(game): add AttackStarted and SkillUsed events through the full C++→Rust→WS bridge"
```

---

## Task 5: CombatSystem Refactor — Buffer, Cast Tick, Event Emission

**Files:**
- Modify: `game-core/src/systems/CombatSystem.hpp`

This is the largest single-file change. It replaces the current `processInputAttacks` and extends `updateCooldowns`.

- [ ] **Step 1: Replace `processInputAttacks` implementation**

Find the `inline void CombatSystem::processInputAttacks()` function body (lines 145–210) and replace it entirely with:

```cpp
inline void CombatSystem::processInputAttacks() {
	using namespace Components;

	auto* ne = m_registry->try_get<Components::NetworkEventsComponent>(m_gameManager);

	auto view = m_registry->view<
		CharacterController,
		CombatController,
		Health,
		Transform,
		PhysicsBody
	>();

	view.each([&](entt::entity entity,
				  CharacterController& charcon,
				  CombatController&    comcon,
				  Health&              health,
				  Transform&           trans,
				  PhysicsBody&         physics) {

		if (!health.isAlive()) return;

		SkillContext ctx {
			*m_registry, entity,
			trans, physics, charcon, comcon, m_pendingHits
		};
		(void)ctx;  // ctx used below only in skill execution paths

		// Buffer any input that arrives while the character is committed to an action.
		// Last input wins — Skill2 > Skill1 > Attack due to assignment order.
		if (comcon.isAttacking || comcon.ability1.isCasting() || comcon.ability2.isCasting()) {
			if (charcon.input.isAttacking)      comcon.bufferedAction = BufferedAction::Attack;
			if (charcon.input.isUsingAbility1)  comcon.bufferedAction = BufferedAction::Skill1;
			if (charcon.input.isUsingAbility2)  comcon.bufferedAction = BufferedAction::Skill2;
			return;
		}

		// Normal path — consume buffered action or live input.
		BufferedAction toFire = comcon.bufferedAction;
		comcon.bufferedAction = BufferedAction::None;

		const bool wantsAttack = charcon.input.isAttacking     || toFire == BufferedAction::Attack;
		const bool wantsSkill1 = charcon.input.isUsingAbility1 || toFire == BufferedAction::Skill1;
		const bool wantsSkill2 = charcon.input.isUsingAbility2 || toFire == BufferedAction::Skill2;

		// Priority: Skill2 > Skill1 > Attack
		if (wantsSkill2 && comcon.canUseAbility2()) {
			fprintf(stderr, "[COMBAT] ABILITY2 entity=%u  cd=%.2f\n",
				static_cast<unsigned>(entity), static_cast<double>(comcon.ability2.timer));
			comcon.ability2.trigger();
			charcon.setState(CharacterState::Casting);
			std::visit(overloaded{
				[&](const MeleeAOE& s) {
					if (s.movementMultiplier == 0.0f)
						charcon.canMove = false;
					else if (s.movementMultiplier < 1.0f)
						charcon.activeMovementMultiplier = s.movementMultiplier;
				}
			}, comcon.ability2.params);
			if (ne) ne->events.push_back(NetEvents::SkillUsedEvent{ getPlayerID(entity), 2u });

		} else if (wantsSkill1 && comcon.canUseAbility1()) {
			fprintf(stderr, "[COMBAT] ABILITY1 entity=%u  cd=%.2f\n",
				static_cast<unsigned>(entity), static_cast<double>(comcon.ability1.timer));
			comcon.ability1.trigger();
			charcon.setState(CharacterState::Casting);
			std::visit(overloaded{
				[&](const MeleeAOE& s) {
					if (s.movementMultiplier == 0.0f)
						charcon.canMove = false;
					else if (s.movementMultiplier < 1.0f)
						charcon.activeMovementMultiplier = s.movementMultiplier;
				}
			}, comcon.ability1.params);
			if (ne) ne->events.push_back(NetEvents::SkillUsedEvent{ getPlayerID(entity), 1u });

		} else if (wantsAttack && comcon.canPerformAttack()) {
			const AttackStage& stage = comcon.currentStage();
			fprintf(stderr, "[COMBAT] ATTACK  entity=%u  chain_stage=%d  range=%.1f  dmg_mul=%.2f  base_dmg=%.1f\n",
				static_cast<unsigned>(entity), comcon.chainStage,
				static_cast<double>(stage.range), static_cast<double>(stage.damageMultiplier),
				static_cast<double>(comcon.baseDamage));

			uint8_t stageNum = static_cast<uint8_t>(comcon.chainStage);  // read BEFORE startAttack
			comcon.startAttack();
			comcon.hitPending = true;
			charcon.setState(CharacterState::Attacking);
			if (stage.movementMultiplier == 0.0f)
				charcon.canMove = false;
			if (ne) ne->events.push_back(NetEvents::AttackStartedEvent{ getPlayerID(entity), stageNum });
		}
	});
}
```

- [ ] **Step 2: Extend `updateCooldowns` to tick skill casts**

In `updateCooldowns`, add `Health` to the view. Find the view declaration (line 322):

```cpp
	auto view = m_registry->view<CombatController, CharacterController, Transform, PhysicsBody>();
```

Replace with:

```cpp
	auto view = m_registry->view<CombatController, CharacterController, Health, Transform, PhysicsBody>();
```

Update the lambda signature (line 324):

```cpp
	view.each([&](entt::entity entity, CombatController& combat, CharacterController& controller,
				  Health& health, Transform& trans, PhysicsBody& physics) {
```

Then, after the existing chain/swing logic (after the closing brace of "Reset CharacterState when swing ends", around line 369), add the skill cast tick **before** the closing `});`:

```cpp
		// Tick skill cast timers — deferred hit fires when castTimer reaches zero
		auto tickSkill = [&](SkillDefinition& skill, uint8_t /*slot*/) {
			if (!skill.isCasting()) return;
			skill.castTimer -= deltaTime;
			if (skill.castTimer <= 0.0f) {
				skill.endCast();
				if (skill.hitPending) {
					if (health.isAlive()) {
						SkillContext ctx{ *m_registry, entity, trans, physics, controller, combat, m_pendingHits };
						executeSkill(skill, ctx);
					}
					skill.hitPending = false;
				}
				// Restore movement locked by this skill (only if alive — death path owns its own reset)
				if (!controller.isDead()) {
					std::visit(overloaded{
						[&](const MeleeAOE& s) {
							if (s.movementMultiplier == 0.0f)
								controller.canMove = true;
							else if (s.movementMultiplier > 0.0f && s.movementMultiplier < 1.0f)
								controller.activeMovementMultiplier = 1.0f;
						}
					}, skill.params);
				}
			}
		};
		tickSkill(combat.ability1, 1);
		tickSkill(combat.ability2, 2);
```

- [ ] **Step 3: Build to verify**

```bash
cd backend && cargo build 2>&1 | tail -30
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add game-core/src/systems/CombatSystem.hpp
git commit -m "feat(game): replace input-driven attack/skill handling with buffer+cast-tick system, emit AttackStarted/SkillUsed events"
```

---

## Task 6: TypeScript Types and Character Configs

**Files:**
- Modify: `frontend/src/game/types.ts`
- Modify: `frontend/src/game/characterConfigs.ts`
- Modify: `frontend/src/game/AnimatedCharacter.ts`

- [ ] **Step 1: Add new variants to `types.ts`**

In `types.ts`, replace the `GameServerMessage` type (lines 34–42) with:

```typescript
export type GameServerMessage =
	| ({ type: 'Snapshot' } & GameStateSnapshot)
	| { type: 'PlayerLeft'; player_id: number }
	| { type: 'Death'; killer: number; victim: number }
	| { type: 'Damage'; attacker: number; victim: number; damage: number }
	| { type: 'Spawn'; player_id: number; position: Vector3D; name: string; character_class: string }
	| { type: 'StateChange'; player_id: number; state: number }
	| { type: 'AttackStarted'; player_id: number; chain_stage: number }
	| { type: 'SkillUsed'; player_id: number; skill_slot: number }
	| { type: 'MatchEnd' }
	| { type: 'Error'; message: string };
```

Replace the `GameEvent` type (lines 44–48) with:

```typescript
/** Subset of GameServerMessage that represents in-game events (not snapshots or meta). */
export type GameEvent = Extract<
	GameServerMessage,
	{ type: 'Death' | 'Damage' | 'Spawn' | 'StateChange' | 'AttackStarted' | 'SkillUsed' | 'MatchEnd' }
>;
```

- [ ] **Step 2: Add animation arrays to `CharacterConfig` and Knight config**

In `characterConfigs.ts`, replace the `CharacterConfig` interface (lines 20–27) with:

```typescript
export interface CharacterConfig {
	label: string;
	model: string;
	animationSets: string[];
	equipment: EquipmentSlot[];
	scale: number;
	previewBgColor: string;
	idleAnimation: string;
	attackAnimations: string[];  // [stage0, stage1, stage2, ...] — index = chain stage
	skillAnimations:  string[];  // [skill1anim, skill2anim] — index = slot - 1
}
```

In the Knight config (lines 32–41), add after `idleAnimation: 'Idle_A',`:

```typescript
		attackAnimations: [
			'Melee_1H_Attack_Slice_Diagonal',    // stage 0
			'Melee_1H_Attack_Slice_Horizontal',  // stage 1
			'Melee_1H_Attack_Stab',              // stage 2
		],
		skillAnimations: [
			'Melee_1H_Attack_Jump_Chop',  // skill1
			'Melee_1H_Attack_Chop',       // skill2 — placeholder; replace with a distinct anim later
		],
```

In the Rogue config (lines 43–52), add after `idleAnimation: 'Idle_A',`:

```typescript
		attackAnimations: ['Melee_Dualwield_Attack_Chop'],  // placeholder until Rogue chain is designed
		skillAnimations:  ['Melee_Dualwield_Attack_Chop'],  // placeholder
```

- [ ] **Step 3: Make `currentAnimation` readable in `AnimatedCharacter.ts`**

In `AnimatedCharacter.ts` line 10, change:

```typescript
	private currentAnimation: AnimationGroup | null = null;
```

to:

```typescript
	public currentAnimation: AnimationGroup | null = null;
```

- [ ] **Step 4: Typecheck to verify**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors. (The `SimpleGameClient.tsx` still uses the old `CharacterConfig` type — it will show errors until Task 7 updates it.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/game/types.ts \
        frontend/src/game/characterConfigs.ts \
        frontend/src/game/AnimatedCharacter.ts
git commit -m "feat(frontend): add AttackStarted/SkillUsed to GameServerMessage/GameEvent, animation arrays to CharacterConfig"
```

---

## Task 7: TypeScript Client — Event Handling, Animation Refactor, Ability Inputs

**Files:**
- Modify: `frontend/src/contexts/GameContext.tsx`
- Modify: `frontend/src/components/GameBoard/SimpleGameClient.tsx`

This task wires ability key inputs through to the server and replaces the animation state machine in the game client.

- [ ] **Step 1: Add ability inputs to `GameContext.tsx`**

In `GameContext.tsx`, find the `GameContextType` interface `sendInput` signature (lines 125–131). Replace with:

```typescript
	sendInput(
		movement: Vector3D,
		lookDirection: Vector3D,
		attacking: boolean,
		jumping: boolean,
		sprinting: boolean,
		ability1: boolean,
		ability2: boolean,
	): void;
```

Find the `sendInput` `useCallback` (lines 286–310). Replace with:

```typescript
	const sendInput = useCallback(
		(
			movement: Vector3D,
			lookDirection: Vector3D,
			attacking: boolean,
			jumping: boolean,
			sprinting: boolean,
			ability1: boolean,
			ability2: boolean,
		) => {
			if (
				gameStateRef.current.status !== 'active' ||
				!sendRef.current ||
				isSpectatorRef.current
			)
				return;
			sendRef.current({
				type: 'Input',
				movement,
				look_direction: lookDirection,
				attacking,
				jumping,
				sprinting,
				ability1,
				ability2,
			});
		},
		[], // stable — all state accessed via refs
	);
```

- [ ] **Step 2: Update `SimpleGameClient.tsx` — `Props.onSendInput` signature**

In `SimpleGameClient.tsx`, find the `Props` interface `onSendInput` (lines 543–549). Replace with:

```typescript
	onSendInput: (
		movement: Vector3D,
		lookDirection: Vector3D,
		attacking: boolean,
		jumping: boolean,
		sprinting: boolean,
		ability1: boolean,
		ability2: boolean,
	) => void;
```

- [ ] **Step 3: Update `GameClient` class — add `characterConfigMap` and typed `currentAnimState`**

At the top of the `GameClient` class, find:

```typescript
	private currentAnimState: string = 'idle';
```

Replace with:

```typescript
	type LocalAnimState = '' | 'attack' | 'skill';
	private currentAnimState: LocalAnimState = '';
	private characterConfigMap: Map<number, CharacterConfig> = new Map();
```

Note: `type LocalAnimState` needs to be defined outside the class or as a module-level type. Add it before the `class GameClient` line:

```typescript
type LocalAnimState = '' | 'attack' | 'skill';
```

Then inside the class, change the field declaration to:

```typescript
	private currentAnimState: LocalAnimState = '';
	private characterConfigMap: Map<number, CharacterConfig> = new Map();
```

- [ ] **Step 4: Add `Casting` to `CharacterState` and add `getChar` helper**

Find the `CharacterState` object (lines 40–47). Add `Casting: 4` after `Attacking: 3`:

```typescript
const CharacterState = {
	Idle: 0,
	Walking: 1,
	Sprinting: 2,
	Attacking: 3,
	Casting: 4,
	Stunned: 5,
	Dead: 6,
} as const;
```

Add a private helper method to `GameClient` (add it after `createEnemyBar`):

```typescript
	private getChar(playerID: number): AnimatedCharacter | null {
		if (playerID === this.localPlayerID) return this.localCharacter;
		return this.characters.get(playerID) ?? null;
	}
```

- [ ] **Step 5: Populate `characterConfigMap` in `initLocalPlayer` and `createRemoteCharacter`**

In `initLocalPlayer()`, after `await loadCharacter(this.localCharacter, this.characterConfig);` (line 261), add:

```typescript
		this.characterConfigMap.set(this.localPlayerID, this.characterConfig);
```

In `createRemoteCharacter()`, after `const config = ...` (the config resolution block ending around line 395), add before `await loadCharacter(remoteChar, config);`:

```typescript
			this.characterConfigMap.set(playerID, config);
```

- [ ] **Step 6: Remove the private `playAnimation` helper and update `initLocalPlayer`**

Remove the private `playAnimation` method (lines 271–278):

```typescript
	private playAnimation(state: string, loop: boolean = true): void {
		if (this.currentAnimState === state) return;
		const animName = AnimationNames[state as keyof typeof AnimationNames];
		if (animName && this.localCharacter) {
			this.localCharacter.playAnimation(animName, loop);
			this.currentAnimState = state;
		}
	}
```

In `initLocalPlayer`, replace the `setTimeout` callback to not use the helper:

```typescript
		setTimeout(() => {
			this.currentAnimState = '';
			this.localCharacter?.playAnimation(AnimationNames.idle, true);
		}, 1500);
```

- [ ] **Step 7: Update `processEvents` to handle `AttackStarted` and `SkillUsed`**

Replace the `processEvents` method body (lines 501–531) with:

```typescript
	processEvents(events: GameEvent[]) {
		for (const event of events) {
			switch (event.type) {
				case 'Death':
					console.debug('[Game] Death: killer=%d victim=%d', event.killer, event.victim);
					break;
				case 'Damage':
					console.debug('[Game] Damage: %d → %d (%.1f)', event.attacker, event.victim, event.damage);
					break;
				case 'Spawn':
					console.debug('[Game] Spawn: player=%d', event.player_id);
					if (event.player_id === this.localPlayerID) {
						this.localIsDead = false;
						this.currentAnimState = '';
					}
					break;
				case 'StateChange':
					console.debug('[Game] StateChange: player=%d state=%d', event.player_id, event.state);
					break;
				case 'AttackStarted': {
					const config = this.characterConfigMap.get(event.player_id);
					const anim = config?.attackAnimations[event.chain_stage];
					if (anim) this.getChar(event.player_id)?.playAnimation(anim, false);
					if (event.player_id === this.localPlayerID) this.currentAnimState = 'attack';
					break;
				}
				case 'SkillUsed': {
					const config = this.characterConfigMap.get(event.player_id);
					const anim = config?.skillAnimations[event.skill_slot - 1];
					if (anim) this.getChar(event.player_id)?.playAnimation(anim, false);
					if (event.player_id === this.localPlayerID) this.currentAnimState = 'skill';
					break;
				}
				case 'MatchEnd':
					console.debug('[Game] MatchEnd');
					break;
			}
		}
	}
```

- [ ] **Step 8: Rename `updateRemoteAnimation` → `updateSnapshotFallbackAnimation` with new signature**

Replace the `updateRemoteAnimation` method (lines 417–463) with:

```typescript
	private updateSnapshotFallbackAnimation(
		char: AnimatedCharacter,
		charData: CharacterSnapshot,
		config: CharacterConfig,
		jumpState: JumpState,
	): void {
		if (jumpState !== JumpState.GROUNDED) return;

		switch (charData.state) {
			case CharacterState.Attacking:
				// Fallback for latecomers who missed the AttackStarted event.
				// Always plays attackAnimations[0] — snapshot has no chain stage.
				if (!char.currentAnimation?.isPlaying)
					char.playAnimation(config.attackAnimations[0], true);
				break;
			case CharacterState.Casting:
				// Fallback for latecomers who missed the SkillUsed event.
				// Always plays skillAnimations[0] — snapshot has no skill slot.
				if (!char.currentAnimation?.isPlaying)
					char.playAnimation(config.skillAnimations[0], true);
				break;
			case CharacterState.Dead:
				if (char.animationName !== AnimationNames.death &&
					char.animationName !== AnimationNames.deathPose) {
					const deathAnim = char.animations.get(AnimationNames.death);
					char.playAnimation(AnimationNames.death, false);
					if (deathAnim) {
						deathAnim.onAnimationGroupEndObservable.addOnce(() => {
							char.playAnimation(AnimationNames.deathPose, false);
						});
					}
				}
				break;
			case CharacterState.Stunned:
				char.playAnimation(AnimationNames.hit, false);
				break;
			case CharacterState.Walking:
				char.playAnimation(AnimationNames.walk, true);
				break;
			case CharacterState.Sprinting:
				char.playAnimation(AnimationNames.run, true);
				break;
			default:
				char.playAnimation(AnimationNames.idle, true);
				break;
		}
	}
```

Update the call site in `processSnapshot`. Find `this.updateRemoteAnimation(char.player_id, remoteChar, char);` (line 350) and replace with:

```typescript
					const remoteJumpState = this.remoteJumpStates.get(char.player_id) ?? JumpState.GROUNDED;
					const isGrounded = char.position.y <= 1.1;
					const newJumpState = tickJumpState(remoteChar, remoteJumpState, isGrounded, false);
					this.remoteJumpStates.set(char.player_id, newJumpState);
					const remoteConfig = this.characterConfigMap.get(char.player_id);
					if (remoteConfig) this.updateSnapshotFallbackAnimation(remoteChar, char, remoteConfig, newJumpState);
```

- [ ] **Step 9: Refactor `updateLocalAnimation` to typed state machine**

Replace the `updateLocalAnimation` method (lines 465–499) with:

```typescript
	updateLocalAnimation(input: InputState): void {
		if (!this.localCharacter || this.localIsDead) return;

		const isGrounded = this.position.y <= 1.1;
		this.jumpState = tickJumpState(this.localCharacter, this.jumpState, isGrounded, input.isJumping);
		if (this.jumpState !== JumpState.GROUNDED) return;

		const isPlaying = this.localCharacter.currentAnimation?.isPlaying ?? false;
		const isMoving  = input.movementDirection.x !== 0 || input.movementDirection.z !== 0;

		if (this.currentAnimState === 'attack') {
			if (!isPlaying) {
				this.currentAnimState = '';           // animation finished — fall through to movement
			} else if (isMoving) {
				this.currentAnimState = '';           // movement cancels attack animation
				this.localCharacter.playAnimation(
					input.isSprinting ? AnimationNames.run : AnimationNames.walk, true);
				return;
			} else {
				return;                               // attack still playing, no movement — wait
			}
		}

		if (this.currentAnimState === 'skill') {
			if (!isPlaying) {
				this.currentAnimState = '';           // cast finished — fall through to movement
			} else {
				return;                               // skill plays to completion; movement does not cancel
			}
		}

		// currentAnimState === '' — normal movement/idle
		if (isMoving) {
			this.localCharacter.playAnimation(
				input.isSprinting ? AnimationNames.run : AnimationNames.walk, true);
		} else {
			this.localCharacter.playAnimation(AnimationNames.idle, true);
		}
	}
```

- [ ] **Step 10: Add ability key bindings and wire them through `onSendInput`**

In the `InputState` interface (lines 33–38), add ability fields:

```typescript
interface InputState {
	movementDirection: Vector3D;
	isAttacking: boolean;
	isJumping: boolean;
	isSprinting: boolean;
	isUsingAbility1: boolean;
	isUsingAbility2: boolean;
}
```

In the input initialisation (around line 710):

```typescript
			const input: InputState = {
				movementDirection: { x: 0, y: 0, z: 0 },
				isAttacking: false,
				isJumping: false,
				isSprinting: false,
				isUsingAbility1: false,
				isUsingAbility2: false,
			};
```

In the keyboard observable handler, add ability key triggers after the attack trigger (around line 722):

```typescript
				if (kbInfo.event.key.toLowerCase() === 'q' && !(kbInfo.event as KeyboardEvent).repeat)
					input.isUsingAbility1 = true;
				if (kbInfo.event.key.toLowerCase() === 'f' && !(kbInfo.event as KeyboardEvent).repeat)
					input.isUsingAbility2 = true;
```

In the render loop `onSendInput` call (around line 819), add the ability args:

```typescript
				onSendInput(
					input.movementDirection,
					lookDir,
					input.isAttacking,
					input.isJumping,
					input.isSprinting,
					input.isUsingAbility1,
					input.isUsingAbility2,
				);
```

After the `input.isAttacking = false;` line (line 763), add:

```typescript
				input.isUsingAbility1 = false; // clear one-shot trigger after processing
				input.isUsingAbility2 = false;
```

- [ ] **Step 11: Typecheck to verify**

```bash
cd frontend && npm run typecheck 2>&1 | tail -20
```

Expected: 0 errors.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/contexts/GameContext.tsx \
        frontend/src/components/GameBoard/SimpleGameClient.tsx
git commit -m "feat(frontend): event-driven combat animations, ability key bindings (Q/F), characterConfigMap, typed animation state machine"
```

---

## Self-Review

### Spec Coverage

| Spec section | Covered by |
|---|---|
| Idle flash fix (event-driven, not input-driven) | Tasks 3, 5, 7 |
| Animation asymmetry fix (same path for local + remote) | Task 7 (processEvents applies to all player IDs) |
| Correct hit timing for skills (deferred to cast end) | Tasks 1, 5 |
| Input buffering | Tasks 1, 5 |
| Skill cast duration + movement lock | Tasks 1, 2, 5 |
| Knight 3-stage chain | Task 2 |
| Per-class animation config | Tasks 6, 7 |
| `AttackStarted` / `SkillUsed` events end-to-end | Task 4 |
| `StateChange` narrowed to Stunned | Task 5 (removed Attacking/Casting emissions) |
| Snapshot fallback for latecomers | Task 7 (`updateSnapshotFallbackAnimation`) |
| `activeMovementMultiplier` (partial speed) | Tasks 1, 3, 5 |

### Known Limitations (accepted by spec)

- Snapshot fallback always plays index-0 animation (no chain stage / skill slot in snapshot)
- Attack-cancel visual desync: moving cancels client animation while server damage still fires
- Skill2 visual slide: 70% speed during cast but client plays skill animation without movement blend

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-09-combat-animation-system.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session using executing-plans skill, batch execution with checkpoints

**Which approach?**
