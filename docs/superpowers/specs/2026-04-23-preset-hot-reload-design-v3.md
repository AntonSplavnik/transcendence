# Dev-Only Preset Hot-Reload (v3)

## Overview

When a character preset JSON is saved during development, the running game
detects the change and reapplies values to all live entities using that preset.
No server restart, no recompilation.

## Trigger

Poll `std::filesystem::last_write_time` per preset file every ~60 update
cycles (~1 second at 60 Hz). A per-file mtime map tracks which files changed
since the last check. Only changed files are re-parsed and reapplied.

## Dev Gating

The codebase already defines `-DNDEBUG` in release builds (`build.rs:68`).
All hot-reload code lives behind `#ifndef NDEBUG` and compiles out entirely
in release builds. No new preprocessor flags are needed.

Rationale: a custom `-DDEV` flag would duplicate the existing `NDEBUG`
mechanism. There is no use case where debug assertions should be active but
hot-reload should not (or vice versa). Using the standard flag avoids a new
build configuration axis.

## Architecture

The hot-reload is split across three sites, matching the existing extraction
pattern used by `EntityFactory`, `MapLoader`, and `CharacterPresetLoader`:

| Class | Role |
|---|---|
| `ArenaGame` | Owns the reloader instance, controls polling cadence via a simple counter. Decides **when** to poll. |
| `DevPresetReloader` | New class. Owns mtime map and directory path. Performs detection, parsing, registry update, and entity reapply. Decides **what** to reload. |
| `CharacterPresetRegistry` | Gains one new public method (`loadOrReplace`) to allow single-entry mutation. Existing `loadFromDirectory()` is unchanged. |

`World` is not modified. It already carries seven responsibilities (system
wiring, update delegation, entity creation delegation, player management,
game mode setup, event plumbing, ID mapping). The hot-reload logic needs
only two of World's members (`m_registry`, `m_presetRegistry`), both of
which can be passed by reference — the same pattern `EntityFactory` uses
with `entt::registry&`.

## Insertion Point

The polling check runs inside `ArenaGame::update()`, after `checkMatchOver()`.
ArenaGame increments a counter each update call and only invokes the reloader
when the counter reaches the threshold:

```
earlyUpdate(dt)
fixedUpdate(dt) x N
update(dt)
lateUpdate(dt)
checkMatchOver()
                        ┐
if (++counter >= 60) {  │  #ifndef NDEBUG
    counter = 0;        │
    reloader.check();   │
}                       ┘
```

All systems have finished their update phases. No active registry iteration.
Entity state is stable. The game loop thread already holds `Mutex<GameHandle>`
(acquired at `game.rs:110`, released at `game.rs:120`), so no cross-thread
concerns.

## Reload Mechanics

### Step 1 — Detect changes

`DevPresetReloader` stores an
`std::unordered_map<std::string, std::filesystem::file_time_type>` mapping
each preset file path to its last known mtime.

The constructor seeds this map by scanning `GameConfig::PRESETS_DIR` and
recording each file's `last_write_time` without loading or applying anything.
This establishes the baseline so the first `checkAndReload()` call only
detects genuine changes, not the entire directory.

On each `checkAndReload()` call, verify the directory exists before
iterating: if `!fs::exists(dir) || !fs::is_directory(dir)`, return
immediately (matching the guard in
`CharacterPresetRegistry::loadFromDirectory`, `CharacterPresetRegistry.hpp:47`).
Then iterate `GameConfig::PRESETS_DIR` (`"assets/presets"`) using
`std::filesystem::recursive_directory_iterator` (matching how
`CharacterPresetRegistry::loadFromDirectory` scans at startup,
`CharacterPresetRegistry.hpp:53`). Filter to `.json` files. Compare each
file's `last_write_time` against the stored value. Collect only files whose
mtime is newer or that are not yet in the map (new files added after startup).

The entire `checkAndReload()` body is wrapped in
`try { ... } catch (const std::exception& e)` as a top-level guard. This
catches both directory-iteration failures (`std::filesystem::filesystem_error`)
and any unexpected exception, preventing propagation through the CXX bridge
which would panic the game loop thread. On catch: log the error to `stderr`
and return — the next polling cycle will retry.

### Step 2 — Re-parse changed files

For each changed file, construct a `CharacterPresetLoader` (stateless,
`CharacterPresetLoader.hpp:29`) and call `loadFromFile(filePath, id)` where
`id` is `entry.path().stem().string()` — the filename stem, matching the
convention in `CharacterPresetRegistry::loadFromDirectory`
(`CharacterPresetRegistry.hpp:58`).

Each `loadFromFile` call is additionally wrapped in its own inner
`try { ... } catch (const std::exception& e)`: `loadFromFile` throws
`std::runtime_error` on file-open failure (`CharacterPresetLoader.hpp:246`),
JSON parse error (line 257), schema key validation via
`detail::requireKeysExactly` (lines 260-265), schema version mismatch
(line 268), empty id (line 271), id mismatch (lines 273-275), or
field-level validation errors inside `detail::parseHealth`, `parseMovement`,
`parseCollider`, `parseStamina`, `parseCombat` (lines 279-283).

On catch: log the error to `stderr`, skip that file. Other presets and the
registry remain untouched.

### Step 3 — Update registry

For each successfully parsed preset, call
`CharacterPresetRegistry::loadOrReplace(id, std::move(preset))` — a new
method that performs `m_presets.insert_or_assign(id, std::move(preset))`.
This handles both existing entries (update) and new files (insert).

Update the mtime map entry for that file path.

### Step 4 — Reapply to affected entities (single pass)

Collect all reloaded preset ids into an `std::unordered_set<std::string>`.
Iterate `registry.view<PresetBinding>()` once. For each entity, check if
its `PresetBinding::id` is in the set. If not, skip. If so, look up the
preset from the registry and replace the entity's preset-sourced components:

**Components created by `EntityFactory::createActor` (`EntityFactory.hpp:76-91`):**

- `Health::createFromPreset(preset.health)` — takes `const HealthPreset&`
- `PhysicsBody::createFromPreset(preset.movement)` — takes `const MovementPreset&`
- `Collider::createFromPreset(preset.collider, layer)` — takes `const ColliderPreset&` AND `CollisionLayer`. The second argument must be read from the entity's existing `Collider` component before replacement:
  ```cpp
  CollisionLayer layer = registry.get<Collider>(entity).layer;
  registry.replace<Collider>(entity, Collider::createFromPreset(preset.collider, layer));
  ```
- `Stamina::createFromPreset(preset.stamina)` — takes `const StaminaPreset&`
- `CombatController::createFromPreset(preset.combat)` — takes `const CombatPreset&`

**Component created by `World::createPlayer` (`World.hpp:359`), not by `EntityFactory`:**

- `CharacterController::createFromPreset(preset.movement)` — takes `const MovementPreset&`

Not all preset-bound entities have `CharacterController`. Players do
(`World::createPlayer` adds it at `World.hpp:359`). Bots created via
`createBot` -> `createActor` do not. The reapply must guard this:

```cpp
if (registry.all_of<CharacterController>(entity)) {
    registry.replace<CharacterController>(entity,
        CharacterController::createFromPreset(preset.movement));
}
```

Full replacement resets runtime state (current HP, cooldown timers, stamina,
chain stage) to defaults. Dead entities (`health.isDead == true`) will be
revived with full HP. This is acceptable for dev tuning — the purpose is
to observe parameter changes immediately, not to preserve game state.

### Edge cases

- **New file:** If a new `.json` appears in the directory (not in the mtime
  map), parse it, add to registry via `loadOrReplace`, update mtime map.
  No entities will have that id yet, so step 4 is a no-op.
- **Deleted file:** If a file in the mtime map no longer exists on disk,
  remove it from the mtime map but leave the registry entry. Existing
  entities keep their current values. Log a warning to `stderr`.
- **Parse failure:** Catch `std::exception`, log to `stderr`, skip that
  file. Registry and entities are unchanged for that preset.
- **Partial save (non-atomic write):** Some editors truncate-then-write
  rather than atomic-rename. A read during the truncated window could yield
  partial JSON. This is handled by the parse failure path — the incomplete
  JSON will fail `nlohmann::json::parse`, the error is logged, and the next
  polling cycle will detect the completed write via a newer mtime.
- **File rename** (e.g. `rogue.json` → `assassin.json`): Appears as a
  new-file + deleted-file pair. The old preset id (`"rogue"`) remains in
  the registry; entities bound to it are orphaned from further reloads.
  If the developer forgets to update the JSON's internal `"id"` field to
  match the new filename, `loadFromFile` throws an id-mismatch error
  (`CharacterPresetLoader.hpp:273-275`) and the file is skipped until
  corrected. This is a known limitation — renaming a preset requires
  updating both the filename and the JSON id.
- **Directory missing at poll time:** If `GameConfig::PRESETS_DIR` is
  temporarily removed or inaccessible, the exists/is_directory guard
  returns immediately. No error, no crash. The next cycle retries.

### Logging

The C++ codebase has no logging framework. Hot-reload log output uses
`fprintf(stderr, ...)` guarded by `#ifndef NDEBUG` (same guard as the
rest of the feature, so no runtime cost in release). Format:

```
[hot-reload] reloaded preset 'rogue' (5 entities updated)
[hot-reload] ERROR: failed to parse 'rogue.json': <exception message>
[hot-reload] WARNING: preset file removed from disk: 'rogue.json'
```

## Code Changes

### New file: `game-core/src/core/DevPresetReloader.hpp`

~100 lines. Single class, header-only (matching codebase convention).

```cpp
class DevPresetReloader {
public:
    DevPresetReloader(entt::registry& registry,
                      CharacterPresetRegistry& presets);

    void checkAndReload();

private:
    entt::registry& m_registry;
    CharacterPresetRegistry& m_presets;
    std::unordered_map<std::string, std::filesystem::file_time_type> m_mtimes;
};
```

Constructor scans `GameConfig::PRESETS_DIR`, recording each `.json` file's
`last_write_time` into `m_mtimes` (baseline snapshot — no loading or
applying). `checkAndReload()` performs steps 1-4 inside a top-level
try-catch. The entire file is wrapped in `#ifndef NDEBUG` / `#endif`.

### Modified: `game-core/src/core/CharacterPresetRegistry.hpp`

Add one public method:

```cpp
void loadOrReplace(const std::string& id, CharacterPreset preset) {
    m_presets.insert_or_assign(id, std::move(preset));
}
```

This is the minimal mutation surface needed. `loadFromDirectory()` is
unchanged — it remains the single-shot startup path.

### Modified: `game-core/src/core/World.hpp`

Add one public accessor (one line):

```cpp
CharacterPresetRegistry& getPresetRegistry() { return m_presetRegistry; }
```

No other changes to World. No new includes, no new members, no new logic.

### Modified: `game-core/src/ArenaGame.hpp`

Add include, member field, counter, and polling call — all behind
`#ifndef NDEBUG`.

**Member declaration order:** `m_devReloader` and `m_devReloadCounter`
must be declared **after** `m_world` (line 105) to satisfy C++ member
initialization order — `m_devReloader`'s constructor reads from `m_world`.

```cpp
// Include (at top, guarded):
#ifndef NDEBUG
#include "core/DevPresetReloader.hpp"
#endif

// Private members (AFTER m_world at line 105):
#ifndef NDEBUG
DevPresetReloader m_devReloader;
int m_devReloadCounter = 0;
#endif

// Constructor initializer list:
#ifndef NDEBUG
, m_devReloader(m_world.getRegistry(), m_world.getPresetRegistry())
#endif

// In update(), after checkMatchOver():
#ifndef NDEBUG
if (++m_devReloadCounter >= 60) {
    m_devReloadCounter = 0;
    m_devReloader.checkAndReload();
}
#endif
```

### Modified: `game-core/src/components/PresetBinding.hpp`

Remove the stale comment at lines 8-10 ("Today this is informational.
Future hot-reload will query entities by id..."). The feature now exists.

### Modified: `backend/build.rs`

Remove `rerun-if-changed` line for `../game-core/assets/presets` (line 82).
Without this removal, editing a preset JSON triggers a full `cargo build`,
defeating the purpose of runtime hot-reload.

The `rerun-if-changed` line for `../game-core/assets/map.json` (line 81) is
kept. Map data is not hot-reloaded by this feature and the line is unrelated.

### No Rust changes

No CXX bridge additions. No new endpoints. The hot-reload is entirely
self-contained in C++.

## Summary of differences from v2

| Aspect | v2 | v3 |
|---|---|---|
| mtime map initialization | Empty — first check reloads all presets and resets all entity state | Constructor seeds map from disk — first check is a no-op unless files actually changed |
| Directory iteration guard | None — `filesystem_error` propagates through CXX bridge and panics game loop | `fs::exists` / `fs::is_directory` guard before iterator, plus top-level `try-catch` in `checkAndReload()` |
| Member declaration order | Not specified — risk of UB if declared before `m_world` | Explicitly placed after `m_world` (line 105) to satisfy C++ initialization order |
| Entity reapply iteration | Per-preset: O(changed_presets × entities) | Single pass with `unordered_set` lookup: O(entities) |
| Exception inventory | `CharacterPresetLoader.hpp:243-276` | Full range: file-open (246), JSON parse (257), key validation (260-265), schema version (268), id checks (271, 273-275), field-level validation (279-283) |
| File rename edge case | Not documented | Documented as known limitation — old id orphaned, id mismatch caught |
| Directory-missing edge case | Not documented | Documented — guard returns immediately, next cycle retries |
| Estimated file size | ~80 lines | ~100 lines (constructor init + top-level try-catch + set-based reapply) |

## Summary of differences from v1

| Aspect | v1 | v3 |
|---|---|---|
| Reload logic location | `World::devCheckPresetReload()` | `DevPresetReloader::checkAndReload()` (new class) |
| Polling cadence | Frame counter inside World | Counter inside ArenaGame, calls reloader only when threshold reached |
| Dev gating | New `-DDEV` flag added to `build.rs` | Existing `NDEBUG` mechanism (`#ifndef NDEBUG`), no build.rs flag changes |
| World.hpp changes | New method, new member fields, new `#include <filesystem>` | One-line accessor only |
| Registry mutation | `reloadSingle(filePath, id)` | `loadOrReplace(id, preset)` — handles both insert and update |
| Collider reapply | `Collider::createFromPreset(preset.collider)` (wrong arity) | Reads existing `CollisionLayer` before replacement |
| CharacterController | Applied unconditionally to all entities | Guarded: only replaced if entity has the component |
| Exception handling | Implicit ("log the error and skip") | Top-level try-catch + per-file try-catch, full exception inventory |
| Logging | Unspecified | `fprintf(stderr, ...)` with `[hot-reload]` prefix |
| `map.json` rerun-if-changed | Removed (unrelated scope creep) | Kept |
| mtime baseline | Not specified | Constructor seeds map — no first-check storm |
| Directory guard | Not specified | `exists` / `is_directory` check before iteration |
| Reapply algorithm | Not specified | Single-pass with `unordered_set` lookup |
