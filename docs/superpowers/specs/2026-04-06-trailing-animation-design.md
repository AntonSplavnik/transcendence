# Trailing Animation Design — Swing Trails

**Date:** 2026-04-06
**Branch:** feat/game-trailing-animation
**Scope:** Frontend only (BabylonJS) — no backend changes required

---

## Summary

Add a ribbon trail effect to character weapon swings. The trail follows the weapon tip for the last 50% of the swing arc, fades from transparent to bright, and tapers from zero width at the tail to full width at the tip. Colors are per character class.

---

## Visual Specification

- **Style:** Ribbon / arc trail (flat translucent ribbon stretching behind the weapon tip)
- **Duration:** Rolling window covering the last 50% of `swing_progress` (not time-based — uses progress units for accuracy across varying server tick rates)
- **Width:** Tapers from `maxWidth` (~0.15 world units) at the newest point to 0 at the oldest
- **Alpha:** Fades from 0 (oldest/tail) to ~0.85 (newest/tip)
- **Colors per class:**
  - Knight: base `rgb(79, 195, 247)` (ice blue) → tip `rgb(255, 255, 255)` (white/silver)
  - Rogue: base `rgb(102, 187, 106)` (toxic green) → tip `rgb(200, 255, 200)` (light green)

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/game/SwingTrail.ts` | **New** — self-contained trail class |
| `frontend/src/game/AnimatedCharacter.ts` | Add `trail` field, `initTrail()`, `getWeaponTipMesh()` |
| `frontend/src/game/characterConfigs.ts` | Add `trailColor` field to `CharacterConfig` |
| `frontend/src/components/GameBoard/SimpleGameClient.tsx` | Call `initTrail()` after load; call `trail.update()` each frame |

---

## SwingTrail Class

**File:** `frontend/src/game/SwingTrail.ts`

Single responsibility: given a weapon tip mesh and `swing_progress` each frame, render a ribbon trail.

### Constructor config

```ts
{
  baseColor: Color3   // tail end color
  tipColor: Color3    // weapon-end color (bright)
  maxWidth: number    // ribbon width at newest point (~0.15 world units)
}
```

### Public API

```ts
update(weaponTipMesh: AbstractMesh, swingProgress: number): void
dispose(): void
```

### Internal state

```ts
history: Array<{ pos: Vector3, progress: number }>
ribbon: Mesh | null   // updatable BabylonJS ribbon mesh
lastProgress: number  // detects swing reset (prev > 0, current == 0)
```

### update() logic

1. **`swingProgress > 0` (swing active):**
   - Sample weapon tip world position, push `{ pos, progress }` to history
   - Prune entries where `swingProgress - entry.progress >= 0.5` (keep last 50% of arc)
   - If `history.length >= 3`: build/update ribbon with width taper and vertex color gradient
   - If ribbon doesn't exist yet: create with `updatable: true`; otherwise update via `CreateRibbon({ instance })`

2. **`swingProgress == 0` and `lastProgress > 0` (swing just ended):**
   - Clear history, set `ribbon.isVisible = false` (keep mesh alive for reuse next swing)

3. **`swingProgress == 0` (idle):** no-op

### Ribbon geometry

The ribbon is built from two parallel paths (top/bottom edges) offset perpendicular to the direction of travel, with width at each point proportional to its recency `(1 - age)` where `age = (currentProgress - entry.progress) / 0.5`.

Color gradient is applied via `StandardMaterial` with `vertexColorsEnabled = true` and a `VertexData` colors array updated each frame alongside the ribbon paths. Alpha blending enabled via `material.alpha` and `hasVertexAlpha = true`.

---

## CharacterConfig changes

Add to `CharacterConfig` interface:

```ts
trailColor: {
  base: [number, number, number]  // RGB 0–255
  tip:  [number, number, number]  // RGB 0–255
}
```

Knight and Rogue configs updated with their respective colors.

---

## AnimatedCharacter changes

```ts
trail: SwingTrail | null = null

// Called once after loadCharacter() completes
initTrail(scene: Scene, config: CharacterConfig): void

// Returns the right-hand weapon mesh (equipment slot 0, first non-__root__ mesh)
getWeaponTipMesh(): AbstractMesh | null
```

`dispose()` updated to also call `this.trail?.dispose()`.

---

## SimpleGameClient integration

**After `loadCharacter(char, config)`:**
```ts
char.initTrail(scene, config)
```

**Inside the render loop, per-character snapshot update:**
```ts
const weaponTip = char.getWeaponTipMesh()
char.trail?.update(weaponTip, charData.swing_progress)
```

This covers both local and remote characters. `update()` handles the idle case internally (no-op when `swing_progress == 0` and was already 0).

---

## Data flow

```
Server snapshot
  └─ CharacterSnapshot.swing_progress (0.0 → 1.0)
       └─ SimpleGameClient.processSnapshot() / render loop
            └─ AnimatedCharacter.trail.update(weaponTipMesh, swingProgress)
                 ├─ Record tip world position + progress
                 ├─ Prune history (keep last 50% of progress)
                 └─ Rebuild updatable ribbon mesh
```

---

## Out of scope

- Per-chain-stage trail intensity variation (future enhancement)
- Crit flash / hit spark effects
- Trail for ability skills (MeleeAOE)
- Backend changes
