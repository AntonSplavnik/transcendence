# Sound Effects Checklist - Transcendence

## Character Classes

| Class    | Weapon              | Movement Style        |
|----------|---------------------|-----------------------|
| **Knight** | Sword + Shield      | Heavy / Armored boots |
| **Rogue**  | Two Daggers         | Light / Leather boots |

---

## Sounds Needed

### Movement - Knight

| Sound ID               | Description                          | Variations | Status |
|-------------------------|--------------------------------------|------------|--------|
| `knight_footstep`       | Heavy armored boot footsteps         | 1-3        | DONE   |
| `knight_jump`           | Heavy jump impulse                   | 2-3        | TODO   |
| `knight_land`           | Heavy landing impact                 | 1-2        | DONE   |
| `knight_armor_foley`    | Plate armor clinking on movement     | 3-4        | TODO   |
| `knight_dodge`          | Heavy dodge/roll swish               | 2-3        | LATER  |

### Movement - Rogue

| Sound ID               | Description                          | Variations | Status |
|-------------------------|--------------------------------------|------------|--------|
| `rogue_footstep`        | Light sneaky leather footsteps       | 1-3        | DONE   |
| `rogue_jump`            | Light agile jump                     | 2-3        | TODO   |
| `rogue_land`            | Soft silent landing                  | 1-2        | DONE   |
| `rogue_leather_foley`   | Leather gear rustling on movement    | 3-4        | TODO   |
| `rogue_dodge`           | Fast dash whoosh                     | 2-3        | LATER  |

### Movement - Generic (fallback)

| Sound ID               | Description                          | Variations | Status |
|-------------------------|--------------------------------------|------------|--------|
| `player_footstep`       | Generic footsteps                    | 5          | DONE   |
| `player_jump`           | Jump launch                          | 4          | DONE   |
| `player_land`           | Landing impact                       | 1          | DONE   |
| `player_dodge`          | Dodge/roll swish                     | 2-3        | LATER  |

### Combat - Knight

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `knight_attack_swing`       | Heavy sword whoosh                   | 3-4        | TODO   |
| `knight_attack_hit`         | Sword impact on target               | 3-4        | TODO   |
| `knight_attack_grunt`       | Effort grunt on swing                | 3-4        | TODO   |
| `knight_hit_react`          | Pain grunt on damage taken           | 3-4        | TODO   |
| `knight_death`              | Death scream/collapse                | 2-3        | TODO   |
| `knight_stun`               | Stunned daze                         | 1-2        | LATER  |
| `knight_shield_block`       | Shield block metallic clang          | 2-3        | LATER  |
| `knight_sword_draw`         | Unsheathe sword                      | 1-2        | LATER  |

### Combat - Rogue

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `rogue_attack_swing`        | Quick dagger swoosh                  | 3-4        | TODO   |
| `rogue_attack_hit`          | Dagger stab/slice impact             | 3-4        | TODO   |
| `rogue_attack_grunt`        | Fast effort grunt on combo           | 3-4        | TODO   |
| `rogue_hit_react`           | Pain grunt on damage taken           | 3-4        | TODO   |
| `rogue_death`               | Death sound                          | 2-3        | TODO   |
| `rogue_stun`                | Stunned                              | 1-2        | LATER  |
| `rogue_dagger_draw`         | Unsheathe daggers (light metallic)   | 1-2        | LATER  |

### Combat - Generic (fallback if no class-specific)

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `player_attack_swing`       | Generic weapon swing                 | 5          | DONE   |
| `player_attack_hit`         | Generic impact on hit                | 3-4        | TODO   |
| `player_attack_grunt`       | Generic effort grunt                 | 3-4        | TODO   |
| `player_hit_react`          | Generic pain grunt                   | 3-4        | TODO   |
| `player_death`              | Generic death                        | 2-3        | TODO   |

### Game Events

| Sound ID                    | Description                          | Variations | Status |
|-----------------------------|--------------------------------------|------------|--------|
| `game_start`                | Match beginning (horn/bell)          | 1          | TODO   |
| `game_end`                  | Match over (fanfare or defeat)       | 2          | TODO   |
| `player_spawn`              | Spawn/teleport in                    | 1-2        | TODO   |
| `player_kill`               | Kill confirmation                    | 1-2        | TODO   |
| `score_point`               | Point scored                         | 1          | LATER  |

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
    mouvement/
      footstep_grass_01-05.wav  (DONE - generic)
      jump_01-04.wav            (DONE - generic)
      land_01.wav               (DONE - generic)
    mouvement/knight/
      knight_footstep_01-05.wav
      knight_jump_01-03.wav
      knight_land_01-03.wav
      knight_armor_foley_01-04.wav
      knight_dodge_01-03.wav
    mouvement/rogue/
      rogue_footstep_01-05.wav
      rogue_jump_01-03.wav
      rogue_land_01-03.wav
      rogue_leather_foley_01-04.wav
      rogue_dodge_01-03.wav
    combat/knight/
      knight_attack_swing_01-04.wav
      knight_attack_hit_01-04.wav
      knight_attack_grunt_01-04.wav
      knight_shield_block_01-03.wav
      knight_sword_draw_01-02.wav
      knight_hit_react_01-04.wav
      knight_death_01-03.wav
      knight_battlecry_01-03.wav
      knight_stun_01-02.wav
    combat/rogue/
      rogue_attack_swing_01-04.wav
      rogue_attack_hit_01-04.wav
      rogue_attack_grunt_01-04.wav
      rogue_dagger_draw_01-02.wav
      rogue_hit_react_01-04.wav
      rogue_death_01-03.wav
      rogue_stun_01-02.wav
    swoosh_quick_01-05.wav      (DONE - generic attack swing)
    game/
      game_start.wav
      game_end_victory.wav
      game_end_defeat.wav
      player_spawn_01-02.wav
      kill_confirm_01-02.wav
  ui/
    ui_click.mp3                (DONE)
    ui_notif.mp3                (DONE)
    ui_hover.mp3
    ui_back.mp3
    ui_error.mp3
  ambient/
    amb_forest.mp3              (DONE)
    amb_montagne.wav            (DONE)
    amb_arena.mp3
  music/
    music_main_theme_01.wav     (DONE)
    music_battle.mp3
    music_victory.mp3
    music_defeat.mp3
```

---

## Priority Order

1. **P0 - Core gameplay feel**: `_attack_swing`, `_attack_hit`, `_attack_grunt`, `_hit_react`, `_death` (per class)
2. **P1 - Class identity**: `knight_footstep`, `rogue_footstep`, `_jump`, `_land`, foley (`_armor_foley`, `_leather_foley`)
3. **P2 - Class personality**: `knight_battlecry`, `_sword_draw`, `_dagger_draw`, `_dodge`
4. **P3 - Game flow**: `game_start`, `game_end`, `player_spawn`, `player_kill`
5. **P4 - UI polish**: `ui_hover`, `ui_back`, `ui_error`, `ui_countdown`
6. **P5 - Atmosphere**: `amb_arena`, `music_battle`, `music_victory`, `music_defeat`

---

## Already Wired (just need sound files + uncomment)

These triggers exist in `triggerTables.ts` but are commented out:

- Line 27: `player_attack_swing` (local input, rising edge on `isAttacking`) — DONE
- Line 28: `player_dodge` (local input, rising edge on `isDodging`)
- Line 83: `player_hit_react` (remote snapshot, health decrease)
- Line 103: Hit server event
- Line 104: Death server event
- Line 105: Dodge server event
