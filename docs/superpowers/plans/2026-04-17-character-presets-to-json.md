# Character Presets to JSON Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every `CharacterPreset` literal out of `game-core/src/Presets.hpp` into per-character JSON files under `game-core/assets/presets/players/`, loaded at runtime by a new `CharacterPresetLoader` into a `CharacterPresetRegistry` owned by `World`. No gameplay behavior changes — every field in every component must remain byte-exact across the cutover.

**Architecture:** `CharacterPreset` stays as the canonical in-memory struct. A strict JSON loader parses one file per character into that struct. A registry indexes presets by id (filename stem) and is populated by scanning a directory at `World::initialize`. `CharacterClassLookup::presetFromClass` is replaced by `registry.get(id)`. A new `PresetBinding { std::string id }` component is attached to every actor at spawn — it exists solely as a forward hook so hot-reload (deferred) can later answer "which live entities belong to preset X?" without a second refactor. The old `Presets.hpp` is used as a parity oracle during migration, then deleted.

**Tech Stack:** C++20 (`-std=c++20`, `-Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wold-style-cast -Wfloat-equal`), nlohmann/json (single-include at `game-core/nlohmann/json.hpp`), EnTT ECS, cxx.rs bridge, Cargo/`cargo build` (not `make build`).

**Decisions locked in (from prior brainstorming):**
- Preset id = filename stem. `knight.json` → id `"knight"`.
- Data location: `game-core/assets/presets/players/*.json`. Shipped via existing Dockerfile rule `COPY --from=backend /build/game-core/assets/ ./assets/` at `Dockerfile:78`. No symlink, no new COPY.
- `schema_version` starts at `1`. Loader rejects any other value.
- Strict parse: unknown keys throw, missing required fields throw, errors name file + field path.

**Not in scope (deferred; do not implement):**
- File watcher / hot-reload.
- `PresetRefreshSystem` and mid-action safe-boundary rules.
- `extends` / prototype inheritance.
- Modifier DSL (runtime numeric scaling).
- Composition / shared profile blocks.
- Enemy preset files (schema accepts them; none authored this round).
- Frontend consumption of preset data (separate brief).

**Testing note for executing engineer:** `game-core/` has no C++ unit-test harness today, and adding one is bigger than this refactor. The "test" for mechanical JSON-to-C++ parity is a temporary `verifyParity()` function called from `World::initialize` during Tasks 3 and 5. It compares every parsed field against the existing `Presets::KNIGHT` / `Presets::ROGUE` literals and throws with a descriptive message on any mismatch. The game fails to start if parity breaks. `verifyParity()` and the old `Presets.hpp` are removed in Task 8 after the registry is live. Final verification is a real server boot plus a manual match (Task 10).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `docs/schemas/character-preset.v1.json` | Create | JSON Schema for CI validation |
| `game-core/assets/presets/players/knight.json` | Create | Serialized `Presets::KNIGHT` |
| `game-core/assets/presets/players/rogue.json` | Create | Serialized `Presets::ROGUE` |
| `game-core/src/core/CharacterPresetLoader.hpp` | Create | Strict JSON → `CharacterPreset` parser |
| `game-core/src/core/CharacterPresetRegistry.hpp` | Create | id → `CharacterPreset` lookup, scans directory |
| `game-core/src/components/PresetBinding.hpp` | Create | `{ std::string id }` component |
| `game-core/src/components/Components.hpp` | Modify | Add `PresetBinding` include |
| `game-core/src/GameTypes.hpp` | Modify | Add `PRESETS_DIR` constant |
| `game-core/src/core/EntityFactory.hpp` | Modify | `createActor` takes id; attaches `PresetBinding` |
| `game-core/src/core/World.hpp` | Modify | Owns registry; `createPlayer` uses it; parity check during migration |
| `game-core/src/Presets.hpp` | Delete (Task 8) | Replaced by JSON |
| `game-core/src/CharacterClassLookup.hpp` | Delete (Task 8) | Replaced by registry |
| `backend/build.rs` | Modify | Add `rerun-if-changed` for presets directory |
| `prek.toml` | Modify | Add JSON Schema validation pre-commit hook |

---

## Task 1: Author the JSON Schema

**Files:**
- Create: `docs/schemas/character-preset.v1.json`

- [ ] **Step 1: Verify the schema directory exists**

```bash
ls docs/schemas/ 2>/dev/null || mkdir -p docs/schemas
```

Expected: either existing directory listing, or new directory created silently.

- [ ] **Step 2: Write the schema file**

Create `docs/schemas/character-preset.v1.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CharacterPreset v1",
  "type": "object",
  "required": ["schema_version", "id", "health", "movement", "collider", "stamina", "combat"],
  "additionalProperties": false,
  "properties": {
    "schema_version": { "const": 1 },
    "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "health": {
      "type": "object",
      "required": ["maxHealth", "armor", "resistance"],
      "additionalProperties": false,
      "properties": {
        "maxHealth":  { "type": "number" },
        "armor":      { "type": "number" },
        "resistance": { "type": "number" }
      }
    },
    "movement": {
      "type": "object",
      "required": [
        "movementSpeed", "rotationSpeed", "sprintMultiplier", "crouchMultiplier",
        "jumpVelocity", "dodgeVelocity", "airControlFactor", "acceleration",
        "deceleration", "mass", "friction", "drag", "maxSpeed", "maxFallSpeed"
      ],
      "additionalProperties": false,
      "properties": {
        "movementSpeed":    { "type": "number" },
        "rotationSpeed":    { "type": "number" },
        "sprintMultiplier": { "type": "number" },
        "crouchMultiplier": { "type": "number" },
        "jumpVelocity":     { "type": "number" },
        "dodgeVelocity":    { "type": "number" },
        "airControlFactor": { "type": "number" },
        "acceleration":     { "type": "number" },
        "deceleration":     { "type": "number" },
        "mass":             { "type": "number" },
        "friction":         { "type": "number" },
        "drag":             { "type": "number" },
        "maxSpeed":         { "type": "number" },
        "maxFallSpeed":     { "type": "number" }
      }
    },
    "collider": {
      "type": "object",
      "required": ["radius", "height"],
      "additionalProperties": false,
      "properties": {
        "radius": { "type": "number" },
        "height": { "type": "number" }
      }
    },
    "stamina": {
      "type": "object",
      "required": ["maxStamina", "baseRegenRate", "drainDelaySeconds", "sprintCostPerSec", "jumpCost"],
      "additionalProperties": false,
      "properties": {
        "maxStamina":         { "type": "number" },
        "baseRegenRate":      { "type": "number" },
        "drainDelaySeconds":  { "type": "number" },
        "sprintCostPerSec":   { "type": "number" },
        "jumpCost":           { "type": "number" }
      }
    },
    "combat": {
      "type": "object",
      "required": ["baseDamage", "damageMultiplier", "criticalChance", "criticalMultiplier", "attackChain", "skill1", "skill2"],
      "additionalProperties": false,
      "properties": {
        "baseDamage":         { "type": "number" },
        "damageMultiplier":   { "type": "number" },
        "criticalChance":     { "type": "number" },
        "criticalMultiplier": { "type": "number" },
        "attackChain": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/definitions/attackStage" }
        },
        "skill1": { "$ref": "#/definitions/skill" },
        "skill2": { "$ref": "#/definitions/skill" }
      }
    }
  },
  "definitions": {
    "attackStage": {
      "type": "object",
      "required": ["damageMultiplier", "range", "duration", "movementMultiplier", "chainWindow", "staminaCost"],
      "additionalProperties": false,
      "properties": {
        "damageMultiplier":   { "type": "number" },
        "range":              { "type": "number" },
        "duration":           { "type": "number" },
        "movementMultiplier": { "type": "number" },
        "chainWindow":        { "type": "number" },
        "attackAngle":        { "type": "number", "default": 0.7 },
        "staminaCost":        { "type": "number" }
      }
    },
    "skill": {
      "type": "object",
      "required": ["params"],
      "additionalProperties": false,
      "properties": {
        "params":       { "$ref": "#/definitions/skillParams" },
        "cooldown":     { "type": "number", "default": 0.0 },
        "castDuration": { "type": "number", "default": 0.0 },
        "staminaCost":  { "type": "number", "default": 0.0 }
      }
    },
    "skillParams": {
      "oneOf": [
        {
          "type": "object",
          "required": ["type", "range", "movementMultiplier", "dmgMultiplier"],
          "additionalProperties": false,
          "properties": {
            "type":               { "const": "melee_aoe" },
            "range":              { "type": "number" },
            "movementMultiplier": { "type": "number" },
            "dmgMultiplier":      { "type": "number" }
          }
        }
      ]
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add docs/schemas/character-preset.v1.json
git commit -m "feat(presets): add JSON schema v1 for character presets"
```

---

## Task 2: Scaffolding — empty loader, registry, component

Stub headers that compile against the rest of the tree but do nothing yet. Creating them first means later tasks only edit one file at a time.

**Files:**
- Create: `game-core/src/core/CharacterPresetLoader.hpp`
- Create: `game-core/src/core/CharacterPresetRegistry.hpp`
- Create: `game-core/src/components/PresetBinding.hpp`
- Modify: `game-core/src/components/Components.hpp`
- Modify: `game-core/src/GameTypes.hpp`

- [ ] **Step 1: Add `PRESETS_DIR` to `GameTypes.hpp`**

In `game-core/src/GameTypes.hpp`, find the `Map data` section (around line 227):

```cpp
	// Map data
	static constexpr const char* MAP_PATH = "assets/map.json";
```

Replace with:

```cpp
	// Map data
	static constexpr const char* MAP_PATH     = "assets/map.json";

	// Character presets
	static constexpr const char* PRESETS_DIR  = "assets/presets";
```

- [ ] **Step 2: Create `PresetBinding.hpp`**

Create `game-core/src/components/PresetBinding.hpp`:

```cpp
#pragma once

#include <string>

namespace ArenaGame {
namespace Components {

// Preset id (filename stem of the JSON file the entity was spawned from).
// Today this is informational. Future hot-reload will query entities by id
// to refresh preset-sourced fields after a file change.
struct PresetBinding {
	std::string id;
};

} // namespace Components
} // namespace ArenaGame
```

- [ ] **Step 3: Register `PresetBinding` in `Components.hpp`**

In `game-core/src/components/Components.hpp`, add below the `CombatController.hpp` include:

```cpp
#include "CombatController.hpp"
#include "PresetBinding.hpp"
```

- [ ] **Step 4: Create the loader stub**

Create `game-core/src/core/CharacterPresetLoader.hpp`:

```cpp
#pragma once

#include "../CharacterPreset.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wconversion"
#pragma GCC diagnostic ignored "-Wsign-conversion"
#pragma GCC diagnostic ignored "-Wold-style-cast"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wfloat-equal"
#include "../../nlohmann/json.hpp"
#pragma GCC diagnostic pop

#include <fstream>
#include <stdexcept>
#include <string>
#include <unordered_set>

namespace ArenaGame {

// =============================================================================
// CharacterPresetLoader — strict JSON → CharacterPreset parser.
// Throws std::runtime_error on any parse failure with a descriptive message
// that names the file path and the offending field path.
//
// Expected schema: see docs/schemas/character-preset.v1.json
// =============================================================================

class CharacterPresetLoader {
public:
	CharacterPreset loadFromFile(const std::string& filePath);
	CharacterPreset loadFromString(const std::string& jsonString, const std::string& sourceName);
};

// =============================================================================
// Implementation (added in Task 4)
// =============================================================================

inline CharacterPreset CharacterPresetLoader::loadFromFile(const std::string& filePath) {
	(void)filePath;
	throw std::runtime_error("CharacterPresetLoader::loadFromFile: not implemented");
}

inline CharacterPreset CharacterPresetLoader::loadFromString(const std::string& jsonString, const std::string& sourceName) {
	(void)jsonString;
	(void)sourceName;
	throw std::runtime_error("CharacterPresetLoader::loadFromString: not implemented");
}

} // namespace ArenaGame
```

- [ ] **Step 5: Create the registry stub**

Create `game-core/src/core/CharacterPresetRegistry.hpp`:

```cpp
#pragma once

#include "../CharacterPreset.hpp"

#include <stdexcept>
#include <string>
#include <unordered_map>

namespace ArenaGame {

// =============================================================================
// CharacterPresetRegistry — in-memory store of loaded presets indexed by id
// (filename stem). Populated at World::initialize by scanning PRESETS_DIR.
// =============================================================================

class CharacterPresetRegistry {
public:
	void loadFromDirectory(const std::string& dirPath);

	const CharacterPreset& get(const std::string& id) const;
	bool contains(const std::string& id) const;
	std::size_t size() const { return m_presets.size(); }

private:
	std::unordered_map<std::string, CharacterPreset> m_presets;
};

// =============================================================================
// Implementation (added in Task 6)
// =============================================================================

inline void CharacterPresetRegistry::loadFromDirectory(const std::string& dirPath) {
	(void)dirPath;
	throw std::runtime_error("CharacterPresetRegistry::loadFromDirectory: not implemented");
}

inline const CharacterPreset& CharacterPresetRegistry::get(const std::string& id) const {
	auto it = m_presets.find(id);
	if (it == m_presets.end()) {
		throw std::runtime_error("CharacterPresetRegistry: unknown preset id '" + id + "'");
	}
	return it->second;
}

inline bool CharacterPresetRegistry::contains(const std::string& id) const {
	return m_presets.find(id) != m_presets.end();
}

} // namespace ArenaGame
```

- [ ] **Step 6: Verify the tree still builds**

```bash
cd backend && cargo build 2>&1 | tail -20
```

Expected: build succeeds. Any warning about unused functions in the stubs is fine (the stubs include `(void)` silencing).

- [ ] **Step 7: Commit**

```bash
git add game-core/src/core/CharacterPresetLoader.hpp \
        game-core/src/core/CharacterPresetRegistry.hpp \
        game-core/src/components/PresetBinding.hpp \
        game-core/src/components/Components.hpp \
        game-core/src/GameTypes.hpp
git commit -m "feat(presets): scaffold loader, registry, PresetBinding component"
```

---

## Task 3: Author `knight.json` and wire a failing parity check

This is the "failing test" step of TDD for this refactor. We write `knight.json`, hook a `verifyParity()` call into `World::initialize` that compares the loaded preset against `Presets::KNIGHT` field-by-field, and watch the game refuse to start because the loader is still a stub.

**Files:**
- Create: `game-core/assets/presets/players/knight.json`
- Modify: `game-core/src/core/World.hpp`

- [ ] **Step 1: Verify the presets directory does not yet exist**

```bash
ls game-core/assets/presets 2>&1 | head -3
```

Expected: `No such file or directory`. If it exists, stop and ask why.

- [ ] **Step 2: Create `knight.json`**

Create `game-core/assets/presets/players/knight.json`. Values are a byte-exact translation of `Presets::KNIGHT` at `game-core/src/Presets.hpp:10-64`:

```json
{
  "schema_version": 1,
  "id": "knight",
  "health": {
    "maxHealth":  180.0,
    "armor":      5.0,
    "resistance": 0.1
  },
  "movement": {
    "movementSpeed":    1.5,
    "rotationSpeed":    12.0,
    "sprintMultiplier": 2.5,
    "crouchMultiplier": 0.4,
    "jumpVelocity":     5.0,
    "dodgeVelocity":    7.0,
    "airControlFactor": 0.1,
    "acceleration":     18.0,
    "deceleration":     25.0,
    "mass":             90.0,
    "friction":         0.9,
    "drag":             0.0,
    "maxSpeed":         8.0,
    "maxFallSpeed":     60.0
  },
  "collider": {
    "radius": 0.45,
    "height": 1.9
  },
  "stamina": {
    "maxStamina":         100.0,
    "baseRegenRate":      40.0,
    "drainDelaySeconds":  1.5,
    "sprintCostPerSec":   15.0,
    "jumpCost":           8.0
  },
  "combat": {
    "baseDamage":         18.0,
    "damageMultiplier":   1.0,
    "criticalChance":     0.15,
    "criticalMultiplier": 1.5,
    "attackChain": [
      { "damageMultiplier": 0.8, "range": 3.0, "duration": 0.45, "movementMultiplier": 0.0, "chainWindow": 0.6, "staminaCost": 10.0 },
      { "damageMultiplier": 0.9, "range": 3.0, "duration": 0.50, "movementMultiplier": 0.0, "chainWindow": 0.5, "staminaCost": 15.0 },
      { "damageMultiplier": 1.6, "range": 3.0, "duration": 0.60, "movementMultiplier": 0.0, "chainWindow": 0.0, "staminaCost": 25.0 }
    ],
    "skill1": {
      "params":       { "type": "melee_aoe", "range": 4.0, "movementMultiplier": 0.0, "dmgMultiplier": 1.8 },
      "cooldown":     5.0,
      "castDuration": 0.7,
      "staminaCost":  20.0
    },
    "skill2": {
      "params":       { "type": "melee_aoe", "range": 4.0, "movementMultiplier": 0.7, "dmgMultiplier": 1.5 },
      "cooldown":     10.0,
      "castDuration": 0.5,
      "staminaCost":  30.0
    }
  }
}
```

- [ ] **Step 3: Validate the JSON against the schema (optional local sanity check)**

If `ajv-cli` or `jsonschema` is installed:

```bash
npx --yes ajv-cli validate -s docs/schemas/character-preset.v1.json -d game-core/assets/presets/players/knight.json
```

Expected: `... valid`. If unavailable, skip — CI will enforce in Task 11.

- [ ] **Step 4: Add a temporary parity check to `World::initialize`**

Open `game-core/src/core/World.hpp`. Near the top with the other includes:

```cpp
#include "MapLoader.hpp"
```

Add after it:

```cpp
#include "MapLoader.hpp"
#include "CharacterPresetLoader.hpp"
#include "../Presets.hpp" // TEMPORARY — parity oracle during preset migration; remove in Task 8
#include <cmath>          // TEMPORARY — parity check helper
```

Then at the top of the `World.hpp` file, outside any class, after existing includes but before `namespace ArenaGame {`, add the parity helper (or inside the namespace — matching the file's existing style):

Find `namespace ArenaGame {` near the top of the implementation-section of the file (after the `#include` block). Immediately after the opening namespace brace, add:

```cpp
namespace ArenaGame {

// TEMPORARY — removed in Task 8 after the registry is wired through createPlayer.
// Compares a preset loaded from JSON against the authoritative compile-time preset
// in Presets.hpp. Throws on any float mismatch beyond 1e-6 epsilon.
inline void verifyPresetParity(const CharacterPreset& loaded, const CharacterPreset& expected, const std::string& label) {
	auto eq = [](float a, float b) { return std::fabs(a - b) < 1e-6f; };
	auto fail = [&label](const std::string& field, float l, float e) {
		throw std::runtime_error("preset parity mismatch: " + label + "." + field
			+ " loaded=" + std::to_string(l) + " expected=" + std::to_string(e));
	};
	#define CHECK(expr_loaded, expr_expected, name) do { \
		if (!eq((expr_loaded), (expr_expected))) fail((name), (expr_loaded), (expr_expected)); \
	} while (0)

	CHECK(loaded.health.maxHealth,  expected.health.maxHealth,  "health.maxHealth");
	CHECK(loaded.health.armor,      expected.health.armor,      "health.armor");
	CHECK(loaded.health.resistance, expected.health.resistance, "health.resistance");

	CHECK(loaded.movement.movementSpeed,    expected.movement.movementSpeed,    "movement.movementSpeed");
	CHECK(loaded.movement.rotationSpeed,    expected.movement.rotationSpeed,    "movement.rotationSpeed");
	CHECK(loaded.movement.sprintMultiplier, expected.movement.sprintMultiplier, "movement.sprintMultiplier");
	CHECK(loaded.movement.crouchMultiplier, expected.movement.crouchMultiplier, "movement.crouchMultiplier");
	CHECK(loaded.movement.jumpVelocity,     expected.movement.jumpVelocity,     "movement.jumpVelocity");
	CHECK(loaded.movement.dodgeVelocity,    expected.movement.dodgeVelocity,    "movement.dodgeVelocity");
	CHECK(loaded.movement.airControlFactor, expected.movement.airControlFactor, "movement.airControlFactor");
	CHECK(loaded.movement.acceleration,     expected.movement.acceleration,     "movement.acceleration");
	CHECK(loaded.movement.deceleration,     expected.movement.deceleration,     "movement.deceleration");
	CHECK(loaded.movement.mass,             expected.movement.mass,             "movement.mass");
	CHECK(loaded.movement.friction,         expected.movement.friction,         "movement.friction");
	CHECK(loaded.movement.drag,             expected.movement.drag,             "movement.drag");
	CHECK(loaded.movement.maxSpeed,         expected.movement.maxSpeed,         "movement.maxSpeed");
	CHECK(loaded.movement.maxFallSpeed,     expected.movement.maxFallSpeed,     "movement.maxFallSpeed");

	CHECK(loaded.collider.radius, expected.collider.radius, "collider.radius");
	CHECK(loaded.collider.height, expected.collider.height, "collider.height");

	CHECK(loaded.stamina.maxStamina,        expected.stamina.maxStamina,        "stamina.maxStamina");
	CHECK(loaded.stamina.baseRegenRate,     expected.stamina.baseRegenRate,     "stamina.baseRegenRate");
	CHECK(loaded.stamina.drainDelaySeconds, expected.stamina.drainDelaySeconds, "stamina.drainDelaySeconds");
	CHECK(loaded.stamina.sprintCostPerSec,  expected.stamina.sprintCostPerSec,  "stamina.sprintCostPerSec");
	CHECK(loaded.stamina.jumpCost,          expected.stamina.jumpCost,          "stamina.jumpCost");

	CHECK(loaded.combat.baseDamage,         expected.combat.baseDamage,         "combat.baseDamage");
	CHECK(loaded.combat.damageMultiplier,   expected.combat.damageMultiplier,   "combat.damageMultiplier");
	CHECK(loaded.combat.criticalChance,     expected.combat.criticalChance,     "combat.criticalChance");
	CHECK(loaded.combat.criticalMultiplier, expected.combat.criticalMultiplier, "combat.criticalMultiplier");

	if (loaded.combat.attackChain.size() != expected.combat.attackChain.size()) {
		throw std::runtime_error("preset parity mismatch: " + label + ".attackChain size");
	}
	for (std::size_t i = 0; i < expected.combat.attackChain.size(); ++i) {
		const auto& l = loaded.combat.attackChain[i];
		const auto& e = expected.combat.attackChain[i];
		const std::string pfx = "attackChain[" + std::to_string(i) + "].";
		CHECK(l.damageMultiplier,   e.damageMultiplier,   pfx + "damageMultiplier");
		CHECK(l.range,              e.range,              pfx + "range");
		CHECK(l.duration,           e.duration,           pfx + "duration");
		CHECK(l.movementMultiplier, e.movementMultiplier, pfx + "movementMultiplier");
		CHECK(l.chainWindow,        e.chainWindow,        pfx + "chainWindow");
		CHECK(l.attackAngle,        e.attackAngle,        pfx + "attackAngle");
		CHECK(l.staminaCost,        e.staminaCost,        pfx + "staminaCost");
	}

	auto checkSkill = [&](const SkillDefinition& l, const SkillDefinition& e, const std::string& name) {
		CHECK(l.cooldown,     e.cooldown,     name + ".cooldown");
		CHECK(l.castDuration, e.castDuration, name + ".castDuration");
		CHECK(l.staminaCost,  e.staminaCost,  name + ".staminaCost");
		const auto* lp = std::get_if<MeleeAOE>(&l.params);
		const auto* ep = std::get_if<MeleeAOE>(&e.params);
		if (!lp || !ep) throw std::runtime_error("preset parity: " + name + " skill variant mismatch");
		CHECK(lp->range,              ep->range,              name + ".params.range");
		CHECK(lp->movementMultiplier, ep->movementMultiplier, name + ".params.movementMultiplier");
		CHECK(lp->dmgMultiplier,      ep->dmgMultiplier,      name + ".params.dmgMultiplier");
	};
	checkSkill(loaded.combat.skill1, expected.combat.skill1, "skill1");
	checkSkill(loaded.combat.skill2, expected.combat.skill2, "skill2");

	#undef CHECK
}

// ... rest of file
```

- [ ] **Step 5: Invoke the parity check from `World::initialize`**

In `World::initialize`, after the `MapLoader` line (around `World.hpp:185`), add:

```cpp
	// Load map data from JSON (path relative to backend/ working directory)
	MapLoader mapLoader(m_factory);
	m_mapData = mapLoader.loadFromFile(GameConfig::MAP_PATH);

	// TEMPORARY — parity check during preset migration. Removed in Task 8.
	{
		CharacterPresetLoader presetLoader;
		auto knight = presetLoader.loadFromFile(std::string(GameConfig::PRESETS_DIR) + "/players/knight.json");
		verifyPresetParity(knight, Presets::KNIGHT, "knight");
	}
```

- [ ] **Step 6: Build and run to watch it fail**

```bash
cd backend && cargo build 2>&1 | tail -10
```

Expected: build succeeds.

```bash
cd backend && cargo run --bin backend 2>&1 | head -20
```

Expected: server starts attempting to initialize, then aborts with a `runtime_error` from the loader stub:

```
CharacterPresetLoader::loadFromFile: not implemented
```

If the server starts successfully, the parity wiring didn't take effect — check that Step 5 was applied to the initialization path, not a dead branch.

- [ ] **Step 7: Commit the failing state**

```bash
git add game-core/assets/presets/players/knight.json game-core/src/core/World.hpp
git commit -m "test(presets): add knight.json and wire parity check (expected failure)"
```

---

## Task 4: Implement the loader to make the parity check pass (knight)

**Files:**
- Modify: `game-core/src/core/CharacterPresetLoader.hpp`

- [ ] **Step 1: Replace the stub with a real implementation**

Open `game-core/src/core/CharacterPresetLoader.hpp`. Delete the stub bodies of `loadFromFile` and `loadFromString`, and replace with the full implementation below. Keep the class declaration and includes; add helper functions in an anonymous namespace for parsing primitives.

Replace everything from `// Implementation (added in Task 4)` to the closing namespace brace with:

```cpp
// =============================================================================
// Implementation
// =============================================================================

namespace detail {

inline void requireKeysExactly(const nlohmann::json& obj,
                                const std::unordered_set<std::string>& required,
                                const std::unordered_set<std::string>& optional,
                                const std::string& path) {
	for (const auto& req : required) {
		if (!obj.contains(req)) {
			throw std::runtime_error("CharacterPresetLoader: " + path + " missing required key '" + req + "'");
		}
	}
	for (auto it = obj.begin(); it != obj.end(); ++it) {
		const std::string& key = it.key();
		if (required.find(key) == required.end() && optional.find(key) == optional.end()) {
			throw std::runtime_error("CharacterPresetLoader: " + path + " has unknown key '" + key + "'");
		}
	}
}

inline float readFloat(const nlohmann::json& obj, const std::string& key, const std::string& path) {
	if (!obj.contains(key)) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key + " missing");
	}
	if (!obj[key].is_number()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key + " not a number");
	}
	return obj[key].get<float>();
}

inline float readFloatOr(const nlohmann::json& obj, const std::string& key, float dflt, const std::string& path) {
	if (!obj.contains(key)) return dflt;
	if (!obj[key].is_number()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + "." + key + " not a number");
	}
	return obj[key].get<float>();
}

inline HealthPreset parseHealth(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"maxHealth", "armor", "resistance"}, {}, path);
	return HealthPreset{
		readFloat(obj, "maxHealth",  path),
		readFloat(obj, "armor",      path),
		readFloat(obj, "resistance", path),
	};
}

inline MovementPreset parseMovement(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {
		"movementSpeed", "rotationSpeed", "sprintMultiplier", "crouchMultiplier",
		"jumpVelocity", "dodgeVelocity", "airControlFactor", "acceleration",
		"deceleration", "mass", "friction", "drag", "maxSpeed", "maxFallSpeed"
	}, {}, path);
	return MovementPreset{
		readFloat(obj, "movementSpeed",    path),
		readFloat(obj, "rotationSpeed",    path),
		readFloat(obj, "sprintMultiplier", path),
		readFloat(obj, "crouchMultiplier", path),
		readFloat(obj, "jumpVelocity",     path),
		readFloat(obj, "dodgeVelocity",    path),
		readFloat(obj, "airControlFactor", path),
		readFloat(obj, "acceleration",     path),
		readFloat(obj, "deceleration",     path),
		readFloat(obj, "mass",             path),
		readFloat(obj, "friction",         path),
		readFloat(obj, "drag",             path),
		readFloat(obj, "maxSpeed",         path),
		readFloat(obj, "maxFallSpeed",     path),
	};
}

inline ColliderPreset parseCollider(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"radius", "height"}, {}, path);
	return ColliderPreset{
		readFloat(obj, "radius", path),
		readFloat(obj, "height", path),
	};
}

inline StaminaPreset parseStamina(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"maxStamina", "baseRegenRate", "drainDelaySeconds", "sprintCostPerSec", "jumpCost"}, {}, path);
	return StaminaPreset{
		readFloat(obj, "maxStamina",        path),
		readFloat(obj, "baseRegenRate",     path),
		readFloat(obj, "drainDelaySeconds", path),
		readFloat(obj, "sprintCostPerSec",  path),
		readFloat(obj, "jumpCost",          path),
	};
}

inline AttackStage parseAttackStage(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(
		obj,
		{"damageMultiplier", "range", "duration", "movementMultiplier", "chainWindow", "staminaCost"},
		{"attackAngle"},
		path
	);
	AttackStage s;
	s.damageMultiplier   = readFloat(obj, "damageMultiplier",   path);
	s.range              = readFloat(obj, "range",              path);
	s.duration           = readFloat(obj, "duration",           path);
	s.movementMultiplier = readFloat(obj, "movementMultiplier", path);
	s.chainWindow        = readFloat(obj, "chainWindow",        path);
	s.attackAngle        = readFloatOr(obj, "attackAngle", 0.7f, path);
	s.staminaCost        = readFloat(obj, "staminaCost",        path);
	return s;
}

inline SkillVariant parseSkillParams(const nlohmann::json& obj, const std::string& path) {
	if (!obj.contains("type") || !obj["type"].is_string()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + ".type missing or not a string");
	}
	const std::string type = obj["type"].get<std::string>();
	if (type == "melee_aoe") {
		requireKeysExactly(obj, {"type", "range", "movementMultiplier", "dmgMultiplier"}, {}, path);
		return MeleeAOE{
			readFloat(obj, "range",              path),
			readFloat(obj, "movementMultiplier", path),
			readFloat(obj, "dmgMultiplier",      path),
		};
	}
	throw std::runtime_error("CharacterPresetLoader: " + path + ".type unknown skill type '" + type + "'");
}

inline SkillDefinition parseSkill(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj, {"params"}, {"cooldown", "castDuration", "staminaCost"}, path);
	SkillDefinition s;
	s.params       = parseSkillParams(obj["params"], path + ".params");
	s.cooldown     = readFloatOr(obj, "cooldown",     0.0f, path);
	s.castDuration = readFloatOr(obj, "castDuration", 0.0f, path);
	s.staminaCost  = readFloatOr(obj, "staminaCost",  0.0f, path);
	return s;
}

inline CombatPreset parseCombat(const nlohmann::json& obj, const std::string& path) {
	requireKeysExactly(obj,
		{"baseDamage", "damageMultiplier", "criticalChance", "criticalMultiplier", "attackChain", "skill1", "skill2"},
		{}, path);
	CombatPreset c;
	c.baseDamage         = readFloat(obj, "baseDamage",         path);
	c.damageMultiplier   = readFloat(obj, "damageMultiplier",   path);
	c.criticalChance     = readFloat(obj, "criticalChance",     path);
	c.criticalMultiplier = readFloat(obj, "criticalMultiplier", path);

	if (!obj["attackChain"].is_array() || obj["attackChain"].empty()) {
		throw std::runtime_error("CharacterPresetLoader: " + path + ".attackChain must be a non-empty array");
	}
	c.attackChain.reserve(obj["attackChain"].size());
	for (std::size_t i = 0; i < obj["attackChain"].size(); ++i) {
		c.attackChain.push_back(parseAttackStage(obj["attackChain"][i], path + ".attackChain[" + std::to_string(i) + "]"));
	}

	c.skill1 = parseSkill(obj["skill1"], path + ".skill1");
	c.skill2 = parseSkill(obj["skill2"], path + ".skill2");
	return c;
}

} // namespace detail

inline CharacterPreset CharacterPresetLoader::loadFromFile(const std::string& filePath) {
	std::ifstream file(filePath);
	if (!file.is_open()) {
		throw std::runtime_error("CharacterPresetLoader: cannot open file '" + filePath + "'");
	}
	std::string contents((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
	return loadFromString(contents, filePath);
}

inline CharacterPreset CharacterPresetLoader::loadFromString(const std::string& jsonString, const std::string& sourceName) {
	nlohmann::json root;
	try {
		root = nlohmann::json::parse(jsonString);
	} catch (const nlohmann::json::parse_error& e) {
		throw std::runtime_error("CharacterPresetLoader: " + sourceName + " JSON parse error: " + e.what());
	}

	detail::requireKeysExactly(
		root,
		{"schema_version", "id", "health", "movement", "collider", "stamina", "combat"},
		{},
		sourceName
	);

	if (!root["schema_version"].is_number_integer() || root["schema_version"].get<int>() != 1) {
		throw std::runtime_error("CharacterPresetLoader: " + sourceName + " unsupported schema_version (expected 1)");
	}
	if (!root["id"].is_string() || root["id"].get<std::string>().empty()) {
		throw std::runtime_error("CharacterPresetLoader: " + sourceName + ".id must be a non-empty string");
	}

	CharacterPreset preset;
	preset.health   = detail::parseHealth  (root["health"],   sourceName + ".health");
	preset.movement = detail::parseMovement(root["movement"], sourceName + ".movement");
	preset.collider = detail::parseCollider(root["collider"], sourceName + ".collider");
	preset.stamina  = detail::parseStamina (root["stamina"],  sourceName + ".stamina");
	preset.combat   = detail::parseCombat  (root["combat"],   sourceName + ".combat");
	return preset;
}

} // namespace ArenaGame
```

- [ ] **Step 2: Build**

```bash
cd backend && cargo build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 3: Run the parity check**

```bash
cd backend && cargo run --bin backend 2>&1 | grep -E "(parity|preset|Listening)" | head -10
```

Expected: no `preset parity mismatch` error. Server proceeds past initialization (look for the server's normal "Listening" / ready log line). If parity fails, the message points at the first mismatched field — correct either `knight.json` or the loader.

- [ ] **Step 4: Stop the running server** (Ctrl-C) and commit

```bash
git add game-core/src/core/CharacterPresetLoader.hpp
git commit -m "feat(presets): implement strict JSON loader for CharacterPreset"
```

---

## Task 5: Rogue migration + extend parity check

**Files:**
- Create: `game-core/assets/presets/players/rogue.json`
- Modify: `game-core/src/core/World.hpp`

- [ ] **Step 1: Create `rogue.json`**

Byte-exact translation of `Presets::ROGUE` at `game-core/src/Presets.hpp:66-119`:

```json
{
  "schema_version": 1,
  "id": "rogue",
  "health": {
    "maxHealth":  100.0,
    "armor":      0.0,
    "resistance": 0.0
  },
  "movement": {
    "movementSpeed":    1.9,
    "rotationSpeed":    22.0,
    "sprintMultiplier": 3.0,
    "crouchMultiplier": 0.6,
    "jumpVelocity":     7.5,
    "dodgeVelocity":    11.0,
    "airControlFactor": 0.35,
    "acceleration":     22.0,
    "deceleration":     30.0,
    "mass":             60.0,
    "friction":         0.7,
    "drag":             0.0,
    "maxSpeed":         10.0,
    "maxFallSpeed":     55.0
  },
  "collider": {
    "radius": 0.35,
    "height": 1.75
  },
  "stamina": {
    "maxStamina":         120.0,
    "baseRegenRate":      55.0,
    "drainDelaySeconds":  1.0,
    "sprintCostPerSec":   10.0,
    "jumpCost":           5.0
  },
  "combat": {
    "baseDamage":         22.0,
    "damageMultiplier":   1.0,
    "criticalChance":     0.35,
    "criticalMultiplier": 2.0,
    "attackChain": [
      { "damageMultiplier": 0.8, "range": 3.0, "duration": 0.5, "movementMultiplier": 0.4, "chainWindow": 0.5, "staminaCost": 8.0 },
      { "damageMultiplier": 1.3, "range": 3.0, "duration": 0.6, "movementMultiplier": 0.3, "chainWindow": 0.0, "staminaCost": 14.0 }
    ],
    "skill1": {
      "params":       { "type": "melee_aoe", "range": 3.0, "movementMultiplier": 1.0, "dmgMultiplier": 1.6 },
      "cooldown":     4.0,
      "castDuration": 0.40,
      "staminaCost":  15.0
    },
    "skill2": {
      "params":       { "type": "melee_aoe", "range": 3.0, "movementMultiplier": 0.2, "dmgMultiplier": 1.4 },
      "cooldown":     6.0,
      "castDuration": 0.45,
      "staminaCost":  12.0
    }
  }
}
```

- [ ] **Step 2: Extend the parity check to cover rogue**

In `game-core/src/core/World.hpp`, find the temporary block added in Task 3 Step 5:

```cpp
	// TEMPORARY — parity check during preset migration. Removed in Task 8.
	{
		CharacterPresetLoader presetLoader;
		auto knight = presetLoader.loadFromFile(std::string(GameConfig::PRESETS_DIR) + "/players/knight.json");
		verifyPresetParity(knight, Presets::KNIGHT, "knight");
	}
```

Replace with:

```cpp
	// TEMPORARY — parity check during preset migration. Removed in Task 8.
	{
		CharacterPresetLoader presetLoader;
		auto knight = presetLoader.loadFromFile(std::string(GameConfig::PRESETS_DIR) + "/players/knight.json");
		verifyPresetParity(knight, Presets::KNIGHT, "knight");
		auto rogue  = presetLoader.loadFromFile(std::string(GameConfig::PRESETS_DIR) + "/players/rogue.json");
		verifyPresetParity(rogue, Presets::ROGUE, "rogue");
	}
```

- [ ] **Step 3: Build and run**

```bash
cd backend && cargo build 2>&1 | tail -5
cd backend && cargo run --bin backend 2>&1 | grep -E "(parity|preset|Listening)" | head -10
```

Expected: no parity failures for knight or rogue. Server reaches its normal ready state.

- [ ] **Step 4: Stop and commit**

```bash
git add game-core/assets/presets/players/rogue.json game-core/src/core/World.hpp
git commit -m "feat(presets): migrate rogue to JSON, extend parity check"
```

---

## Task 6: Implement the registry (directory scan)

**Files:**
- Modify: `game-core/src/core/CharacterPresetRegistry.hpp`

- [ ] **Step 1: Replace the stub `loadFromDirectory` with a working implementation**

In `game-core/src/core/CharacterPresetRegistry.hpp`, replace everything from `// Implementation (added in Task 6)` to the closing namespace brace with:

```cpp
// =============================================================================
// Implementation
// =============================================================================

} // namespace ArenaGame

#include "CharacterPresetLoader.hpp"
#include <filesystem>

namespace ArenaGame {

inline void CharacterPresetRegistry::loadFromDirectory(const std::string& dirPath) {
	namespace fs = std::filesystem;

	if (!fs::exists(dirPath) || !fs::is_directory(dirPath)) {
		throw std::runtime_error("CharacterPresetRegistry: presets directory not found '" + dirPath + "'");
	}

	CharacterPresetLoader loader;
	std::size_t parsed = 0;
	for (const auto& entry : fs::recursive_directory_iterator(dirPath)) {
		if (!entry.is_regular_file()) continue;
		if (entry.path().extension() != ".json") continue;

		const std::string filename = entry.path().string();
		const std::string id       = entry.path().stem().string();

		if (m_presets.find(id) != m_presets.end()) {
			throw std::runtime_error("CharacterPresetRegistry: duplicate preset id '" + id
				+ "' (second file: " + filename + ")");
		}

		CharacterPreset preset = loader.loadFromFile(filename);
		m_presets.emplace(id, std::move(preset));
		++parsed;
	}

	if (parsed == 0) {
		throw std::runtime_error("CharacterPresetRegistry: no preset files found in '" + dirPath + "'");
	}
}

inline const CharacterPreset& CharacterPresetRegistry::get(const std::string& id) const {
	auto it = m_presets.find(id);
	if (it == m_presets.end()) {
		throw std::runtime_error("CharacterPresetRegistry: unknown preset id '" + id + "'");
	}
	return it->second;
}

inline bool CharacterPresetRegistry::contains(const std::string& id) const {
	return m_presets.find(id) != m_presets.end();
}

} // namespace ArenaGame
```

Note: the `}` immediately after `// Implementation` closes the namespace before `#include <filesystem>` because header includes inside a namespace are forbidden. Re-opening `namespace ArenaGame {` afterwards restores the scope for the inline definitions.

- [ ] **Step 2: Build to confirm no warnings from `-Wconversion` on the size_t counter**

```bash
cd backend && cargo build 2>&1 | grep -E "(warning|error)" | head -20
```

Expected: no errors, no new warnings from this header. If `-Wsign-conversion` complains about `size_t` vs. `int`, adjust the counter type; the code above uses `std::size_t` precisely for this reason.

- [ ] **Step 3: Commit**

```bash
git add game-core/src/core/CharacterPresetRegistry.hpp
git commit -m "feat(presets): implement CharacterPresetRegistry directory scan"
```

---

## Task 7: Wire the registry through `EntityFactory` and `World`

Introduce a `PresetBinding` component on every actor spawn and route `createPlayer` through the new registry. The old `presetFromClass` lookup is kept intact for one more task so the parity check still runs.

**Files:**
- Modify: `game-core/src/core/EntityFactory.hpp`
- Modify: `game-core/src/core/World.hpp`

- [ ] **Step 1: Extend `EntityFactory::createActor` to accept a preset id**

In `game-core/src/core/EntityFactory.hpp`, update the declarations at lines 41-44:

```cpp
	entt::entity createActor(const Vector3D& pos, const CharacterPreset& preset,
							 Components::CollisionLayer layer = Components::CollisionLayer::Enemy);
	entt::entity createBot(const Vector3D& pos, const CharacterPreset& preset,
						   Components::CollisionLayer layer);
```

Replace with:

```cpp
	entt::entity createActor(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset,
							 Components::CollisionLayer layer = Components::CollisionLayer::Enemy);
	entt::entity createBot(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset,
						   Components::CollisionLayer layer);
```

- [ ] **Step 2: Update `createActor` implementation to attach `PresetBinding`**

In the same file, replace the implementation at `EntityFactory.hpp:77-92`:

```cpp
inline entt::entity EntityFactory::createActor(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer) {
	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	m_registry.emplace<ActorTag>(entity);
	m_registry.emplace<Components::Transform>(entity, pos);
	m_registry.emplace<Components::PhysicsBody>(entity, Components::PhysicsBody::createFromPreset(preset.movement));
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createFromPreset(preset.collider, layer));
	m_registry.emplace<Components::Health>(entity, Components::Health::createFromPreset(preset.health));
	m_registry.emplace<Components::Stamina>(entity, Components::Stamina::createFromPreset(preset.stamina));
	m_registry.emplace<Components::CombatController>(entity, Components::CombatController::createFromPreset(preset.combat));

	return entity;
}
```

with:

```cpp
inline entt::entity EntityFactory::createActor(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset, Components::CollisionLayer layer) {
	entt::entity entity = m_registry.create();
	if (entity == entt::null) {
		return entt::null;
	}

	m_registry.emplace<ActorTag>(entity);
	m_registry.emplace<Components::Transform>(entity, pos);
	m_registry.emplace<Components::PhysicsBody>(entity, Components::PhysicsBody::createFromPreset(preset.movement));
	m_registry.emplace<Components::Collider>(entity, Components::Collider::createFromPreset(preset.collider, layer));
	m_registry.emplace<Components::Health>(entity, Components::Health::createFromPreset(preset.health));
	m_registry.emplace<Components::Stamina>(entity, Components::Stamina::createFromPreset(preset.stamina));
	m_registry.emplace<Components::CombatController>(entity, Components::CombatController::createFromPreset(preset.combat));
	m_registry.emplace<Components::PresetBinding>(entity, Components::PresetBinding{presetId});

	return entity;
}
```

And update `createBot` at `EntityFactory.hpp:94-100`:

```cpp
inline entt::entity EntityFactory::createBot(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer) {
	auto bot = createActor(pos, preset, layer);
	if (bot == entt::null) return entt::null;

	m_registry.emplace<BotTag>(bot);
	return bot;
}
```

with:

```cpp
inline entt::entity EntityFactory::createBot(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset, Components::CollisionLayer layer) {
	auto bot = createActor(pos, presetId, preset, layer);
	if (bot == entt::null) return entt::null;

	m_registry.emplace<BotTag>(bot);
	return bot;
}
```

- [ ] **Step 3: Update `World::createActor` passthrough and `World::createPlayer`**

In `game-core/src/core/World.hpp`, update the `createActor` declaration (around `World.hpp:80`):

```cpp
	entt::entity createActor(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer = Components::CollisionLayer::Enemy);
```

Replace with:

```cpp
	entt::entity createActor(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset, Components::CollisionLayer layer = Components::CollisionLayer::Enemy);
```

And the implementation (around `World.hpp:299-301`):

```cpp
inline entt::entity World::createActor(const Vector3D& pos, const CharacterPreset& preset, Components::CollisionLayer layer) {
	return m_factory.createActor(pos, preset, layer);
}
```

Replace with:

```cpp
inline entt::entity World::createActor(const Vector3D& pos, const std::string& presetId, const CharacterPreset& preset, Components::CollisionLayer layer) {
	return m_factory.createActor(pos, presetId, preset, layer);
}
```

Then update `World::createPlayer` at `World.hpp:348-349`:

```cpp
	const CharacterPreset& preset = presetFromClass(characterClass);
	entt::entity entity = m_factory.createActor(pos, preset, Components::CollisionLayer::Player);
```

Replace with:

```cpp
	const CharacterPreset& preset = m_presetRegistry.get(characterClass);
	entt::entity entity = m_factory.createActor(pos, characterClass, preset, Components::CollisionLayer::Player);
```

- [ ] **Step 4: Add `m_presetRegistry` member and populate it in `initialize`**

In `game-core/src/core/World.hpp`, add the include near the top:

```cpp
#include "CharacterPresetRegistry.hpp"
```

Add the member declaration in the private section (near `MapData m_mapData;` at `World.hpp:140`):

```cpp
	// Loaded map data (arena dimensions, spawn points)
	MapData m_mapData;

	// Loaded character presets (indexed by class id)
	CharacterPresetRegistry m_presetRegistry;
```

In `World::initialize`, load the registry immediately after creating the game manager but before loading the map (so a bad preset file fails early, before map-related setup):

Find:

```cpp
	m_gameManager = m_factory.createGameManager();

	// Load map data from JSON (path relative to backend/ working directory)
	MapLoader mapLoader(m_factory);
```

Replace with:

```cpp
	m_gameManager = m_factory.createGameManager();

	// Load character presets (path relative to backend/ working directory)
	m_presetRegistry.loadFromDirectory(GameConfig::PRESETS_DIR);

	// Load map data from JSON (path relative to backend/ working directory)
	MapLoader mapLoader(m_factory);
```

- [ ] **Step 5: Search for any other call site of `createActor` / `createBot` that wasn't updated**

```bash
grep -rn "createActor\|createBot" game-core/ backend/src/
```

Expected: only the sites already updated in this task (`EntityFactory.hpp` declarations + impls, `World.hpp` declaration/impl + `createPlayer`). If other call sites exist, add the `presetId` argument — use the character class name the caller already has, or `"unknown"` only if truly anonymous (do not introduce new anonymous callers).

- [ ] **Step 6: Build and run (parity check still active)**

```bash
cd backend && cargo build 2>&1 | tail -5
cd backend && cargo run --bin backend 2>&1 | head -10
```

Expected: clean build, server starts, parity check passes, server reaches ready.

- [ ] **Step 7: Stop and commit**

```bash
git add game-core/src/core/EntityFactory.hpp game-core/src/core/World.hpp
git commit -m "refactor(presets): route createPlayer through registry, tag actors with PresetBinding"
```

---

## Task 8: Delete `Presets.hpp`, `CharacterClassLookup.hpp`, and the parity check

The registry is now the sole source of preset data. Remove every trace of the old system.

**Files:**
- Delete: `game-core/src/Presets.hpp`
- Delete: `game-core/src/CharacterClassLookup.hpp`
- Modify: `game-core/src/core/EntityFactory.hpp`
- Modify: `game-core/src/core/World.hpp`

- [ ] **Step 1: Remove the `CharacterClassLookup.hpp` include from `EntityFactory.hpp`**

In `game-core/src/core/EntityFactory.hpp`, line 15:

```cpp
#include "../CharacterClassLookup.hpp"
```

Delete this line.

- [ ] **Step 2: Remove the parity check and `Presets.hpp` include from `World.hpp`**

In `game-core/src/core/World.hpp`:

1. Delete the block:

```cpp
	// TEMPORARY — parity check during preset migration. Removed in Task 8.
	{
		CharacterPresetLoader presetLoader;
		auto knight = presetLoader.loadFromFile(std::string(GameConfig::PRESETS_DIR) + "/players/knight.json");
		verifyPresetParity(knight, Presets::KNIGHT, "knight");
		auto rogue  = presetLoader.loadFromFile(std::string(GameConfig::PRESETS_DIR) + "/players/rogue.json");
		verifyPresetParity(rogue, Presets::ROGUE, "rogue");
	}
```

2. Delete the entire `verifyPresetParity` function added in Task 3 Step 4.

3. Delete these lines from the includes:

```cpp
#include "CharacterPresetLoader.hpp"
#include "../Presets.hpp" // TEMPORARY — parity oracle during preset migration; remove in Task 8
#include <cmath>          // TEMPORARY — parity check helper
```

Note: `CharacterPresetLoader.hpp` is already transitively included via `CharacterPresetRegistry.hpp`, so no loader include is needed in `World.hpp` after the parity check is gone.

- [ ] **Step 3: Delete the orphaned headers**

```bash
git rm game-core/src/Presets.hpp game-core/src/CharacterClassLookup.hpp
```

- [ ] **Step 4: Confirm no lingering references**

```bash
grep -rn "Presets::\|CharacterClassLookup\|presetFromClass" game-core/ backend/src/
```

Expected: no matches. If any show up, resolve before moving on — likely another test or debug file not caught earlier.

- [ ] **Step 5: Build and run**

```bash
cd backend && cargo build 2>&1 | tail -10
cd backend && cargo run --bin backend 2>&1 | head -10
```

Expected: clean build, server starts without the parity check, reaches ready. A bad preset file now surfaces as a registry load error, not a parity mismatch.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(presets): remove Presets.hpp, CharacterClassLookup, and migration parity check"
```

---

## Task 9: Teach `build.rs` about the presets directory

Without this, editing a preset JSON file does not trigger a Rust rebuild, so the server runs against stale copies of the data during dev iteration.

**Files:**
- Modify: `backend/build.rs`

- [ ] **Step 1: Add the rerun hint**

In `backend/build.rs`, find:

```rust
    println!("cargo:rerun-if-changed=../game-core/assets/map.json"); // unified map data
```

Add immediately after:

```rust
    println!("cargo:rerun-if-changed=../game-core/assets/map.json"); // unified map data
    println!("cargo:rerun-if-changed=../game-core/assets/presets"); // character preset JSONs
```

- [ ] **Step 2: Confirm Dockerfile already copies the new files**

```bash
grep -n "game-core/assets" Dockerfile
```

Expected: `COPY --from=backend /build/game-core/assets/ ./assets/` at line ~78. The directory copy picks up `presets/` automatically. No change needed.

- [ ] **Step 3: Full rebuild to prove the rerun hint works**

```bash
cd backend && cargo build 2>&1 | tail -5
touch ../game-core/assets/presets/players/knight.json
cd backend && cargo build 2>&1 | grep -E "Compiling|Finished" | head -5
```

Expected: the second build re-runs (includes `Compiling transcendence-backend` in its log). If it reports `Finished` immediately, the rerun hint is wrong — re-read `build.rs`.

- [ ] **Step 4: Commit**

```bash
git add backend/build.rs
git commit -m "chore(build): rerun backend on changes to character preset JSONs"
```

---

## Task 10: End-to-end smoke test

No code changes — a manual verification that the refactor is gameplay-neutral.

- [ ] **Step 1: Start the server**

```bash
cd backend && cargo run --bin backend
```

Expected: server reaches its usual ready/listening state with no errors. If a preset file is missing, the error message points to it (e.g. `presets directory not found`).

- [ ] **Step 2: Open a client, start a match, spawn a Knight and a Rogue**

Use the frontend or whatever test harness the team uses to join a match as each class.

- [ ] **Step 3: Compare behavior against the pre-migration binary**

Checklist (mental / quick visual):
- Knight feels tanky and slow; Rogue feels fast with long dodge.
- Knight skill1 AOE range feels the same as before (~4m).
- Rogue dash-stab (skill1) covers the same ground (~3m, movement-locked).
- Attack chain stage counts match: 3 for Knight, 2 for Rogue.
- Stamina regen timings feel unchanged.

Any felt difference is a bug — something in the JSON diverges from the old literal. Fix by editing the JSON, not the loader.

- [ ] **Step 4: Kill an actor with each class to exercise health/armor resolution**

No separate step — just verify in-match: damage numbers land roughly where expected.

No commit needed; this step verifies, it does not change files.

---

## Task 11: CI JSON Schema validation

Catches schema drift automatically on PRs. Requires whatever JSON-Schema CLI the project prefers — pick one that's already consumed by `prek.toml`.

**Files:**
- Modify: `prek.toml`

- [ ] **Step 1: Inspect existing `prek.toml` style**

```bash
cat prek.toml
```

Note the existing hook structure — mirror it for the new hook.

- [ ] **Step 2: Add a preset validation hook**

Append to `prek.toml` (adjust key names to match the file's existing scheme — a `[[hooks]]` list is shown here as illustrative):

```toml
[[hooks]]
name = "validate-character-presets"
description = "Validate every character preset JSON against the v1 schema"
files = "^game-core/assets/presets/.*\\.json$"
command = "npx"
args = [
    "--yes",
    "ajv-cli",
    "validate",
    "-s", "docs/schemas/character-preset.v1.json",
    "-d", "game-core/assets/presets/players/*.json"
]
```

If `prek` uses a different schema (YAML, another TOML shape, or something else), translate the three inputs above: match `.json` files under `game-core/assets/presets/`, run `ajv-cli validate` against `docs/schemas/character-preset.v1.json`. Do not invent keys; read the existing file and use its patterns.

- [ ] **Step 3: Run the hook locally**

```bash
prek run validate-character-presets
```

Expected: success. If `prek` isn't installed locally, run the underlying command directly:

```bash
npx --yes ajv-cli validate -s docs/schemas/character-preset.v1.json -d 'game-core/assets/presets/players/*.json'
```

Expected: `knight.json valid`, `rogue.json valid`.

- [ ] **Step 4: Prove the hook fails on bad data (do not commit the bad file)**

```bash
cp game-core/assets/presets/players/knight.json /tmp/knight.bak
python3 -c "import json,sys;d=json.load(open('game-core/assets/presets/players/knight.json'));d['foo']=1;json.dump(d,open('game-core/assets/presets/players/knight.json','w'),indent=2)"
prek run validate-character-presets
# expected: FAIL (additional property 'foo' not allowed)
mv /tmp/knight.bak game-core/assets/presets/players/knight.json
```

Expected: the middle invocation fails. After the `mv`, the file is restored; `git diff` should be empty.

- [ ] **Step 5: Commit**

```bash
git add prek.toml
git commit -m "ci(presets): validate character preset JSONs against schema on every PR"
```

---

## Cutover checklist (run before merging)

- [ ] `cd backend && cargo build` — clean.
- [ ] `grep -rn "Presets::\|CharacterClassLookup\|presetFromClass" game-core/ backend/src/` — empty.
- [ ] `ls game-core/assets/presets/players/` — `knight.json`, `rogue.json`.
- [ ] `cd backend && cargo run --bin backend` — server reaches ready.
- [ ] Manual match (Task 10) — gameplay identical to pre-migration binary.
- [ ] `prek run validate-character-presets` — green.
- [ ] Docker image build contains `/app/assets/presets/players/knight.json` and `.../rogue.json`.

---

## Forward hook — why `PresetBinding` is worth adding now

Hot-reload (deferred to a later round) needs to answer the question "which live entities belong to preset `X`?" without that answer requiring a refactor of every spawn site. `PresetBinding { id }` is that answer — one string per actor, zero behavioral cost today. Adding it during the same pass as the registry work avoids a second pass through `EntityFactory` later when the refresh system ships.
