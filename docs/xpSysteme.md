# XP & Level System

## Philosophy & Objectives

### Power/Level Decoupling
Unlike traditional RPGs, leveling grants **no statistical advantage** (HP/Damage) to preserve competitive integrity. Level indicates seniority, not power.

### Extrinsic Progression
The XP system runs parallel to "Skill" (intrinsic) progression. It serves as psychological compensation during losses to prevent the feeling of wasted time.

### Key Functions
- **Retention**: Short-term motivation ("Just one more game to lvl up") and long-term goals (Prestige)
- **Onboarding**: Progressive gatekeeping of complex game modes
- **Status**: Social validation via visible level display

---

## XP Gain Algorithm

The end-of-match XP distribution formula prioritizes game health over individualism.

### XP Sources

| Action                   | XP             | Notes                   |
|------------------------  |----------------|-------------------------|
| Game played              | 10             | Participation reward    |
| Game won                 | +25            | Victory bonus           |
| Win streak (3+)          | +5/streak      | Caps at +25 (8+ streak) |
| Achievement unlocked     | 10-100         | Varies by tier          |

### Average XP per Match

| Scenario          | Calculation  | XP |
|-------------------|--------------|----|
| Loss              | 10           | 10 |
| Win               | 10 + 25      | 35 |
| Win with 3-streak | 10 + 25 + 5  | 40 |
| Win with 8-streak | 10 + 25 + 25 | 60 |

**Average (50% winrate)** | (10 + 35) / 2 | **~22-25**

**Reference value for TTL calculations: 25 XP/match**

---

## Level Progression Model: Stepwise Linear

A "Stepwise Linear" curve ensures easy maintenance and smooth player experience.

### Three Phases

| Phase        | Levels | Matches/Level | Goal                                           |
|--------------|--------|---------------|------------------------------------------------|
| **Hook**     | 1-5    | 1-3           | Immediate gratification, first session reward  |
| **Learning** | 6-20   | 4-10          | Progressive slowdown, skill development period |
| **Cruising** | 21+    | 10 (constant) | Long-term engagement, no "wall" effect         |

---

## Complete XP Table

| Lvl | XP to Next | Cml XP | Mat | Phase    |
|-----|------------|--------|-----|----------|
| 1   | 25         | 0      | -   | -        |
| 2   | 38         | 25     | 1   | Hook     |
| 3   | 50         | 63     | 2-3 | Hook     |
| 4   | 63         | 113    | 4-5 | Hook     |
| 5   | 75         | 176    | 7-8 | Hook     |
| 6   | 100        | 251    | 10  | Learning |
| 7   | 110        | 351    | 14  | Learning |
| 8   | 120        | 461    | 18  | Learning |
| 9   | 130        | 581    | 23  | Learning |
| 10  | 140        | 711    | 28  | Learning |
| 11  | 150        | 851    | 34  | Learning |
| 12  | 160        | 1,001  | 40  | Learning |
| 13  | 170        | 1,161  | 46  | Learning |
| 14  | 180        | 1,331  | 53  | Learning |
| 15  | 190        | 1,511  | 60  | Learning |
| 16  | 200        | 1,701  | 68  | Learning |
| 17  | 210        | 1,901  | 76  | Learning |
| 18  | 220        | 2,111  | 84  | Learning |
| 19  | 230        | 2,331  | 93  | Learning |
| 20  | 240        | 2,561  | 102 | Learning |
| 21  | 250        | 2,801  | 112 | Cruising |
| 25  | 250        | 3,801  | 152 | Cruising |
| 30  | 250        | 5,051  | 202 | Cruising |
| 40  | 250        | 7,551  | 302 | Cruising |
| 50  | 250        | 10,051 | 402 | Cruising |
| 100 | 250        | 22,551 | 902 | Cruising |

---

## Database Schema

```sql
-- User stats table (XP and level stored here)
CREATE TABLE user_stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_won INTEGER NOT NULL DEFAULT 0,
    current_win_streak INTEGER NOT NULL DEFAULT 0,
    best_win_streak INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- PLACEHOLDER: This schema is temporary. The final structure depends on how
-- game data will be retrieved from the game engine.
CREATE TABLE games (
    id            INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    player1_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player2_id    INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    winner_id     INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kills_p1      INTEGER  NOT NULL DEFAULT 0,
    kills_p2      INTEGER  NOT NULL DEFAULT 0,
    damage_p1     INTEGER  NOT NULL DEFAULT 0,
    damage_p2     INTEGER  NOT NULL DEFAULT 0,
    played_at     DATETIME NOT NULL
);
```

**Note**: `level` is stored for quick queries but can always be recalculated from `xp` using `level_from_xp()`.

**Note**: `user_stats` rows are only created when a player plays their first game. GET endpoints return default stats (level 1, 0 XP) in memory without inserting into the DB.

---

## Edge Cases

New user -> Starts at Level 1, 0 XP
XP exactly at level threshold -> Shows 0% progress, level incremented
Level 100+ -> Same as level 21 (250 XP/level)
Negative XP -> Clamp to 0
