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

---

## StaminaSystem (new ECS system)

New file: `game-core/src/systems/StaminaSystem.hpp`

### Responsibilities

Sole owner of stamina regeneration logic. Does **not** consume stamina — that is done by `CombatSystem` (attacks/skills) and `CharacterControllerSystem` (sprint/jump). `StaminaSystem` only handles:

1. Detecting full depletion and entering exhaustion state.
2. Ticking the drain delay timer during exhaustion.
3. Clearing exhaustion when the delay expires.
4. Applying scaled regen when the player is not consuming stamina.

### Update Phase

Runs in `FixedUpdate`, **after** `CombatSystem` and `CharacterControllerSystem`. This ordering ensures that stamina consumption for the current tick is already applied before regen ticks, preventing regen from "undoing" a spend in the same frame.

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
    if controller.isSprinting:  continue
    if combat.isAttacking:      continue
    if combat.isCasting():      continue

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

Same pattern as attacks:

**Before starting a skill:**
```
when player wants to use ability and comcon.canUseAbility():
    cost = skillDefinition.staminaCost
    if !stamina.canAfford(cost):
        // Silently reject — player cannot use this skill
        return
    // Proceed with triggerSkill() as normal
```

**When cast completes (`tickSkillSlot`):**
```
    cost = skillDefinition.staminaCost
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
    if stamina.current > 0:
        stamina.consume(sprintCostPerSec * deltaTime)
        // Sprint proceeds normally — apply sprintMultiplier to speed
    else:
        controller.isSprinting = false
        // Fall back to walk speed — override player input
```

Sprint is the only action with a **continuous** stamina cost (per-second). All other actions have discrete, one-time costs.

Sprint is forcibly disabled when stamina reaches zero. The player's input still says `isSprinting = true`, but the server overrides it. The client will see the speed change via the snapshot.

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

**C++ side:** The snapshot generation code adds two floats to the per-player data passed through the CXX bridge:
- `stamina` — current stamina value (`stamina.current`)
- `max_stamina` — maximum stamina value (`stamina.maximum`)

**Rust FFI (`ffi.rs`):** Add fields to `CharacterSnapshot`:
```rust
pub struct CharacterSnapshot {
    // ... existing fields ...
    pub stamina: f32,
    pub max_stamina: f32,
}
```

**Rust messages (`messages.rs`):** No new message type. Stamina state rides the existing `Snapshot(GameStateSnapshot)` message sent every tick at 60 Hz. Two extra floats per player is negligible bandwidth overhead (~8 bytes per player per tick).

**Frontend types (`types.ts`):** Add matching fields to `CharacterSnapshot`:
```typescript
export interface CharacterSnapshot {
    // ... existing fields ...
    stamina: number;
    max_stamina: number;
}
```

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
- This is added alongside the existing `Health::revive()` call in the respawn logic.
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
| `baseRegenRate` | `20.0/s` | At full stamina: 5s from empty to full. Effective range: 2.0/s (10% floor) to 20.0/s (100%) |
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
| Scenario | Timeline |
|----------|----------|
| Full drain (0%) | 1.5s delay → starts at 10% floor (2.0/s) → ~50% in ~6s → ~100% in ~10s total |
| Drain to 50% (no depletion) | Immediate regen at 10.0/s → back to full in ~3s |
| Drain to 25% | Immediate regen at 5.0/s → back to full in ~5s |
| One combo (50% remaining) | Immediate regen at 10.0/s → full in ~3s |

The takeaway: **conservative play recovers in seconds, reckless play costs 10+ seconds**. This is the core incentive loop.

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
| `game-core/src/Presets.hpp` | Populate `StaminaPreset` values for Knight |
| `game-core/src/Skills.hpp` | Add `staminaCost` field to `AttackStage` and `SkillDefinition` |
| `game-core/src/systems/CombatSystem.hpp` | Stamina checks before attacks/skills, consume on completion |
| `game-core/src/systems/CharacterControllerSystem.hpp` | Sprint drain per frame, jump cost, sprint disable on empty |
| `game-core/src/systems/SystemManager.hpp` | Register `StaminaSystem` in update loop |
| `game-core/src/ArenaGame.hpp` | Attach `Stamina` component on entity creation, `restore()` on respawn |
| `backend/src/game/ffi.rs` | Add `stamina`, `max_stamina` to `CharacterSnapshot` |
| `backend/src/game/messages.rs` | Add `stamina`, `max_stamina` to snapshot serialization (if separate from ffi) |
| `frontend/src/game/types.ts` | Add `stamina`, `max_stamina` to `CharacterSnapshot` interface |
