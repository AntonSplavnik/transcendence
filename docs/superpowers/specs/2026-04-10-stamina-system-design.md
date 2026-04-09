# Stamina System Design

## Overview

A server-authoritative stamina resource system that prevents infinite sprinting and attack spamming. Stamina gates all physical actions (sprinting, attacking, using skills, jumping) and regenerates at a rate proportional to current stamina percentage, rewarding conservation and punishing reckless resource spending.

## Goals

- **Prevent spam:** Players cannot endlessly chain attacks or sprint without consequence.
- **Create tactical rhythm:** The regen curve (more stamina = faster regen) rewards players who manage their resources and punishes those who drain to zero.
- **Class identity:** Per-class stamina costs and pools let character presets feel mechanically distinct (e.g. Knight's heavy swings cost more than a Rogue's quick strikes).
- **Consistent architecture:** Follow existing ECS patterns — the `Stamina` component mirrors `Health`, the `StaminaSystem` mirrors existing system conventions.

## Architecture

### Approach: Standalone Component + System

Stamina is implemented as a new ECS component (`Stamina`) with a dedicated system (`StaminaSystem`) owning regen logic. Existing systems (`CombatSystem`, `CharacterControllerSystem`) query the `Stamina` component for affordability checks and consume stamina at the appropriate moments.

This was chosen over embedding stamina into `CombatController` (split ownership between combat and movement) or extending `Health` (conflates two independent resources with different regen rules).

---

## Component Design

### StaminaPreset (pure data, lives in CharacterPreset)

Added to `CharacterPreset.hpp` alongside `HealthPreset`, `MovementPreset`, etc.

```cpp
struct StaminaPreset {
    float maxStamina;          // total stamina pool
    float baseRegenRate;       // maximum regen per second (achieved at 100% stamina)
    float drainDelaySeconds;   // seconds of no regen after stamina is fully depleted
    float sprintCostPerSec;    // stamina consumed per second while sprinting
    float jumpCost;            // flat stamina consumed per jump
};
```

Added to the root `CharacterPreset` struct:
```cpp
struct CharacterPreset {
    HealthPreset health;
    MovementPreset movement;
    ColliderPreset collider;
    CombatPreset combat;
    StaminaPreset stamina;     // NEW
};
```

### Stamina Component (ECS runtime data)

New file: `game-core/src/components/Stamina.hpp`

Mirrors the `Health` component pattern: plain data struct with convenience methods, no logic beyond simple state queries and mutations.

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `current` | `float` | Current stamina value. Clamped to `[0, maximum]`. |
| `maximum` | `float` | Maximum stamina pool. Set from `StaminaPreset.maxStamina`. |
| `baseRegenRate` | `float` | Max regen per second (at 100% stamina). Set from `StaminaPreset.baseRegenRate`. |
| `drainDelay` | `float` | Configured pause duration (seconds) after full depletion. Set from `StaminaPreset.drainDelaySeconds`. |
| `drainDelayTimer` | `float` | Runtime countdown. Set to `drainDelay` when stamina hits zero, counts down each frame. Regen blocked while `> 0`. |
| `exhausted` | `bool` | `true` from the moment stamina hits zero until `drainDelayTimer` expires. Used by other systems to query exhaustion state. |
| `sprintCostPerSec` | `float` | Stamina consumed per second while sprinting. Set from `StaminaPreset.sprintCostPerSec`. Stored here so `CharacterControllerSystem` can read it without accessing the preset. |
| `jumpCost` | `float` | Flat stamina consumed per jump. Set from `StaminaPreset.jumpCost`. Stored here for the same reason. |

**Methods:**
| Method | Signature | Behavior |
|--------|-----------|----------|
| `consume` | `void consume(float amount)` | Subtracts `amount` from `current`. Clamps to `0`. Does **not** set `exhausted` — that is `StaminaSystem`'s responsibility. |
| `canAfford` | `bool canAfford(float cost) const` | Returns `current >= cost`. Used by `CombatSystem` and `CharacterControllerSystem` to gate actions. |
| `recover` | `void recover(float amount)` | Adds `amount` to `current`. Clamps to `maximum`. |
| `restore` | `void restore()` | Sets `current = maximum`, `exhausted = false`, `drainDelayTimer = 0`. Used on spawn/respawn. |
| `getPercent` | `float getPercent() const` | Returns `current / maximum`. Range `[0.0, 1.0]`. |
| `isExhausted` | `bool isExhausted() const` | Returns `exhausted`. |
| `isFull` | `bool isFull() const` | Returns `current >= maximum`. |
| `createFromPreset` | `static Stamina createFromPreset(const StaminaPreset& preset)` | Factory. Sets `current = maximum = preset.maxStamina`, `baseRegenRate = preset.baseRegenRate`, `drainDelay = preset.drainDelaySeconds`, `sprintCostPerSec = preset.sprintCostPerSec`, `jumpCost = preset.jumpCost`, `exhausted = false`, `drainDelayTimer = 0`. |

### Stamina Costs on Actions

**AttackStage** — add a `staminaCost` field:
```cpp
struct AttackStage {
    float damageMultiplier;
    float range;
    float duration;
    float movementMultiplier;
    float chainWindow;
    float attackAngle = 1.047f;
    float staminaCost = 0.0f;   // NEW: stamina consumed when this stage completes
};
```

**SkillDefinition** — add a `staminaCost` field:
```cpp
struct SkillDefinition {
    SkillVariant params;
    float cooldown;
    float castDuration;
    float staminaCost = 0.0f;   // NEW: stamina consumed when cast completes
};
```

Default of `0.0f` ensures backward compatibility — any attack or skill without an explicit cost is free.

**Zero-cost actions during exhaustion:** A `staminaCost` of `0.0f` means `canAfford(0)` returns `true` even when stamina is zero or the player is exhausted. This is intentional — zero-cost actions are explicitly free and usable at all times. All Knight attacks and skills have non-zero costs, so this only affects future content where a designer deliberately sets cost to zero (e.g. a passive ability or a basic action that shouldn't be gated). If a future design requires exhaustion to block all actions regardless of cost, add an `isExhausted()` check to the gating logic — but that is not part of this spec.

---

## StaminaSystem (new ECS system)

New file: `game-core/src/systems/StaminaSystem.hpp`

### Responsibilities

Sole owner of stamina regeneration logic. Does **not** consume stamina — that is done by `CombatSystem` (attacks/skills) and `CharacterControllerSystem` (sprint/jump). `StaminaSystem` only handles:

1. Detecting full depletion and entering exhaustion state.
2. Ticking the drain delay timer during exhaustion.
3. Clearing exhaustion when the delay expires.
4. Applying scaled regen when the player is not consuming stamina.

### Required Component Access

`StaminaSystem` requires read access to the following components on each entity:
- `CharacterController` — reads `isSprinting` to suppress regen during sprint.
- `CombatController` — reads `isAttacking`, `isAbility1Casting()`, `isAbility2Casting()` to suppress regen during combat actions.
- `Health` — reads `isAlive()` to skip dead players.

### Update Phase

Runs in `lateUpdate()`. The existing system execution order is:

```
earlyUpdate  →  fixedUpdate  →  update     →  lateUpdate
     ↑                             ↑              ↑
CharControllerSystem          CombatSystem    StaminaSystem
```

`CharacterControllerSystem` runs in `earlyUpdate` (consumes sprint stamina), `CombatSystem` runs in `update` (consumes attack/skill stamina). By placing `StaminaSystem` in `lateUpdate`, it runs **after both**, ensuring all stamina consumption for the current tick is applied before regen ticks. This prevents regen from "undoing" a spend in the same frame.

### Per-Entity Logic (every tick)

```
for each entity with (Stamina, CharacterController, CombatController, Health):

    // 1. Dead players don't regen
    if !health.isAlive():
        continue

    // 2. Detect full depletion → enter exhaustion
    if stamina.current <= 0 and !stamina.exhausted:
        stamina.exhausted = true
        stamina.drainDelayTimer = stamina.drainDelay

    // 3. Tick drain delay during exhaustion
    if stamina.exhausted:
        stamina.drainDelayTimer -= deltaTime
        if stamina.drainDelayTimer <= 0:
            stamina.exhausted = false
        else:
            continue   // no regen during drain delay

    // 4. No regen while actively spending stamina
    if controller.isSprinting:          continue
    if combat.isAttacking:              continue
    if combat.isAbility1Casting():      continue
    if combat.isAbility2Casting():      continue

    // 5. Scaled regen with 10% minimum floor
    effectiveRate = stamina.baseRegenRate * (stamina.current / stamina.maximum)
    effectiveRate = max(effectiveRate, stamina.baseRegenRate * 0.10)

    stamina.current = min(stamina.current + effectiveRate * deltaTime, stamina.maximum)
```

### Regen Formula Details

**Core formula:** `effectiveRate = baseRegenRate * (current / maximum)`

This creates a smooth curve where regen is proportional to how full the bar is:
- At 100% stamina: regen = 100% of baseRegenRate (not needed, bar is full)
- At 80% stamina: regen = 80% of baseRegenRate (fast recovery)
- At 50% stamina: regen = 50% of baseRegenRate (moderate)
- At 20% stamina: regen = 20% of baseRegenRate (slow)
- At 5% stamina: regen = 10% of baseRegenRate (minimum floor kicks in)

**Minimum floor: 10% of baseRegenRate.** Without this floor, recovering from near-zero would be agonizingly slow (1% stamina = 1% regen rate). The 10% floor ensures recovery from low stamina is sluggish but not frustrating. Players still feel the penalty of draining low, but aren't stuck doing nothing.

**Full depletion penalty:** When stamina hits exactly zero, the `exhausted` flag is set and `drainDelayTimer` starts counting down from `drainDelay`. During this window, **no regen occurs at all** — the player is locked out. Once the timer expires, `exhausted` clears and normal scaled regen begins (starting at the 10% floor since current is near zero).

### Recovery Math

The regen formula creates a piecewise ODE due to the 10% floor:

- **Phase 1 (s < 10% of max):** Constant rate at `baseRegenRate * 0.10` (the floor).
  - Duration: `(max * 0.10) / (baseRegenRate * 0.10)` = `max / baseRegenRate` seconds.
- **Phase 2 (s >= 10% of max):** Exponential growth: `ds/dt = baseRegenRate * s / max`.
  - Solution: `s(t) = s0 * e^(baseRegenRate * t / max)`.
  - Time from 10% to X%: `(max / baseRegenRate) * ln(X / 10)`.

With Knight values (`max = 100`, `baseRegenRate = 40.0`):
- Phase 1 (0 → 10): `100 / 40 = 2.5s` at constant 4.0/s
- Phase 2 (10 → 50): `2.5 * ln(5) ≈ 4.0s`
- Phase 2 (10 → 100): `2.5 * ln(10) ≈ 5.8s`
- **Total from empty: 1.5s delay + 2.5s + 5.8s ≈ 9.8s** (meets ~10s target)

---

## Combat Integration

### CombatSystem Modifications

All changes are in `CombatSystem.hpp`. The system gains access to the `Stamina` component through the existing entity registry.

#### Attack Gating (`processInputAttacks`)

**Before starting an attack:**
```
when player wants to attack and comcon.canPerformAttack():
    cost = comcon.attackChain[comcon.chainStage].staminaCost
    if !stamina.canAfford(cost):
        // Silently reject — player cannot attack
        // Do NOT buffer the attack input
        return
    // Proceed with comcon.startAttack() as normal
```

**When swing completes (`handleSwingEnd`):**
```
    cost = comcon.attackChain[completedStage].staminaCost
    stamina.consume(cost)
    // Then proceed with advanceChain(), hit resolution, etc. as normal
```

**Design decision: check before, consume after.** The player must have enough stamina to *initiate* the attack, but the cost is deducted when the swing completes. This means a player who starts an attack with exactly enough stamina will hit zero after the swing and enter exhaustion — a fair trade for committing to the action. It also prevents exploits where stamina is consumed but the attack is cancelled mid-swing.

#### Skill Gating (`triggerSkill`)

Same check-before-consume-after pattern as attacks. Each skill slot is handled separately since the codebase has distinct `canUseAbility1()` / `canUseAbility2()` methods and separate timer fields per slot.

**Before starting a skill (both slots follow this pattern):**
```
when player wants to use ability1 and comcon.canUseAbility1():
    cost = comcon.ability1.staminaCost
    if !stamina.canAfford(cost):
        // Silently reject — player cannot use this skill
        return
    // Proceed with triggerSkill() for slot 1 as normal

when player wants to use ability2 and comcon.canUseAbility2():
    cost = comcon.ability2.staminaCost
    if !stamina.canAfford(cost):
        return
    // Proceed with triggerSkill() for slot 2 as normal
```

**When cast completes (`tickSkillSlot`):**
```
    // tickSkillSlot already knows which slot it's processing
    cost = skillDefinition.staminaCost   // ability1 or ability2 respectively
    stamina.consume(cost)
    // Then proceed with executeSkill(), cooldown start, etc. as normal
```

#### Buffered Actions

If a player buffers an attack or skill while already mid-action, the stamina check happens when the buffer is consumed (i.e. when the current action ends and the buffered action would start), **not** when the input is buffered. This prevents the edge case where stamina changes between buffering and execution.

### CharacterControllerSystem Modifications

#### Sprint Drain

In `processCharacterMovement()`, after determining the player wants to sprint:

```
if input.isSprinting:
    frameCost = stamina.sprintCostPerSec * deltaTime
    if !stamina.isExhausted() and stamina.canAfford(frameCost):
        stamina.consume(frameCost)
        // Sprint proceeds normally — apply sprintMultiplier to speed
    else:
        controller.isSprinting = false
        // Fall back to walk speed — override player input
```

Sprint is the only action with a **continuous** stamina cost (per-second). All other actions have discrete, one-time costs.

Sprint uses `canAfford(frameCost)` for consistency with all other stamina checks (not a raw `current > 0` comparison). It also checks `isExhausted()` explicitly — this prevents a stutter loop where a player exits exhaustion with a tiny amount of stamina, sprints for one frame, drains to zero, re-enters exhaustion, waits 1.5s, and repeats. By blocking sprint during exhaustion, the player must wait for meaningful stamina to accumulate before sprinting again.

Sprint is forcibly disabled when stamina is insufficient or exhausted. The player's input still says `isSprinting = true`, but the server overrides it. The client will see the speed change via the snapshot.

#### Jump Cost

In `processCharacterMovement()`, when processing jump input:

```
if input.isJumping and controller.canJump:
    if !stamina.canAfford(jumpCost):
        // Reject jump — do nothing
    else:
        stamina.consume(jumpCost)
        // Proceed with jump as normal
```

Jump cost is consumed **immediately** (unlike attacks/skills which defer to completion). There is no "jump duration" — the player either jumps or doesn't.

`jumpCost` is read from `StaminaPreset.jumpCost`, stored on the entity at spawn time. This value comes from the character preset so different classes can have different jump costs.

---

## Network & Snapshot Integration

### Snapshot Changes

Stamina data flows through four layers to reach the client. All four must be updated:

**1. C++ `CharacterSnapshot` struct (`ArenaGame.hpp`):**
Add `stamina` and `max_stamina` fields to the `CharacterSnapshot` struct definition (alongside existing `health` and `max_health`).

**2. C++ `ArenaGame::createSnapshot()` (`ArenaGame.hpp`):**
The `createSnapshot()` method must include `Stamina` in the entity view template and populate the new snapshot fields from `stamina.current` and `stamina.maximum`.

**3. C++ CXX bridge mapping (`cxx_bridge.cpp`):**
The bridge code that pushes `CharacterSnapshot` fields to the Rust side must include the two new fields in the `push_back` call.

**4. Rust FFI bridge (`ffi.rs`):**
Add fields to both the CXX bridge struct and the Rust wrapper struct, plus the `From` impl that maps between them:
```rust
pub struct CharacterSnapshot {
    // ... existing fields ...
    pub stamina: f32,
    pub max_stamina: f32,
}
```

**5. Frontend types (`types.ts`):**
Add matching fields to the TypeScript `CharacterSnapshot` interface:
```typescript
export interface CharacterSnapshot {
    // ... existing fields ...
    stamina: number;
    max_stamina: number;
}
```

**No new message type needed.** Stamina state rides the existing `Snapshot(GameStateSnapshot)` message sent every tick at 60 Hz. Two extra floats per player is negligible bandwidth overhead (~8 bytes per player per tick). `messages.rs` requires no changes — it already references `GameStateSnapshot` which contains `CharacterSnapshot` from `ffi.rs`.

### No Discrete Stamina Events

Unlike `Damage` or `Death`, there is no `StaminaChanged` event message. The snapshot provides stamina every frame, making a discrete event redundant. The client can derive all display states (low stamina warning, exhaustion indicator) from the snapshot values.

### Frontend Display

This spec intentionally **does not define** stamina bar UI visuals (bar style, position, color, exhaustion effects). The snapshot delivers `stamina` and `max_stamina` to the client every frame — all data needed for any UI treatment. Visual design is a separate concern to be addressed independently.

---

## Entity Lifecycle

### Spawn (new player joins or respawns after death)

When a player entity is created:
1. `Stamina` component is attached via `Stamina::createFromPreset(characterPreset.stamina)`
2. Stamina starts at `maximum` (full bar)
3. `exhausted = false`, `drainDelayTimer = 0`

This happens in the same entity construction code that attaches `Health`, `CharacterController`, `CombatController`, etc.

### Death

When a player dies:
- Stamina **stops regenerating** — the `health.isAlive()` guard in `StaminaSystem` handles this automatically.
- Stamina values are not explicitly zeroed — they become irrelevant while the player is dead.
- No special handling needed.

### Respawn

When a player revives:
- Call `stamina.restore()` — sets `current = maximum`, clears `exhausted` and `drainDelayTimer`.
- This is added alongside the existing `Health::revive()` call in `World::respawnPlayer()` (`game-core/src/core/World.hpp`).
- Player starts the new life with full stamina, clean state.

### Game Mode Reset (e.g. round restart)

Same as respawn — `stamina.restore()` is called during the reset sequence that already restores health and repositions players.

---

## Knight Preset Values

Starting tuning values for the Knight class. These are balance numbers intended to be adjusted through playtesting.

### StaminaPreset
| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `maxStamina` | `100.0` | Round number, easy to reason about costs as percentages |
| `baseRegenRate` | `40.0/s` | Max regen at 100% stamina. Effective range: 4.0/s (10% floor) to 40.0/s. See Recovery Math section for derivation |
| `drainDelaySeconds` | `1.5s` | Punishing but not rage-inducing. Long enough to feel the mistake of full drain |
| `sprintCostPerSec` | `15.0/s` | ~6.6 seconds of continuous sprint from full. Enough to cross the arena but not endlessly kite |
| `jumpCost` | `8.0` | ~12 jumps from full. Bunny-hopping burns resources fast |

### Attack Chain Costs
| Stage | Cost | Rationale |
|-------|------|-----------|
| Stage 1 (light slash) | `10.0` | Cheap opener, low commitment |
| Stage 2 (follow-up) | `15.0` | Moderate investment to continue |
| Stage 3 (heavy finisher) | `25.0` | Expensive payoff — rewards landing the full chain |

Full 3-hit combo = **50 stamina** (half the pool). Two full combos back-to-back depletes the bar entirely.

### Skill Costs
| Skill | Cost | Rationale |
|-------|------|-----------|
| Ability 1 | `20.0` | Moderate cost, can still combo after |
| Ability 2 | `30.0` | Heavy commitment, limits follow-up options |

### Recovery Scenarios

Derived from the piecewise ODE (see Recovery Math section). With `baseRegenRate = 40.0`, `max = 100`:
- Phase 1 (0 → 10): constant floor rate of 4.0/s → 2.5s
- Phase 2 (10 → X): exponential `s(t) = 10 * e^(0.4t)`, time = `2.5 * ln(X/10)`

| Scenario | Timeline |
|----------|----------|
| Full drain (0%) | 1.5s delay + 2.5s (floor phase) + 5.8s (exponential phase) ≈ **~10s total** |
| Full drain → 50% | 1.5s delay + 2.5s + 2.5*ln(5) ≈ **~8s** |
| Drain to 50% (no depletion) | Immediate exponential regen → 2.5*ln(2) ≈ **~1.7s** |
| Drain to 25% | Immediate → 2.5*ln(4) ≈ **~3.5s** |
| One combo (50% remaining) | Same as drain to 50% → **~1.7s** |

The takeaway: **conservative play (stay above 50%) recovers in under 2 seconds. Full drain costs ~10 seconds.** This is the core incentive loop — the punishment is heavily weighted toward reckless depletion.

### Future Classes (not yet in codebase)

When Rogue and Mage presets are added, the stamina system supports them with no code changes — only new preset values:
- **Rogue:** Lower `maxStamina` (~80), lower per-attack costs (~5-15), faster `baseRegenRate` (~25/s). Cheap quick attacks, smaller pool.
- **Mage:** Higher `maxStamina` (~120), higher skill costs (~30-40), lower `baseRegenRate` (~15/s). Spell-heavy, pool management matters more.

These are hypothetical examples — actual values would be tuned when the classes are implemented.

---

## Files Changed Summary

### New Files
| File | Description |
|------|-------------|
| `game-core/src/components/Stamina.hpp` | Stamina ECS component (data + convenience methods) |
| `game-core/src/systems/StaminaSystem.hpp` | Stamina regen system (owns all regen logic) |

### Modified Files
| File | Change |
|------|--------|
| `game-core/src/CharacterPreset.hpp` | Add `StaminaPreset` struct, add `stamina` field to `CharacterPreset` |
| `game-core/src/Presets.hpp` | Populate `StaminaPreset` values for Knight, add `staminaCost` to attack stages and skill definitions |
| `game-core/src/Skills.hpp` | Add `staminaCost` field to `AttackStage` and `SkillDefinition` |
| `game-core/src/systems/CombatSystem.hpp` | Stamina checks before attacks/skills (per slot), consume on completion |
| `game-core/src/systems/CharacterControllerSystem.hpp` | Sprint drain per frame, jump cost, sprint disable on empty/exhausted |
| `game-core/src/systems/SystemManager.hpp` | Register `StaminaSystem` in `lateUpdate` phase |
| `game-core/src/ArenaGame.hpp` | Attach `Stamina` component on entity creation; add `stamina`/`max_stamina` to C++ `CharacterSnapshot` struct; populate fields in `createSnapshot()` (include `Stamina` in entity view) |
| `game-core/src/cxx_bridge.cpp` | Add `stamina`, `max_stamina` to the CXX bridge `push_back` mapping |
| `game-core/src/core/World.hpp` | Add `stamina.restore()` alongside `Health::revive()` in `respawnPlayer()` |
| `backend/src/game/ffi.rs` | Add `stamina`, `max_stamina` to CXX bridge struct, Rust wrapper struct, and `From` impl |
| `frontend/src/game/types.ts` | Add `stamina`, `max_stamina` to `CharacterSnapshot` interface |
