# Stamina System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative stamina resource system that gates sprinting, attacking, skills, and jumping, with scaled regen and exhaustion mechanics.

**Architecture:** New `Stamina` ECS component mirroring the `Health` pattern, a dedicated `StaminaSystem` running in `lateUpdate` for regen, and integration points in `CombatSystem` (attack/skill gating) and `CharacterControllerSystem` (sprint/jump gating). Snapshot pipeline carries stamina to frontend through the existing C++→Rust→TypeScript path.

**Tech Stack:** C++17 (game-core ECS), Rust (backend FFI bridge), TypeScript (frontend types)

**Spec:** `docs/superpowers/specs/2026-04-10-stamina-system-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `game-core/src/components/Stamina.hpp` | Stamina ECS component — data + convenience methods |
| `game-core/src/systems/StaminaSystem.hpp` | Stamina regen system — owns exhaustion detection + scaled regen |

### Modified Files
| File | Change |
|------|--------|
| `game-core/src/Skills.hpp` | Add `staminaCost` field to `AttackStage` and `SkillDefinition` |
| `game-core/src/CharacterPreset.hpp` | Add `StaminaPreset` struct, add `stamina` field to `CharacterPreset` |
| `game-core/src/Presets.hpp` | Populate Knight stamina values, add `staminaCost` to attack stages and skills |
| `game-core/src/core/World.hpp` | Include `StaminaSystem.hpp`, register system, attach component on entity creation, restore on respawn |
| `game-core/src/systems/CombatSystem.hpp` | Include `Stamina.hpp`, add stamina checks before attacks/skills, consume on completion |
| `game-core/src/systems/CharacterControllerSystem.hpp` | Include `Stamina.hpp`, add sprint drain, jump cost, sprint disable on exhaustion |
| `game-core/src/ArenaGame.hpp` | Add `stamina`/`maxStamina` to `CharacterSnapshot`, populate in `createSnapshot()` |
| `game-core/src/cxx_bridge.cpp` | Add stamina fields to bridge snapshot mapping |
| `backend/src/game/ffi.rs` | Add `stamina`/`max_stamina` to CXX bridge struct, Rust struct, and `From` impl |
| `frontend/src/game/types.ts` | Add `stamina`/`max_stamina` to `CharacterSnapshot` interface |

---

### Task 1: Add `staminaCost` to `AttackStage` and `SkillDefinition`

**Files:**
- Modify: `game-core/src/Skills.hpp:17-31`

- [ ] **Step 1: Add `staminaCost` to `SkillDefinition`**

In `game-core/src/Skills.hpp`, add after line 20 (`float castDuration = 0.0f;`):

```cpp
	float staminaCost  = 0.0f;  // stamina consumed when cast completes
```

- [ ] **Step 2: Add `staminaCost` to `AttackStage`**

In the same file, add after line 30 (`float attackAngle = 1.047f;`):

```cpp
	float staminaCost  = 0.0f;  // stamina consumed when this swing completes
```

- [ ] **Step 3: Verify build**

Run: `make build` (or the project's build command)
Expected: Compiles cleanly. Default `0.0f` means all existing code is unaffected.

- [ ] **Step 4: Commit**

```bash
git add game-core/src/Skills.hpp
git commit -m "feat(game): add staminaCost field to AttackStage and SkillDefinition"
```

---

### Task 2: Add `StaminaPreset` and wire into `CharacterPreset`

**Files:**
- Modify: `game-core/src/CharacterPreset.hpp:6-53`

- [ ] **Step 1: Add `StaminaPreset` struct**

In `game-core/src/CharacterPreset.hpp`, add after the `ColliderPreset` struct (after line 36, before `CombatPreset`):

```cpp
	struct StaminaPreset {
		float maxStamina;          // total stamina pool
		float baseRegenRate;       // max regen per second (at 100% stamina)
		float drainDelaySeconds;   // seconds of no regen after full depletion
		float sprintCostPerSec;    // stamina consumed per second while sprinting
		float jumpCost;            // flat stamina consumed per jump
	};
```

- [ ] **Step 2: Add `stamina` field to `CharacterPreset`**

In the same file, add `StaminaPreset stamina;` to the `CharacterPreset` struct, after `collider` and before `combat`:

```cpp
	struct CharacterPreset {
		HealthPreset   health;
		MovementPreset movement;
		ColliderPreset collider;
		StaminaPreset  stamina;    // NEW
		CombatPreset   combat;
	};
```

- [ ] **Step 3: Verify build**

Run: `make build`
Expected: Build fails — `Presets.hpp` does not initialize the new `stamina` field in KNIGHT. This is expected and fixed in Task 3.

- [ ] **Step 4: Commit**

```bash
git add game-core/src/CharacterPreset.hpp
git commit -m "feat(game): add StaminaPreset struct and wire into CharacterPreset"
```

---

### Task 3: Populate Knight preset with stamina values

**Files:**
- Modify: `game-core/src/Presets.hpp:10-57`

- [ ] **Step 1: Add Knight `StaminaPreset` values**

In `game-core/src/Presets.hpp`, insert the `.stamina` block after `.collider` (after line 35) and before `.combat`:

```cpp
		.stamina = {
			.maxStamina        = 100.0f,
			.baseRegenRate     = 40.0f,    // effective: 4.0/s (10% floor) to 40.0/s
			.drainDelaySeconds = 1.5f,     // pause after full depletion
			.sprintCostPerSec  = 15.0f,    // ~6.6s of continuous sprint
			.jumpCost          = 8.0f,     // ~12 jumps from full
		},
```

- [ ] **Step 2: Add `staminaCost` to attack chain stages**

In the same file, update the three `AttackStage` initializers to include `staminaCost`:

Stage 0 (line 43-44) — add `.staminaCost=10.0f` after `.chainWindow=0.6f`:
```cpp
			// Stage 0 — diagonal slice: quick opener
			{ .damageMultiplier=0.8f, .range=2.0f, .duration=0.45f,
			  .movementMultiplier=0.0f, .chainWindow=0.6f, .staminaCost=10.0f },
```

Stage 1 (line 46-47) — add `.staminaCost=15.0f` after `.chainWindow=0.5f`:
```cpp
			// Stage 1 — horizontal slice: mid combo
			{ .damageMultiplier=0.9f, .range=2.2f, .duration=0.50f,
			  .movementMultiplier=0.0f, .chainWindow=0.5f, .staminaCost=15.0f },
```

Stage 2 (line 49-50) — add `.staminaCost=25.0f` after `.chainWindow=0.0f`:
```cpp
			// Stage 2 — stab: heavy finisher, chain resets (chainWindow=0)
			{ .damageMultiplier=1.6f, .range=1.8f, .duration=0.60f,
			  .movementMultiplier=0.0f, .chainWindow=0.0f, .staminaCost=25.0f },
```

- [ ] **Step 3: Add `staminaCost` to skill definitions**

Update skill1 (line 52-53) and skill2 (line 54-55):

```cpp
			.skill1 = { .params = MeleeAOE{ .range=2.5f, .movementMultiplier=0.0f, .dmgMultiplier=1.8f },
			            .cooldown=5.0f, .castDuration=0.7f, .staminaCost=20.0f },
			.skill2 = { .params = MeleeAOE{ .range=2.0f, .movementMultiplier=0.7f, .dmgMultiplier=1.5f },
			            .cooldown=10.0f, .castDuration=0.5f, .staminaCost=30.0f },
```

- [ ] **Step 4: Verify build**

Run: `make build`
Expected: Compiles cleanly. The Knight preset now has all stamina values.

- [ ] **Step 5: Commit**

```bash
git add game-core/src/Presets.hpp
git commit -m "feat(game): populate Knight preset with stamina costs and regen values"
```

---

### Task 4: Create `Stamina` component

**Files:**
- Create: `game-core/src/components/Stamina.hpp`

- [ ] **Step 1: Write the Stamina component**

Create `game-core/src/components/Stamina.hpp`:

```cpp
#pragma once

#include "../CharacterPreset.hpp"
#include <algorithm>
#include <cmath>

namespace ArenaGame {
namespace Components {

// =============================================================================
// Stamina - Resource pool for physical actions (sprint, attack, skill, jump)
// =============================================================================
// Pure data component with convenience methods. Mirrors Health pattern.
//
// Regen formula (applied by StaminaSystem in lateUpdate):
//   effectiveRate = max(baseRegenRate * current/maximum, baseRegenRate * 0.10)
//   → smooth curve: more stamina = faster regen, 10% floor prevents near-zero stall
//
// Exhaustion: when current hits 0, drainDelayTimer starts. No regen until it
// expires. Prevents stutter-loop of drain→regen→drain.
//
// Consumption is done by CombatSystem (attacks/skills) and
// CharacterControllerSystem (sprint/jump). This component only stores state.
// =============================================================================

struct Stamina {
	// Pool
	float current;
	float maximum;

	// Regen
	float baseRegenRate;      // max regen/s at 100% stamina
	float drainDelay;         // configured pause duration after full depletion
	float drainDelayTimer;    // runtime countdown (0 = not exhausted or delay expired)

	// State
	bool exhausted;           // true from depletion until drainDelayTimer expires

	// Per-class costs (copied from StaminaPreset at spawn)
	float sprintCostPerSec;   // continuous drain while sprinting
	float jumpCost;           // flat cost per jump

	// ── Constructors ────────────────────────────────────────────────────

	Stamina()
		: current(100.0f)
		, maximum(100.0f)
		, baseRegenRate(40.0f)
		, drainDelay(1.5f)
		, drainDelayTimer(0.0f)
		, exhausted(false)
		, sprintCostPerSec(15.0f)
		, jumpCost(8.0f)
	{}

	explicit Stamina(float maxStamina)
		: current(maxStamina)
		, maximum(maxStamina)
		, baseRegenRate(40.0f)
		, drainDelay(1.5f)
		, drainDelayTimer(0.0f)
		, exhausted(false)
		, sprintCostPerSec(15.0f)
		, jumpCost(8.0f)
	{}

	// ── Queries ─────────────────────────────────────────────────────────

	bool canAfford(float cost) const {
		return current >= cost;
	}

	bool isExhausted() const {
		return exhausted;
	}

	bool isFull() const {
		return current >= maximum;
	}

	float getPercent() const {
		return maximum > 0.0f ? (current / maximum) : 0.0f;
	}

	// ── Mutation ─────────────────────────────────────────────────────────

	void consume(float amount) {
		current = std::max(0.0f, current - amount);
	}

	void recover(float amount) {
		current = std::min(current + amount, maximum);
	}

	void restore() {
		current = maximum;
		exhausted = false;
		drainDelayTimer = 0.0f;
	}

	// ── Factory ─────────────────────────────────────────────────────────

	static Stamina createFromPreset(const StaminaPreset& preset) {
		Stamina s;
		s.maximum          = preset.maxStamina;
		s.current          = s.maximum;
		s.baseRegenRate    = preset.baseRegenRate;
		s.drainDelay       = preset.drainDelaySeconds;
		s.drainDelayTimer  = 0.0f;
		s.exhausted        = false;
		s.sprintCostPerSec = preset.sprintCostPerSec;
		s.jumpCost         = preset.jumpCost;
		return s;
	}
};

} // namespace Components
} // namespace ArenaGame
```

- [ ] **Step 2: Verify build**

Run: `make build`
Expected: Compiles cleanly. No other file includes Stamina.hpp yet.

- [ ] **Step 3: Commit**

```bash
git add game-core/src/components/Stamina.hpp
git commit -m "feat(game): add Stamina ECS component"
```

---

### Task 5: Create `StaminaSystem`

**Files:**
- Create: `game-core/src/systems/StaminaSystem.hpp`

- [ ] **Step 1: Write the StaminaSystem**

Create `game-core/src/systems/StaminaSystem.hpp`:

```cpp
#pragma once

#include "System.hpp"
#include "../components/Stamina.hpp"
#include "../components/CharacterController.hpp"
#include "../components/CombatController.hpp"
#include "../components/Health.hpp"
#include "../../entt/entt.hpp"
#include <algorithm>

namespace ArenaGame {

// =============================================================================
// StaminaSystem - Stamina regeneration (runs in lateUpdate)
// =============================================================================
// Sole owner of regen logic. Does NOT consume stamina — that is done by
// CombatSystem (attacks/skills) and CharacterControllerSystem (sprint/jump).
//
// Responsibilities:
//   1. Detect full depletion → set exhausted flag + start drain delay timer
//   2. Tick drain delay timer during exhaustion
//   3. Clear exhaustion when delay expires
//   4. Apply scaled regen when player is not actively consuming stamina
//
// Regen formula:
//   effectiveRate = max(baseRegenRate * (current / maximum), baseRegenRate * 0.10)
//   → 10% floor prevents infinitely slow recovery near zero
//
// Runs in lateUpdate (after CharacterControllerSystem in earlyUpdate and
// CombatSystem in update) so all consumption for the current frame is already
// applied before regen ticks.
// =============================================================================

class StaminaSystem : public System {
public:
	StaminaSystem() = default;

	void lateUpdate(float deltaTime) override;
	const char* getName() const override { return "StaminaSystem"; }
	bool needsLateUpdate() const override { return true; }
	bool needsUpdate() const override { return false; }
};

// =============================================================================
// Implementation
// =============================================================================

inline void StaminaSystem::lateUpdate(float deltaTime) {
	auto view = m_registry->view<
		Components::Stamina,
		Components::CharacterController,
		Components::CombatController,
		Components::Health
	>();

	view.each([&](Components::Stamina& stamina,
				  Components::CharacterController& controller,
				  Components::CombatController& combat,
				  Components::Health& health) {

		// 1. Dead players don't regen
		if (!health.isAlive()) return;

		// 2. Detect full depletion → enter exhaustion
		if (stamina.current <= 0.0f && !stamina.exhausted) {
			stamina.exhausted = true;
			stamina.drainDelayTimer = stamina.drainDelay;
		}

		// 3. Tick drain delay during exhaustion
		if (stamina.exhausted) {
			stamina.drainDelayTimer -= deltaTime;
			if (stamina.drainDelayTimer <= 0.0f) {
				stamina.exhausted = false;
				stamina.drainDelayTimer = 0.0f;
			} else {
				return;  // no regen during drain delay
			}
		}

		// 4. No regen while actively spending stamina
		if (controller.isSprinting) return;
		if (combat.isAttacking) return;
		if (combat.isAbility1Casting()) return;
		if (combat.isAbility2Casting()) return;

		// 5. Scaled regen with 10% minimum floor
		float ratio = stamina.current / stamina.maximum;
		float effectiveRate = stamina.baseRegenRate * ratio;
		effectiveRate = std::max(effectiveRate, stamina.baseRegenRate * 0.10f);

		stamina.current = std::min(stamina.current + effectiveRate * deltaTime, stamina.maximum);
	});
}

} // namespace ArenaGame
```

- [ ] **Step 2: Verify build**

Run: `make build`
Expected: Compiles cleanly. Not registered yet, so it doesn't run.

- [ ] **Step 3: Commit**

```bash
git add game-core/src/systems/StaminaSystem.hpp
git commit -m "feat(game): add StaminaSystem with scaled regen and exhaustion"
```

---

### Task 6: Register `StaminaSystem` and attach `Stamina` component to entities

**Files:**
- Modify: `game-core/src/core/World.hpp:1-26` (includes), `161-198` (initialize), `287-301` (createActor), `421-440` (respawnPlayer)

- [ ] **Step 1: Add includes**

In `game-core/src/core/World.hpp`, add after line 7 (`#include "../components/Health.hpp"`):

```cpp
#include "../components/Stamina.hpp"
```

And add after line 23 (`#include "../systems/GameModeSystem.hpp"`):

```cpp
#include "../systems/StaminaSystem.hpp"
```

- [ ] **Step 2: Register StaminaSystem in `World::initialize()`**

In the `initialize()` method, add after line 167 (`auto gameModeSystem = ...`):

```cpp
	auto staminaSystem = std::make_unique<StaminaSystem>();
```

Add after line 176 (`gameModeSystem->setRegistry(&m_registry);`):

```cpp
	staminaSystem->setRegistry(&m_registry);
```

Add after line 184 (`gameModeSystem->setGameManager(m_gameManager);`):

```cpp
	staminaSystem->setGameManager(m_gameManager);
```

Add after line 198 (`m_systemManager.addSystem(std::move(gameModeSystem));`):

```cpp
	m_systemManager.addSystem(std::move(staminaSystem));
```

- [ ] **Step 3: Attach Stamina component in `createActor()`**

In `createActor()`, add after line 298 (`m_registry.emplace<Components::Health>(entity, ...)`):

```cpp
	m_registry.emplace<Components::Stamina>(entity, Components::Stamina::createFromPreset(preset.stamina));
```

- [ ] **Step 4: Restore stamina on respawn**

In `respawnPlayer()`, add after line 431 (`if (health) health->revive();`):

```cpp
	auto* stamina = m_registry.try_get<Components::Stamina>(player);
	if (stamina) stamina->restore();
```

- [ ] **Step 5: Verify build**

Run: `make build`
Expected: Compiles cleanly. `StaminaSystem` is now registered and `Stamina` component is attached to all actors.

- [ ] **Step 6: Commit**

```bash
git add game-core/src/core/World.hpp
git commit -m "feat(game): register StaminaSystem and attach Stamina component to entities"
```

---

### Task 7: Integrate stamina into `CombatSystem`

**Files:**
- Modify: `game-core/src/systems/CombatSystem.hpp:1-26` (includes), `215-276` (processInputAttacks), `409-434` (handleSwingEnd), `436-465` (tickSkillSlot)

- [ ] **Step 1: Add Stamina include**

In `game-core/src/systems/CombatSystem.hpp`, add after line 7 (`#include "../components/Health.hpp"`):

```cpp
#include "../components/Stamina.hpp"
```

- [ ] **Step 2: Add Stamina to the `processInputAttacks` view and lambda**

Update the view at line 220 to include `Components::Stamina`:

```cpp
	auto view = m_registry->view<CharacterController, CombatController, Health, Transform, PhysicsBody, Stamina>();
```

Update the lambda signature at lines 222-227 to include `Stamina& stamina`:

```cpp
	view.each([&](entt::entity entity,
				  CharacterController& charcon,
				  CombatController&    comcon,
				  Health&              health,
				  Transform&           trans,
				  PhysicsBody&         physics,
				  Stamina&             stamina) {
```

- [ ] **Step 3: Add stamina gating to skill2**

At line 248, wrap the existing `wantsSkill2` block with a stamina check. Replace:

```cpp
		if (wantsSkill2 && comcon.canUseAbility2()) {
```

With:

```cpp
		if (wantsSkill2 && comcon.canUseAbility2() && stamina.canAfford(comcon.ability2.staminaCost)) {
```

- [ ] **Step 4: Add stamina gating to skill1**

At line 254, replace:

```cpp
		} else if (wantsSkill1 && comcon.canUseAbility1()) {
```

With:

```cpp
		} else if (wantsSkill1 && comcon.canUseAbility1() && stamina.canAfford(comcon.ability1.staminaCost)) {
```

- [ ] **Step 5: Add stamina gating to attacks**

At line 260, replace:

```cpp
		} else if (wantsAttack && comcon.canPerformAttack()) {
```

With:

```cpp
		} else if (wantsAttack && comcon.canPerformAttack() && stamina.canAfford(comcon.currentStage().staminaCost)) {
```

- [ ] **Step 6: Discard unaffordable buffered actions**

After line 241 (`comcon.bufferedAction = CombatController::BufferedAction::None;`), add a stamina check that discards the buffered action if it became unaffordable:

```cpp
		// Discard buffered action if stamina is insufficient
		if (toFire == CombatController::BufferedAction::Attack
				&& !stamina.canAfford(comcon.currentStage().staminaCost))
			toFire = CombatController::BufferedAction::None;
		if (toFire == CombatController::BufferedAction::Skill1
				&& !stamina.canAfford(comcon.ability1.staminaCost))
			toFire = CombatController::BufferedAction::None;
		if (toFire == CombatController::BufferedAction::Skill2
				&& !stamina.canAfford(comcon.ability2.staminaCost))
			toFire = CombatController::BufferedAction::None;
```

- [ ] **Step 7: Consume stamina in `handleSwingEnd`**

In `handleSwingEnd()`, add stamina consumption before `combat.advanceChain()`. At line 421 (inside the `if (combat.hitPending)` block, after `const AttackStage& stage = combat.currentStage();`), add:

```cpp
			// Consume stamina for this swing stage (read BEFORE advanceChain)
			if (auto* stamina = m_registry->try_get<Components::Stamina>(entity))
				stamina->consume(stage.staminaCost);
```

The full modified block (lines 418-427) should read:

```cpp
	if (combat.hitPending) {
		if (health.isAlive()) {
			SkillContext ctx{ *m_registry, entity, trans, physics, controller, combat, m_pendingHits };
			const AttackStage& stage = combat.currentStage();
			// Consume stamina for this swing stage (read BEFORE advanceChain)
			if (auto* stamina = m_registry->try_get<Components::Stamina>(entity))
				stamina->consume(stage.staminaCost);
			hitInArc(ctx, stage.range, stage.damageMultiplier, stage.attackAngle);
			combat.advanceChain();
			fprintf(stderr, "[COMBAT] deferred_hit applied  next_chain_stage=%d\n", combat.chainStage);
		}
		combat.hitPending = false;
	}
```

- [ ] **Step 8: Consume stamina in `tickSkillSlot`**

In `tickSkillSlot()`, add stamina consumption after the cast finishes. At line 453 (inside `if (hitPending)`, before `SkillContext ctx`), add:

```cpp
		// Consume stamina when cast completes
		if (auto* stamina = m_registry->try_get<Components::Stamina>(entity))
			stamina->consume(def.staminaCost);
```

The full modified block (lines 453-459) should read:

```cpp
	if (hitPending) {
		// Consume stamina when cast completes
		if (auto* stamina = m_registry->try_get<Components::Stamina>(entity))
			stamina->consume(def.staminaCost);
		if (health.isAlive()) {
			SkillContext ctx{ *m_registry, entity, trans, physics, controller, combat, m_pendingHits };
			executeSkill(def, ctx);
		}
		hitPending = false;
	}
```

- [ ] **Step 9: Verify build**

Run: `make build`
Expected: Compiles cleanly.

- [ ] **Step 10: Commit**

```bash
git add game-core/src/systems/CombatSystem.hpp
git commit -m "feat(game): integrate stamina gating into CombatSystem"
```

---

### Task 8: Integrate stamina into `CharacterControllerSystem`

**Files:**
- Modify: `game-core/src/systems/CharacterControllerSystem.hpp:1-8` (includes), `45-58` (earlyUpdate), `60-126` (processCharacterMovement)

- [ ] **Step 1: Add includes**

In `game-core/src/systems/CharacterControllerSystem.hpp`, add after line 6 (`#include "../components/CharacterController.hpp"`):

```cpp
#include "../components/Stamina.hpp"
```

- [ ] **Step 2: Update `earlyUpdate` to get Stamina component**

Replace the view and lambda in `earlyUpdate()` (lines 47-57) with:

```cpp
	auto view = m_registry->view<
		Components::CharacterController,
		Components::PhysicsBody,
		Components::Transform,
		Components::Stamina
	>();

	view.each([&](Components::CharacterController& controller,
		Components::PhysicsBody& physics,
		Components::Transform& transform,
		Components::Stamina& stamina) {
		processCharacterMovement(controller, physics, transform, stamina, deltaTime);
		});
```

- [ ] **Step 3: Update `processCharacterMovement` signature**

Update the declaration at lines 33-38:

```cpp
	void processCharacterMovement(
		Components::CharacterController& controller,
		Components::PhysicsBody& physics,
		Components::Transform& transform,
		Components::Stamina& stamina,
		float deltaTime
	);
```

Update the definition at lines 60-65:

```cpp
inline void CharacterControllerSystem::processCharacterMovement(
	Components::CharacterController& controller,
	Components::PhysicsBody& physics,
	Components::Transform& transform,
	Components::Stamina& stamina,
	float deltaTime
) {
```

- [ ] **Step 4: Add sprint stamina drain**

Replace line 72 (`controller.isSprinting = controller.input.isSprinting;`) with:

```cpp
	// Sprint gating: require stamina and not exhausted
	if (controller.input.isSprinting) {
		float frameCost = stamina.sprintCostPerSec * deltaTime;
		if (!stamina.isExhausted() && stamina.canAfford(frameCost)) {
			stamina.consume(frameCost);
			controller.isSprinting = true;
		} else {
			controller.isSprinting = false;
		}
	} else {
		controller.isSprinting = false;
	}
```

- [ ] **Step 5: Add jump stamina check**

Replace lines 107-108:

```cpp
	if (controller.input.isJumping && controller.canJump && physics.isGrounded) {
		physics.velocity.y = controller.jumpVelocity;
```

With:

```cpp
	if (controller.input.isJumping && controller.canJump && physics.isGrounded
			&& stamina.canAfford(stamina.jumpCost)) {
		stamina.consume(stamina.jumpCost);
		physics.velocity.y = controller.jumpVelocity;
```

- [ ] **Step 6: Verify build**

Run: `make build`
Expected: Compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add game-core/src/systems/CharacterControllerSystem.hpp
git commit -m "feat(game): integrate stamina into sprint and jump gating"
```

---

### Task 9: Add stamina to the snapshot pipeline (C++ side)

**Files:**
- Modify: `game-core/src/ArenaGame.hpp:14-30` (CharacterSnapshot struct), `191-239` (createSnapshot)
- Modify: `game-core/src/cxx_bridge.cpp:107-122` (bridge mapping)

- [ ] **Step 1: Add include for Stamina component**

In `game-core/src/ArenaGame.hpp`, add after line 3 (`#include "core/World.hpp"`):

```cpp
#include "components/Stamina.hpp"
```

- [ ] **Step 2: Add fields to C++ `CharacterSnapshot`**

In `game-core/src/ArenaGame.hpp`, add after line 27 (`float swingProgress;`):

```cpp
	// Stamina data for HUD
	float stamina;
	float maxStamina;
```

- [ ] **Step 3: Add Stamina to `createSnapshot` view**

Update the view template at lines 200-207 to include `Components::Stamina`:

```cpp
	auto view = registry.view<
		Components::PlayerInfo,
		Components::Transform,
		Components::PhysicsBody,
		Components::Health,
		Components::CharacterController,
		Components::CombatController,
		Components::Stamina
	>();
```

Update the lambda at lines 210-215 to include `Components::Stamina& stam`:

```cpp
	view.each([&](Components::PlayerInfo& playerInfo,
				  Components::Transform& transform,
				  Components::PhysicsBody& physics,
				  Components::Health& health,
				  Components::CharacterController& controller,
				  Components::CombatController& combat,
				  Components::Stamina& stam) {
```

- [ ] **Step 4: Populate stamina snapshot fields**

Add after line 233 (`charSnapshot.swingProgress = ...`):

```cpp
		charSnapshot.stamina    = stam.current;
		charSnapshot.maxStamina = stam.maximum;
```

- [ ] **Step 5: Add stamina to CXX bridge mapping**

In `game-core/src/cxx_bridge.cpp`, update the `CharacterSnapshot` construction in `get_snapshot()` (lines 108-121). Add after `/* swing_progress    */` (line 120):

```cpp
            /* stamina           */ c.stamina,
            /* max_stamina       */ c.maxStamina,
```

- [ ] **Step 6: Verify build**

Run: `make build`
Expected: Build fails — Rust CXX bridge struct doesn't have the new fields yet. This is expected and fixed in Task 10.

- [ ] **Step 7: Commit**

```bash
git add game-core/src/ArenaGame.hpp game-core/src/cxx_bridge.cpp
git commit -m "feat(game): add stamina fields to C++ snapshot and CXX bridge"
```

---

### Task 10: Add stamina to the Rust FFI bridge

**Files:**
- Modify: `backend/src/game/ffi.rs:43-56` (bridge CharacterSnapshot), `198-212` (Rust CharacterSnapshot), `214-238` (From impl)

- [ ] **Step 1: Add fields to CXX bridge struct**

In `backend/src/game/ffi.rs`, add after line 55 (`swing_progress: f32,`):

```rust
        stamina: f32,
        max_stamina: f32,
```

- [ ] **Step 2: Add fields to Rust CharacterSnapshot**

In the same file, add after line 211 (`pub swing_progress: f32,`):

```rust
    pub stamina: f32,
    pub max_stamina: f32,
```

- [ ] **Step 3: Add fields to From impl**

In the `From<bridge::CharacterSnapshot>` impl, add after line 236 (`swing_progress: c.swing_progress,`):

```rust
            stamina: c.stamina,
            max_stamina: c.max_stamina,
```

- [ ] **Step 4: Verify build**

Run: `cargo build` (from `backend/` directory)
Expected: Compiles cleanly. Full pipeline is wired: C++ → CXX bridge → Rust.

- [ ] **Step 5: Commit**

```bash
git add backend/src/game/ffi.rs
git commit -m "feat(backend): add stamina fields to Rust FFI bridge"
```

---

### Task 11: Add stamina to frontend types

**Files:**
- Modify: `frontend/src/game/types.ts:10-24`

- [ ] **Step 1: Add fields to TypeScript `CharacterSnapshot`**

In `frontend/src/game/types.ts`, add after line 23 (`swing_progress: number;`):

```typescript
	// Stamina data
	stamina: number;
	max_stamina: number;
```

- [ ] **Step 2: Verify frontend build**

Run: `npm run build` (from `frontend/` directory)
Expected: Compiles cleanly. The frontend now receives stamina data in every snapshot.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/game/types.ts
git commit -m "feat(frontend): add stamina fields to CharacterSnapshot type"
```

---

### Task 12: Full integration build and smoke test

- [ ] **Step 1: Full build**

Run the full project build to verify all C++/Rust/TypeScript compile together:

```bash
make build
```

Expected: Clean build with no errors or warnings related to stamina.

- [ ] **Step 2: Verify snapshot pipeline**

Start the game server and connect a client. Verify that `CharacterSnapshot` objects arriving at the frontend contain `stamina` and `max_stamina` fields with expected values (100.0 for Knight at spawn).

- [ ] **Step 3: Manual smoke test**

Test each stamina behavior in-game:
1. **Sprint drain:** Hold sprint — character should slow to walk after ~6.6s
2. **Attack gating:** Spam attacks — after two full combos, attacks should stop
3. **Skill gating:** Use ability2 (cost 30) then ability1 (cost 20) — should work. Use both abilities + a combo — should hit stamina limit
4. **Jump cost:** Spam jump — should stop after ~12 jumps
5. **Regen:** After draining to 50%, stop all actions — should recover in ~1.7s
6. **Exhaustion:** Drain to 0% — should see 1.5s delay, then slow regen starting at floor rate
7. **Respawn:** Die and respawn — stamina should be full

- [ ] **Step 4: Final commit**

If any tweaks were needed during smoke testing, commit them:

```bash
git add -A
git commit -m "fix(game): stamina system tuning from smoke test"
```
