# Combat Animation System — Design Spec
**Date:** 2026-04-09
**Scope:** 1H melee combat, server-side event emission, client animation driven by events

---

## Problem

Two bugs motivate this redesign:

1. **Idle flash between combo hits.** The attacker's animation briefly snaps to idle between chain stages because the client drives attack animations from button presses (one-shot, non-looping), and the chain window period carries no `Attacking` state.
2. **Animation asymmetry.** The attacker and victim see different behaviour — remote characters loop the attack animation from snapshot state while the local player plays it once from input.

Root cause: animation is driven by two different systems (local = button press, remote = snapshot poll), and the combo chain has no per-stage animation identity.

---

## Goals

- All attack/skill animations driven by server-emitted events on both local and remote clients.
- No idle flash between combo stages.
- Correct hit timing: damage resolves at **end** of swing/cast, not at start. Normal attacks already implement this correctly via the `hitPending` mechanism in `CombatController` — no change needed there. This spec adds the equivalent deferred resolution for skills.
- Input buffering: one action pressed during an active swing is queued and fires immediately when the swing ends.
- Skills have a cast duration. Movement is locked during cast when `movementMultiplier = 0`.
- Knight gains a 3-stage attack chain with distinct animations per stage.
- Different character classes can map their own animations to chain stages via config.

---

## Architecture Overview

```
Button press (client)
    │
    └─► GameClientMessage::Input { attacking: true }
            │
            ▼
    Server CombatSystem
    ├── canPerformAttack? → startAttack(), emit AttackStarted { chain_stage }
    └── isAttacking?      → bufferedAction = Attack (or Skill1/Skill2)

    AttackStarted / SkillUsed events
            │
            ▼
    Client processEvents
    └── playAnimation(config.attackAnimations[chain_stage], loop=false)
            for all player IDs (local and remote alike)

    Snapshot (60 Hz)
    └── charData.state == Attacking  → fallback: attackAnimations[0] if no anim playing
        charData.state == Casting   → fallback: skillAnimations[0] if no anim playing
        (handles late-joining clients who missed the triggering event)
```

---

## Section 1 — New Network Events

Two new event types are added. `StateChange` continues to exist but is no longer emitted for `Attacking` or `Casting` — only for `Stunned` and `Dead`.

### C++ (`game-core/src/events/NetworkEvents.hpp`)

```cpp
struct AttackStartedEvent {
    PlayerID playerID;
    uint8_t  chainStage;  // 0 = first hit, 1 = second, 2 = third
};

struct SkillUsedEvent {
    PlayerID playerID;
    uint8_t  skillSlot;   // 1 or 2
};

using NetworkEvent = std::variant<
    DeathEvent,
    DamageEvent,
    SpawnEvent,
    StateChangeEvent,     // Stunned + Dead only — no longer emitted for Attacking/Casting
    AttackStartedEvent,
    SkillUsedEvent,
    MatchEndEvent
>;
```

### Rust (`backend/src/game/messages.rs`)

Both `GameServerMessage` (the wire type serialized over the WebSocket) and `GameEvent` (the client-side processed subset) are updated. `GameServerMessage` carries all messages the server can send. `GameEvent` is the TypeScript union of event types that the frontend dispatches — it excludes `Snapshot`.

```rust
AttackStarted { player_id: u32, chain_stage: u8 },
SkillUsed     { player_id: u32, skill_slot: u8  },
```

### TypeScript (`frontend/src/game/types.ts`)

```typescript
// Added to GameServerMessage:
| { type: 'AttackStarted'; player_id: number; chain_stage: number }
| { type: 'SkillUsed';     player_id: number; skill_slot: number  }
```

`GameEvent` union (the `Extract<GameServerMessage, ...>` type) updated to include both.

---

## Section 2 — Server: Skills (`game-core/src/Skills.hpp`)

`SkillDefinition` gains cast duration tracking. The design mirrors the `swingTimer`/`hitPending` pattern on `CombatController` for normal attacks — the same separation of responsibilities applies: the struct owns the state, the system applies and clears effects.

`MeleeAOE` is an existing struct in `Skills.hpp` — no new fields are added to it.

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

    // Starts the cast. Sets hitPending = true; system clears it after applying the hit.
    void trigger() {
        castTimer  = castDuration;
        hitPending = true;
    }

    // Called by CombatSystem when castTimer reaches zero, before applying the hit.
    // Does NOT clear hitPending — CombatSystem clears it after applying the effect,
    // consistent with how CombatController::hitPending works for normal attacks.
    void endCast() {
        timer     = cooldown;
        castTimer = 0.0f;
    }
};
```

**Parallel to normal attacks:**

| Normal attack        | Skill                         |
|----------------------|-------------------------------|
| `swingTimer`         | `castTimer`                   |
| `isAttacking`        | `isCasting()`                 |
| `hitPending`         | `hitPending` on `SkillDef`    |
| `stage.duration`     | `castDuration`                |
| `stage.movementMul`  | `MeleeAOE.movementMultiplier` |

**Accessing `movementMultiplier` from the variant:**
`SkillDefinition.params` is a `SkillVariant` (`std::variant<MeleeAOE>`). Use `std::visit` — the same pattern already used in `CombatSystem::executeSkill`:

```cpp
std::visit(overloaded{
    [&](const MeleeAOE& s) {
        if (s.movementMultiplier == 0.0f)
            controller.canMove = false;
    }
}, skill.params);
```

**Scalar `movementMultiplier` (0.7f for skill2):** Only the binary case (`0.0f` = fully rooted) is enforced in this iteration. Partial speed reduction is out of scope.

---

## Section 3 — Server: Input Buffering (`game-core/src/components/CombatController.hpp`)

```cpp
enum class BufferedAction : uint8_t { None, Attack, Skill1, Skill2 };
BufferedAction bufferedAction = BufferedAction::None;
```

### In `CombatSystem::processInputAttacks()`

```cpp
// Buffer any input that arrives while the character is committed to an action.
// Last input wins — if multiple inputs arrive in the same frame, Skill2 > Skill1 > Attack
// due to assignment order. Simultaneous multi-input is rare and this ordering is acceptable.
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
```

**Execution order guarantee:** `updateCooldowns` runs before `processInputAttacks` in `CombatSystem::update()` — this is already established in the existing code and is not being changed. This guarantees that a buffered action set by the previous frame's input is consumed in the same tick that the swing ends, with zero added latency.

---

## Section 4 — Server: `CombatSystem` Changes

### `processInputAttacks`

**`chainStage` read timing:** Read `comcon.chainStage` **before** calling `startAttack()`. `startAttack()` does not modify `chainStage` — only `advanceChain()` does (called at swing end). Reading before or after would yield the same value, but reading before is explicit.

```cpp
// Emit before startAttack():
uint8_t stage = static_cast<uint8_t>(comcon.chainStage);
comcon.startAttack();
// ...
if (ne) ne->events.push_back(NetEvents::AttackStartedEvent{ getPlayerID(entity), stage });
```

For skills, `skillSlot` is `1` when `wantsSkill1` triggered it, `2` when `wantsSkill2` triggered it:
```cpp
if (ne) ne->events.push_back(NetEvents::SkillUsedEvent{ getPlayerID(entity), 1u });
```

**Keep** `controller.setState(CharacterState::Attacking)` and `controller.setState(CharacterState::Casting)`. The snapshot must carry these states so latecomer clients can trigger the snapshot fallback animation in `updateSnapshotFallbackAnimation`. Only the corresponding `StateChangeEvent` emissions are removed.

**Remove** `StateChangeEvent { Attacking }` and `StateChangeEvent { Casting }` — replaced by `AttackStartedEvent` and `SkillUsedEvent`.

### `updateCooldowns` — skill cast tick

When `castTimer > 0`, decrement it. When it reaches zero:
1. Call `skill.endCast()` — starts the cooldown timer.
2. Apply the deferred skill hit (same `hitAllInRange`/`hitInArc` call as currently in `executeSkill`, but now deferred).
3. Clear `skill.hitPending = false`.
4. Restore `controller.canMove = true` if movement was locked (unless character is dead).

```cpp
auto tickSkill = [&](SkillDefinition& skill, uint8_t /*slot*/) {
    if (!skill.isCasting()) return;
    skill.castTimer -= deltaTime;
    if (skill.castTimer <= 0.0f) {
        skill.endCast();
        if (skill.hitPending) {
            SkillContext ctx{ ... };
            // apply skill effect
            skill.hitPending = false;
        }
        // restore movement if it was locked
        std::visit(overloaded{
            [&](const MeleeAOE& s) {
                if (s.movementMultiplier == 0.0f && !controller.isDead())
                    controller.canMove = true;
            }
        }, skill.params);
    }
};
tickSkill(combat.ability1, 1);
tickSkill(combat.ability2, 2);
```

### `CharacterControllerSystem` (lines 121–123)

Remove the block that sets `CharacterState::Attacking` from raw input:

```cpp
// DELETE:
if (controller.input.isAttacking) {
    controller.setState(CharacterState::Attacking);
}
```

`CombatSystem` is the sole authority on combat state.

---

## Section 5 — Server: Knight Preset (`game-core/src/Presets.hpp`)

3-stage chain replaces the existing 2-stage chain.

**Note on `chainWindow`:** The window is measured from swing **end**, not swing start. `chainTimer` resets to zero in `advanceChain()` (called when a swing ends), so a `chainWindow` of `0.5f` gives a full 0.5s grace period after the swing ends. The coincidence of stage 1's `duration = chainWindow = 0.5f` is intentional — it creates tighter timing for the finisher without being zero grace.

```cpp
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
```

---

## Section 6 — Client: `characterConfigs.ts`

`CharacterConfig` gains two animation arrays. Index maps directly to chain stage / (skill slot − 1):

```typescript
export interface CharacterConfig {
    // ... existing fields ...
    attackAnimations: string[];  // [stage0, stage1, stage2, ...]
    skillAnimations:  string[];  // [skill1anim, skill2anim, ...]  (slot - 1)
}
```

Knight:
```typescript
attackAnimations: [
    'Melee_1H_Attack_Slice_Diagonal',    // stage 0
    'Melee_1H_Attack_Slice_Horizontal',  // stage 1
    'Melee_1H_Attack_Stab',              // stage 2
],
skillAnimations: [
    'Melee_1H_Attack_Jump_Chop',  // skill1
    'Melee_1H_Attack_Chop',       // skill2 — placeholder, replace when a better animation is chosen
],
```

Rogue will get its own arrays when implemented (`Melee_Dualwield_*`).

---

## Section 7 — Client: `SimpleGameClient.tsx`

### `processEvents` — primary animation driver

Same code path for local and remote. No special casing per player ID.

```typescript
case 'AttackStarted': {
    const anim = config.attackAnimations[event.chain_stage];
    if (anim) getChar(event.player_id)?.playAnimation(anim, false);
    if (event.player_id === localPlayerID) currentAnimState = 'attack';
    break;
}
case 'SkillUsed': {
    const anim = config.skillAnimations[event.skill_slot - 1];
    if (anim) getChar(event.player_id)?.playAnimation(anim, false);
    if (event.player_id === localPlayerID) currentAnimState = 'skill';
    break;
}
```

### `updateSnapshotFallbackAnimation` (renamed from `updateRemoteAnimation`)

The function is renamed to reflect that it now handles all characters (local and remote) as a fallback when a client joins mid-game and has missed the triggering event.

"Animation currently running" is checked via `AnimatedCharacter.currentAnimation?.isPlaying`.

```typescript
// Called for all characters including local, every frame, from processSnapshot.
function updateSnapshotFallbackAnimation(char, charData, config) {
    if (jumpState !== JumpState.GROUNDED) return;  // jump logic takes precedence

    switch (charData.state) {
        case CharacterState.Attacking:
            // Fallback: event was missed (late join). Play stage 0 and loop until state changes.
            if (!char.currentAnimation?.isPlaying)
                char.playAnimation(config.attackAnimations[0], true);
            break;
        case CharacterState.Casting:
            // Known limitation: snapshot carries no skill slot, so skill1's animation is always
            // shown for latecomers regardless of which skill is actually casting.
            if (!char.currentAnimation?.isPlaying)
                char.playAnimation(config.skillAnimations[0], true);
            break;
        case CharacterState.Dead: /* ... existing death logic ... */ break;
        case CharacterState.Stunned: /* ... existing hit logic ... */ break;
        case CharacterState.Walking:
            char.playAnimation(AnimationNames.walk, true); break;
        case CharacterState.Sprinting:
            char.playAnimation(AnimationNames.run, true); break;
        default:
            char.playAnimation(AnimationNames.idle, true); break;
    }
}
```

### `updateLocalAnimation` — movement, jump, and attack handoff

`updateLocalAnimation` handles movement and jump only. Attack/skill animation is initiated by `processEvents`. The handoff between the two is governed by `currentAnimState`:

**State machine:**

1. `processEvents` fires `AttackStarted` → plays the animation (`loop=false`), sets `currentAnimState = 'attack'`.
2. Every frame, `updateLocalAnimation` runs:
   - If `currentAnimState === 'attack'` or `'skill'`:
     - Check `char.currentAnimation?.isPlaying`
     - **Still playing + movement input** → cancel: switch to walk/run, reset `currentAnimState = ''`
     - **Still playing, no movement** → do nothing (let it finish)
     - **Finished** (`!isPlaying`) → reset `currentAnimState = ''` → movement/idle resumes next frame
   - If `currentAnimState === ''`:
     - Normal movement/idle logic runs

Skills (`currentAnimState === 'skill'`) follow the same handoff, except movement input does **not** cancel a skill cast — the server already enforces `canMove = false` for skill1. The client mirrors this: no movement cancellation in `updateLocalAnimation` when state is `'skill'`.

---

## Out of Scope

- 2H melee, ranged, or other character classes
- Client-side prediction with server reconciliation
- Fractional `movementMultiplier` speed reduction (only binary 0/non-zero enforced)
- Skill casting: which skill is casting is not tracked in the snapshot — latecomers always see `skillAnimations[0]`
- Hit effects, floating damage numbers, kill feed (existing TODOs)
- AI combat
- Networking changes beyond the two new event types

---

## File Change Summary

Note: this project uses header-only C++ — all implementation lives in `.hpp` files via `inline`. There are no `.cpp` files for these systems.

| File | Change |
|------|--------|
| `game-core/src/events/NetworkEvents.hpp` | Add `AttackStartedEvent`, `SkillUsedEvent` to variant |
| `game-core/src/Skills.hpp` | Add `castDuration`, `castTimer`, `hitPending`, `isCasting()`, `endCast()`, `trigger()` changes to `SkillDefinition` |
| `game-core/src/components/CombatController.hpp` | Add `BufferedAction` enum + `bufferedAction` field |
| `game-core/src/systems/CombatSystem.hpp` | Buffer logic, skill cast tick, new event emission, remove StateChange for attack/cast, enforce movementMultiplier |
| `game-core/src/systems/CharacterControllerSystem.hpp` | Remove lines 121–123 (redundant state set from input) |
| `game-core/src/Presets.hpp` | 3-stage Knight chain, skill cast durations |
| `backend/src/game/messages.rs` | Add `AttackStarted`, `SkillUsed` to `GameServerMessage` |
| `frontend/src/game/types.ts` | Add both to `GameServerMessage` and `GameEvent` unions |
| `frontend/src/game/characterConfigs.ts` | Add `attackAnimations`, `skillAnimations` to `CharacterConfig` and `CharacterConfig` interface |
| `frontend/src/components/GameBoard/SimpleGameClient.tsx` | `processEvents` handles new events; `updateRemoteAnimation` renamed to `updateSnapshotFallbackAnimation` and unified for all players; `updateLocalAnimation` reduced to movement + jump + attack handoff state machine |
