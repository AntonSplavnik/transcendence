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
- Correct hit timing: damage resolves at **end** of swing/cast, not at start.
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
    └── charData.state == Attacking/Casting
        └── fallback only — plays attackAnimations[0] if no animation currently running
            (handles late-joining clients who missed the event)
```

---

## Section 1 — New Network Events

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

```rust
AttackStarted { player_id: u32, chain_stage: u8 },
SkillUsed     { player_id: u32, skill_slot: u8  },
```

### TypeScript (`frontend/src/game/types.ts`)

```typescript
| { type: 'AttackStarted'; player_id: number; chain_stage: number }
| { type: 'SkillUsed';     player_id: number; skill_slot: number  }
```

`GameEvent` union updated to include both. `StateChange` remains in `GameEvent` for `Stunned`/`Dead`.

---

## Section 2 — Server: Skills (`game-core/src/Skills.hpp`)

`SkillDefinition` gains cast duration tracking, mirroring the `swingTimer`/`hitPending` pattern on `CombatController`:

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

    void trigger() {
        castTimer  = castDuration;
        hitPending = true;
    }

    void endCast() {
        timer      = cooldown;
        castTimer  = 0.0f;
    }
};
```

**Parallel to normal attacks:**

| Normal attack        | Skill                        |
|----------------------|------------------------------|
| `swingTimer`         | `castTimer`                  |
| `isAttacking`        | `isCasting()`                |
| `hitPending`         | `hitPending` on SkillDef     |
| `stage.duration`     | `castDuration`               |
| `stage.movementMul`  | `MeleeAOE.movementMultiplier`|

`movementMultiplier` is enforced by `CombatSystem` during cast (currently wired in the struct but never read — this adds the reader).

---

## Section 3 — Server: Input Buffering (`game-core/src/components/CombatController.hpp`)

One new field replaces the previous `bufferedAttack: bool` proposal. Covers all three actions with last-pressed-wins semantics:

```cpp
enum class BufferedAction : uint8_t { None, Attack, Skill1, Skill2 };
BufferedAction bufferedAction = BufferedAction::None;
```

### In `CombatSystem::processInputAttacks()`

```cpp
// Buffer any input that arrives while the character is committed to an action
if (comcon.isAttacking || comcon.ability1.isCasting() || comcon.ability2.isCasting()) {
    if (charcon.input.isAttacking)      comcon.bufferedAction = BufferedAction::Attack;
    if (charcon.input.isUsingAbility1)  comcon.bufferedAction = BufferedAction::Skill1;
    if (charcon.input.isUsingAbility2)  comcon.bufferedAction = BufferedAction::Skill2;
    return;
}

// Normal path — consume buffered action or live input
BufferedAction toFire = comcon.bufferedAction;
comcon.bufferedAction = BufferedAction::None;

const bool wantsAttack = charcon.input.isAttacking  || toFire == BufferedAction::Attack;
const bool wantsSkill1 = charcon.input.isUsingAbility1 || toFire == BufferedAction::Skill1;
const bool wantsSkill2 = charcon.input.isUsingAbility2 || toFire == BufferedAction::Skill2;
```

Because `updateCooldowns` runs before `processInputAttacks` in the same frame, a buffered action set by the previous frame's input fires in the same tick that the swing ends — zero extra latency.

---

## Section 4 — Server: `CombatSystem` Changes

### `processInputAttacks`

- Emit `AttackStartedEvent { playerID, chainStage }` when an attack starts. `chainStage` is `comcon.chainStage` at the moment `startAttack()` is called.
- Emit `SkillUsedEvent { playerID, skillSlot }` when a skill cast starts. `skillSlot` is `1` when `wantsSkill1` triggered it, `2` when `wantsSkill2` triggered it.
- **Remove** `StateChangeEvent { Attacking }` and `StateChangeEvent { Casting }` — replaced by the above.
- **Keep** `controller.setState(CharacterState::Attacking)` and `controller.setState(CharacterState::Casting)` — the snapshot still needs these states so latecomer clients can trigger the fallback animation in `updateRemoteAnimation`.

### `updateCooldowns`

- Add skill cast tick: decrement `castTimer`; when it hits zero call `endCast()`, apply the deferred skill hit, clear `hitPending`.
- Enforce `movementMultiplier` during skill cast: if `MeleeAOE.movementMultiplier == 0.0f` and skill is casting, set `controller.canMove = false`. Restore on cast end.

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

3-stage chain replaces the existing 2-stage chain:

```cpp
.attackChain = {
    // Stage 0 — diagonal slice: quick opener
    { .damageMultiplier=0.8f, .range=2.0f, .duration=0.45f,
      .movementMultiplier=0.0f, .chainWindow=0.6f },
    // Stage 1 — horizontal slice: mid combo
    { .damageMultiplier=0.9f, .range=2.2f, .duration=0.50f,
      .movementMultiplier=0.0f, .chainWindow=0.5f },
    // Stage 2 — stab: heavy finisher, chain resets
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

`CharacterConfig` gains animation arrays. Index maps directly to chain stage / skill slot:

```typescript
export interface CharacterConfig {
    // ... existing fields ...
    attackAnimations: string[];  // [stage0, stage1, stage2, ...]
    skillAnimations:  string[];  // [skill1, skill2, ...]
}
```

Knight:
```typescript
attackAnimations: [
    'Melee_1H_Attack_Slice_Diagonal',
    'Melee_1H_Attack_Slice_Horizontal',
    'Melee_1H_Attack_Stab',
],
skillAnimations: [
    'Melee_1H_Attack_Jump_Chop',  // skill1
    'Melee_1H_Attack_Chop',       // skill2 — placeholder until a better animation is chosen
],
```

Rogue will get its own arrays when implemented (`Melee_Dualwield_*`).

---

## Section 7 — Client: `SimpleGameClient.tsx`

### `processEvents` — primary animation driver

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

Same code path for local and remote. No special casing.

### `updateRemoteAnimation` — snapshot fallback only

When `charData.state === Attacking` and no animation is playing (late joiner missed the event):
→ play `config.attackAnimations[0]` (loop=true, continuous until state changes).

When `charData.state === Casting` and no animation is playing:
→ play `config.skillAnimations[0]` (loop=true).

This function is called for **all** characters including local — unified path.

### `updateLocalAnimation` — movement and jump only

Removes all attack/skill state management. Retains:
- Jump state machine (`tickJumpState`)
- Movement: walk / run / idle based on input

Attack and skill animation state is no longer tracked here — `currentAnimState` for those values is set by `processEvents`.

---

## Out of Scope

- 2H melee, ranged, or other character classes
- Client-side prediction with server reconciliation
- Hit effects, floating damage numbers, kill feed (existing TODOs)
- AI combat
- Networking changes beyond the two new event types

---

## File Change Summary

| File | Change |
|------|--------|
| `game-core/src/events/NetworkEvents.hpp` | Add `AttackStartedEvent`, `SkillUsedEvent` to variant |
| `game-core/src/Skills.hpp` | Add `castDuration`, `castTimer`, `hitPending`, `isCasting()`, `endCast()` to `SkillDefinition` |
| `game-core/src/components/CombatController.hpp` | Add `BufferedAction` enum + `bufferedAction` field |
| `game-core/src/systems/CombatSystem.hpp` | Buffer logic, skill cast tick, new event emission, remove StateChange for attack/cast |
| `game-core/src/systems/CharacterControllerSystem.hpp` | Remove lines 121–123 |
| `game-core/src/Presets.hpp` | 3-stage Knight chain, skill cast durations |
| `backend/src/game/messages.rs` | Add `AttackStarted`, `SkillUsed` variants |
| `frontend/src/game/types.ts` | Add both to `GameServerMessage` and `GameEvent` |
| `frontend/src/game/characterConfigs.ts` | Add `attackAnimations`, `skillAnimations` to `CharacterConfig` |
| `frontend/src/components/GameBoard/SimpleGameClient.tsx` | `processEvents` handles new events; `updateRemoteAnimation` becomes fallback; `updateLocalAnimation` movement-only |
