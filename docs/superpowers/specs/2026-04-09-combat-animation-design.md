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
        Known limitation: both fallbacks always play index 0 regardless of actual
        chain stage or skill slot — snapshot carries no sub-state context.
```

---

## Section 1 — New Network Events

Two new event types are added. `StateChange` continues to exist but is no longer emitted for `Attacking` or `Casting` — only for `Stunned`.

**`DeathEvent` vs `StateChangeEvent { Dead }`:** `DeathEvent` already exists and is the sole event emitted on death — `CombatSystem::processDamage()` emits it, and no `StateChangeEvent { Dead }` is emitted anywhere in the current codebase. `StateChangeEvent` is therefore narrowed to `Stunned` only. Clients must not handle death twice.

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
    StateChangeEvent,     // Stunned only — no longer emitted for Attacking/Casting; death uses DeathEvent
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
    // Precondition: castDuration > 0.0f. If castDuration is zero, castTimer starts at zero,
    // isCasting() is immediately false, and hitPending is never cleared — the effect never fires.
    // Skills with instant effects should not use this path. Assert in debug builds.
    void trigger() {
        assert(castDuration > 0.0f && "SkillDefinition: castDuration must be > 0");
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

**Scalar `movementMultiplier`:** Both the binary case (`0.0f` = fully rooted, via `canMove = false`) and partial speed reduction (`0 < multiplier < 1.0f`) are in scope — see Section 5 for the `activeMovementMultiplier` mechanism.

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

// When multiple wants* are true simultaneously (e.g. a buffered attack fires in the same frame
// as a live skill press), resolve with explicit priority: Skill2 > Skill1 > Attack.
// Use if/else-if to ensure only one action fires per frame:
if      (wantsSkill2 && comcon.canUseAbility2()) { /* fire skill2 */ }
else if (wantsSkill1 && comcon.canUseAbility1()) { /* fire skill1 */ }
else if (wantsAttack && comcon.canPerformAttack()) { /* fire attack */ }
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

**`CharacterControllerSystem` — only `Attacking` was set from raw input there** (lines 121–123). `CharacterState::Casting` is not set anywhere in `CharacterControllerSystem`. Only those three lines need removal.

### `updateCooldowns` — skill cast tick

When `castTimer > 0`, decrement it. When it reaches zero:
1. Call `skill.endCast()` — starts the cooldown timer.
2. Apply the deferred skill hit (same `hitAllInRange`/`hitInArc` call as currently in `executeSkill`, but now deferred).
3. Clear `skill.hitPending = false`.
4. Restore `controller.canMove = true` if movement was locked (unless character is dead).

Dead-during-cast guard: if a character dies mid-cast, `hitPending` is still true when `castTimer` hits zero. Apply a `health.isAlive()` check before firing the deferred effect — a corpse should not deal damage.

```cpp
auto tickSkill = [&](SkillDefinition& skill, uint8_t /*slot*/) {
    if (!skill.isCasting()) return;
    skill.castTimer -= deltaTime;
    if (skill.castTimer <= 0.0f) {
        skill.endCast();
        if (skill.hitPending) {
            if (health.isAlive()) {   // guard: character may have died during cast
                SkillContext ctx{ ... };
                // apply skill effect
            }
            skill.hitPending = false;
        }
        // restore movement locked by this skill
        std::visit(overloaded{
            [&](const MeleeAOE& s) {
                if (s.movementMultiplier == 0.0f && !controller.isDead())
                    controller.canMove = true;
                // Partial speed (0 < mul < 1): restore activeMovementMultiplier to 1.0f
                else if (s.movementMultiplier > 0.0f && !controller.isDead())
                    controller.activeMovementMultiplier = 1.0f;
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

## Section 5 — Server: Partial Movement Speed During Skills (`game-core/src/components/CharacterController.hpp` + `CombatSystem.hpp`)

Skill2 has `movementMultiplier = 0.7f` — the character moves but at 70% speed during the cast. The binary `canMove = false` approach cannot express this; a scalar multiplier is needed.

**Add to `CharacterController`:**
```cpp
float activeMovementMultiplier = 1.0f;  // applied by CharacterControllerSystem; reset to 1.0f when no cast
```

**In `CharacterControllerSystem::processCharacterMovement`**, multiply the effective speed:
```cpp
float speed = controller.getEffectiveSpeed() * controller.activeMovementMultiplier;
```

**In `CombatSystem::processInputAttacks`**, when a skill cast starts, set the multiplier via `std::visit`:
```cpp
std::visit(overloaded{
    [&](const MeleeAOE& s) {
        if (s.movementMultiplier == 0.0f) {
            charcon.canMove = false;
        } else if (s.movementMultiplier < 1.0f) {
            charcon.activeMovementMultiplier = s.movementMultiplier;
        }
        // movementMultiplier == 1.0f: no restriction, leave defaults
    }
}, skill.params);
```

`activeMovementMultiplier` is restored to `1.0f` in `tickSkill` when the cast ends (see Section 4).

---

## Section 6 — Server: Knight Preset (`game-core/src/Presets.hpp`)

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

## Section 7 — Client: `characterConfigs.ts`

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

## Section 8 — Client: `SimpleGameClient.tsx`

### Config lookup in `processEvents`

`GameClient` maintains a `characterConfigMap: Map<number, CharacterConfig>` alongside `characters`. When a character is created (`createRemoteCharacter` for remotes, `initLocalPlayer` for local), its resolved config is stored in this map keyed by `player_id`. `processEvents` looks up the config by `event.player_id`. The local player's config is stored under `localPlayerID` at init time.

```typescript
// In processEvents:
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
```

### `updateSnapshotFallbackAnimation` (renamed from `updateRemoteAnimation`)

Renamed to reflect that it now handles all characters. Receives the per-character `jumpState` as a parameter — `jumpState` is not a single global; the local player's is `this.jumpState`, remote characters use `this.remoteJumpStates.get(playerID)`. "Animation currently running" is checked via `AnimatedCharacter.currentAnimation?.isPlaying`.

```typescript
function updateSnapshotFallbackAnimation(
    char: AnimatedCharacter,
    charData: CharacterSnapshot,
    config: CharacterConfig,
    jumpState: JumpState,
): void {
    if (jumpState !== JumpState.GROUNDED) return;  // jump logic takes precedence

    switch (charData.state) {
        case CharacterState.Attacking:
            // Fallback for latecomers who missed the AttackStarted event.
            // Always plays attackAnimations[0] — snapshot carries no chain stage.
            if (!char.currentAnimation?.isPlaying)
                char.playAnimation(config.attackAnimations[0], true);
            break;
        case CharacterState.Casting:
            // Fallback for latecomers who missed the SkillUsed event.
            // Always plays skillAnimations[0] — snapshot carries no skill slot.
            if (!char.currentAnimation?.isPlaying)
                char.playAnimation(config.skillAnimations[0], true);
            break;
        case CharacterState.Dead:   /* existing death logic */ break;
        case CharacterState.Stunned: /* existing hit logic */ break;
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

`updateLocalAnimation` handles movement and jump only. Attack/skill animation is initiated by `processEvents`. The handoff is governed by `currentAnimState`:

**State machine:**

1. `processEvents` fires `AttackStarted` → plays the animation (`loop=false`), sets `currentAnimState = 'attack'`.
2. Every frame, `updateLocalAnimation` runs:
   - If `currentAnimState === 'attack'`:
     - Check `char.currentAnimation?.isPlaying`
     - **Still playing + movement input** → cancel: switch to walk/run, reset `currentAnimState = ''`
     - **Still playing, no movement** → do nothing (let it finish)
     - **Finished** (`!isPlaying`) → reset `currentAnimState = ''` → movement/idle resumes next frame
   - If `currentAnimState === 'skill'`:
     - Movement input does **not** cancel — server enforces `canMove = false` for skill1 and speed reduction for skill2
     - **Still playing** → do nothing
     - **Finished** → reset `currentAnimState = ''`
   - If `currentAnimState === ''`:
     - Normal movement/idle logic runs

**Skill2 visual note:** Skill2 allows 70% movement speed (`movementMultiplier = 0.7f`). The server permits physical movement during the cast, but the client plays the skill animation uninterrupted and does not switch to walk/run. The character visually slides while swinging. This is a known limitation for partial-movement skills and is acceptable for the current stage.

---

## Out of Scope

- 2H melee, ranged, or other character classes
- Client-side prediction with server reconciliation
- Snapshot sub-state context (chain stage, skill slot) — latecomers always see index-0 fallback for both Attacking and Casting
- Hit effects, floating damage numbers, kill feed (existing TODOs)
- AI combat
- Networking changes beyond the two new event types

---

## File Change Summary

Note: this project uses header-only C++ — all implementation lives in `.hpp` files via `inline`. There are no `.cpp` files for these systems.

| File | Change |
|------|--------|
| `game-core/src/events/NetworkEvents.hpp` | Add `AttackStartedEvent`, `SkillUsedEvent` to variant; narrow `StateChangeEvent` comment to Stunned-only |
| `game-core/src/Skills.hpp` | Add `castDuration`, `castTimer`, `hitPending`, `isCasting()`, `endCast()`, updated `trigger()` with assert to `SkillDefinition` |
| `game-core/src/components/CombatController.hpp` | Add `BufferedAction` enum + `bufferedAction` field |
| `game-core/src/components/CharacterController.hpp` | Add `activeMovementMultiplier` field (default `1.0f`) |
| `game-core/src/systems/CombatSystem.hpp` | Buffer logic, skill cast tick with dead-during-cast guard, new event emission, remove StateChange for attack/cast, set/restore `activeMovementMultiplier` |
| `game-core/src/systems/CharacterControllerSystem.hpp` | Remove lines 121–123 (redundant Attacking state set from input); multiply speed by `activeMovementMultiplier` |
| `game-core/src/Presets.hpp` | 3-stage Knight chain, skill cast durations |
| `backend/src/game/messages.rs` | Add `AttackStarted`, `SkillUsed` to `GameServerMessage` |
| `frontend/src/game/types.ts` | Add both to `GameServerMessage` and `GameEvent` unions |
| `frontend/src/game/characterConfigs.ts` | Add `attackAnimations`, `skillAnimations` to `CharacterConfig` interface and Knight/Rogue configs |
| `frontend/src/components/GameBoard/SimpleGameClient.tsx` | Add `characterConfigMap`; `processEvents` handles new events with per-player config lookup; `updateRemoteAnimation` renamed to `updateSnapshotFallbackAnimation`, receives `jumpState` parameter, unified for all players; `updateLocalAnimation` reduced to movement + jump + attack handoff state machine |
