# Dev-Only Preset Hot-Reload

## Overview

When a character preset JSON is saved during development, the running game
detects the change and reapplies values to all live entities using that preset.
No server restart, no recompilation.

## Trigger

Poll `std::filesystem::last_write_time` per preset file every ~60 frames
(~1 second at 60 Hz). A per-file mtime map tracks which files changed since
the last check. Only changed files are re-parsed and reapplied.

## Dev Gating

A `-DDEV` preprocessor flag is added to `build.rs` in the non-release branch.
All hot-reload code lives behind `#ifdef DEV` and compiles out entirely in
release builds.

## Insertion Point

The reload check runs as the last step in `ArenaGame::update()`, after
`checkMatchOver()`:

```
earlyUpdate(dt)
fixedUpdate(dt) x N
update(dt)
lateUpdate(dt)
checkMatchOver()
devCheckPresetReload()   <-- new, last thing before frame ends
```

All systems have finished their update phases. No active registry iteration.
Entity state is stable. The game loop thread already holds `Mutex<GameHandle>`,
so no cross-thread concerns.

## Reload Mechanics

### Step 1 — Detect changes

Store a `std::unordered_map<std::string, std::filesystem::file_time_type>`
mapping each preset filename to its last known mtime. Every ~60 frames,
iterate the presets directory and compare each file's `last_write_time` against
the stored value. Collect only the files whose mtime is newer.

### Step 2 — Re-parse changed files

For each changed file, run `CharacterPresetLoader::loadFromFile()`. If parsing
fails, log the error and skip that file. Other presets and the registry remain
untouched.

### Step 3 — Update registry

For each successfully parsed preset, replace the corresponding entry in the
registry's internal map. Other entries stay as-is.

### Step 4 — Reapply to affected entities only

For each reloaded preset id, iterate `m_registry.view<PresetBinding>()` and
filter to entities whose `PresetBinding::id` matches. Full-replace their
components with fresh `createFromPreset()` values:

- `Health::createFromPreset(preset.health)`
- `PhysicsBody::createFromPreset(preset.movement)`
- `Collider::createFromPreset(preset.collider)`
- `Stamina::createFromPreset(preset.stamina)`
- `CombatController::createFromPreset(preset.combat)`
- `CharacterController::createFromPreset(preset.movement)`

Full replacement resets runtime state (current HP, cooldown timers, chain
stage) to defaults. Acceptable for dev tuning.

### Edge cases

- **New file:** If a new JSON appears in the directory (not in the mtime map),
  parse it, add to registry, update mtime map. No entities will have that id
  yet, so step 4 is a no-op.
- **Deleted file:** Remove from the mtime map but leave the registry entry.
  Existing entities keep their values. Log a warning.
- **Parse failure:** Log the error, skip that file. Registry and entities are
  unchanged for that preset.

## Code Changes

### `backend/build.rs`

- Add `-DDEV` flag in the non-release `else` branch.
- Remove `rerun-if-changed` line for `../game-core/assets/map.json`.
- Remove `rerun-if-changed` line for `../game-core/assets/presets`.

### `game-core/src/core/World.hpp`

- New method: `void devCheckPresetReload()` — per-file mtime polling,
  selective reload, entity reapply. Wrapped in `#ifdef DEV`.
- New member fields (`#ifdef DEV`): per-file mtime map, frame counter.

### `game-core/src/core/CharacterPresetRegistry.hpp`

- New method: `void reloadSingle(const std::string& filePath, const std::string& id)`
  — parses one file and replaces that entry in the internal map. Existing
  `loadFromDirectory()` stays untouched for initial startup.

### `game-core/src/ArenaGame.hpp`

- Call `m_world.devCheckPresetReload()` after `checkMatchOver()` in `update()`.

### `game-core/src/components/PresetBinding.hpp`

- Remove the stale "future hot-reload" comment (we are implementing it).

### No Rust changes

No CXX bridge additions. No new endpoints. No new files. The hot-reload is
entirely self-contained in C++.
