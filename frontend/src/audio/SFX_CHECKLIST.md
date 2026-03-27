# Sound Effects Checklist - Transcendence

## Character Classes

| Class    | Weapon              | Movement Style        |
|----------|---------------------|-----------------------|
| **Knight** | Sword + Shield      | Heavy / Armored boots |
| **Rogue**  | Two Daggers         | Light / Leather boots |

---

## Sounds Needed

### Movement (both classes)

| Sound ID               | Description                          | Variations | Status |
|-------------------------|--------------------------------------|------------|--------|
| `player_footstep`       | Generic footsteps                    | 5          | DONE   |
| `knight_footstep`       | Heavy armored boot footsteps         | 4-5        | TODO   |
| `rogue_footstep`        | Light leather footsteps              | 4-5        | TODO   |
| `player_jump`           | Jump launch                          | 4          | DONE   |
| `player_land`           | Landing impact                       | 1          | DONE   |
| `player_land_heavy`     | Hard landing (high fall)             | 2-3        | TODO   |
| `player_dodge`          | Dodge/roll swish                     | 2-3        | TODO   |
| `player_sprint_start`   | Burst of speed (optional)            | 1-2        | TODO   |

### Combat - Knight

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `knight_attack_swing`       | Heavy sword slash (whoosh)           | 3-4        | TODO   |
| `knight_attack_hit`         | Sword hitting target (impact)        | 3-4        | TODO   |
| `knight_shield_block`       | Shield block (metallic clang)        | 2-3        | TODO   |
| `knight_hit_react`          | Knight taking damage (grunt)         | 3-4        | TODO   |
| `knight_death`              | Knight death (scream/collapse)       | 2-3        | TODO   |
| `knight_stun`               | Knight stunned (daze)                | 1-2        | TODO   |

### Combat - Rogue

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `rogue_attack_swing`        | Quick dagger slash (light whoosh)    | 3-4        | TODO   |
| `rogue_attack_hit`          | Dagger hitting target (stab/slice)   | 3-4        | TODO   |
| `rogue_hit_react`           | Rogue taking damage (grunt)          | 3-4        | TODO   |
| `rogue_death`               | Rogue death                          | 2-3        | TODO   |
| `rogue_stun`                | Rogue stunned                        | 1-2        | TODO   |

### Combat - Generic (fallback if no class-specific)

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `player_attack_swing`       | Generic weapon swing                 | 3-4        | TODO   |
| `player_attack_hit`         | Generic impact on hit                | 3-4        | TODO   |
| `player_hit_react`          | Generic pain grunt                   | 3-4        | TODO   |
| `player_death`              | Generic death                        | 2-3        | TODO   |

### Game Events

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `game_start`                | Match beginning (horn/bell)          | 1          | TODO   |
| `game_end`                  | Match over (fanfare or defeat)       | 2          | TODO   |
| `player_spawn`              | Spawn/teleport in                    | 1-2        | TODO   |
| `player_kill`               | Kill confirmation                    | 1-2        | TODO   |
| `score_point`               | Point scored                         | 1          | TODO   |

### UI

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `ui_click`                  | Button click                         | 1          | DONE   |
| `ui_hover`                  | Button hover                         | 1          | TODO   |
| `ui_back`                   | Back/cancel                          | 1          | TODO   |
| `ui_error`                  | Error feedback                       | 1          | TODO   |
| `ui_notification`           | Notification popup                   | 1          | TODO   |
| `ui_lobby_join`             | Player joins lobby                   | 1          | TODO   |
| `ui_lobby_leave`            | Player leaves lobby                  | 1          | TODO   |
| `ui_countdown`              | Countdown tick (3, 2, 1)             | 1          | TODO   |
| `ui_ready`                  | Ready confirmation                   | 1          | TODO   |

### Ambient / Music

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `amb_forest`                | Forest ambience loop                 | 1          | DONE   |
| `amb_arena`                 | Arena ambience (crowd, wind)         | 1          | TODO   |
| `music_menu`                | Menu/lobby background music          | 1          | TODO   |
| `music_battle`              | In-game battle music                 | 1          | TODO   |
| `music_victory`             | Victory screen music                 | 1          | TODO   |
| `music_defeat`              | Defeat screen music                  | 1          | TODO   |

---

## Audio File Requirements

- **Format**: `.wav` for SFX (low latency), `.mp3`/`.ogg` for music/ambient (smaller size)
- **Sample rate**: 44100 Hz
- **Channels**: Mono for spatial SFX, Stereo for music/ambient
- **Duration**: SFX < 2s, ambient loops seamless, music loops seamless
- **Naming**: `{sound_id}_{variation_number}.wav` (e.g. `knight_attack_swing_01.wav`)

## File Structure

```
frontend/public/sounds/
  sfx/
    movement/
      knight_footstep_01-05.wav
      rogue_footstep_01-05.wav
      jump_01-04.wav          (DONE)
      land_01.wav             (DONE)
      footstep_01-05.wav      (DONE)
      dodge_01-03.wav
    combat/
      knight_attack_swing_01-04.wav
      knight_attack_hit_01-04.wav
      knight_shield_block_01-03.wav
      rogue_attack_swing_01-04.wav
      rogue_attack_hit_01-04.wav
      hit_react_01-04.wav
      death_01-03.wav
    game/
      game_start.wav
      game_end_victory.wav
      game_end_defeat.wav
      player_spawn_01-02.wav
      kill_confirm_01-02.wav
  ui/
    ui_click.mp3              (DONE)
    ui_hover.mp3
    ui_back.mp3
    ui_error.mp3
    ui_notification.mp3
  ambient/
    amb_forest.mp3            (DONE)
    amb_arena.mp3
  music/
    music_menu.mp3
    music_battle.mp3
    music_victory.mp3
    music_defeat.mp3
```

---

## Priority Order

1. **P0 - Core gameplay feel**: `player_attack_swing`, `player_attack_hit`, `player_hit_react`, `player_death`
2. **P1 - Class identity**: `knight_*` and `rogue_*` variants for attacks and footsteps
3. **P2 - Game flow**: `game_start`, `game_end`, `player_spawn`, `player_kill`
4. **P3 - UI polish**: `ui_hover`, `ui_notification`, `ui_countdown`
5. **P4 - Atmosphere**: `amb_arena`, `music_battle`, `music_menu`

---

## Already Wired (just need sound files + uncomment)

These triggers exist in `triggerTables.ts` but are commented out:

- Line 27: `player_attack_swing` (local input, rising edge on `isAttacking`)
- Line 28: `player_dodge` (local input, rising edge on `isDodging`)
- Line 83: `player_hit_react` (remote snapshot, health decrease)
- Line 103: Hit server event
- Line 104: Death server event
- Line 105: Dodge server event
