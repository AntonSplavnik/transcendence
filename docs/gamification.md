# Gamification System

## Overview

This document describes the gamification system and its shared data architecture with the game statistics/match history feature. Both features share the same data pipeline to avoid duplication.

### Features Covered
- **XP/Level System** - Progression system based on gameplay
- **Achievements** - Permanent unlockables based on cumulative actions
- **Daily Challenges** - 3 random quests refreshed daily, rewarding XP

### Related Feature
- **Game Statistics & Match History** - Shares the same data source (see Architecture)

---

## 1. Shared Data Architecture

### The Problem

Two features need overlapping data:

```
Gamification (XP/Level)          Game Stats & Match History
───────────────────────          ─────────────────────────
games_played ◄──────────────────► games_played
games_won    ◄──────────────────► wins/losses
win_streak                        match details, opponents
xp, level                        ranking, leaderboard
```

### The Solution: Single Source of Truth

`match_history` is the source of truth. `user_stats` is a denormalized cache updated on every match end. Both are populated by a single `record-game` flow.

```
                      ┌──────────────────────────┐
                      │    Match ends (game)      │
                      └────────────┬─────────────┘
                                   │
                         single transaction
                                   │
               ┌───────────────────┼───────────────────┐
               ▼                                       ▼
┌──────────────────────────┐           ┌───────────────────────────┐
│     match_history        │           │       user_stats          │
│   (source of truth)      │           │   (denormalized cache)    │
│                          │           │                           │
│  Every match recorded    │           │  Aggregated counters      │
│  with full details       │           │  XP, level, streaks       │
│                          │           │  Recalculable from        │
│  Used by:                │           │  match_history if needed  │
│  - Match history page    │           │                           │
│  - Opponents list        │           │  Used by:                 │
│  - Detailed stats        │           │  - Profile stats          │
│                          │           │  - Leaderboard            │
│                          │           │  - XP/Level display       │
│                          │           │  - Achievement checking   │
└──────────────────────────┘           └───────────────────────────┘
```

### Record-Game Flow (Single Entry Point)

```rust
fn record_game(result: GameResult) {
    // All in one transaction
    conn.transaction(|conn| {
        // 1. INSERT into match_history (source of truth)
        insert_match(conn, &result);

        // 2. UPDATE user_stats (cache: counters + XP + level)
        update_user_stats(conn, &result);

        // 3. CHECK achievements (reads from user_stats)
        check_achievements(conn, &result);

        // 4. UPDATE daily challenge progress
        update_daily_progress(conn, &result);
    });
}
```

### What Each Feature Reads

| Feature             | Reads from | Writes to |
|---------------------|------------|-----------|
| **XP/Level display**| `user_stats` | - |
| **Profile stats**   | `user_stats` | - |
| **Leaderboard**     | `user_stats` ORDER BY xp/wins | - |
| **Match history page** | `match_history` JOIN users | - |
| **Achievements**     | `user_stats` + `user_achievements` | `user_achievements` |
| **Daily challenges** | `user_daily_progress` | `user_daily_progress` |
| **Record game** (write) | - | `match_history` + `user_stats` |

---

## 2. Database Schema

### Core Tables (shared by both features)

```sql
-- Source of truth: every match ever played
CREATE TABLE match_history (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    player_1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_2_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    winner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    score_player_1 INTEGER NOT NULL DEFAULT 0,
    score_player_2 INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    xp_player_1 INTEGER NOT NULL DEFAULT 0,
    xp_player_2 INTEGER NOT NULL DEFAULT 0,
    played_at DATETIME NOT NULL
);

CREATE INDEX idx_match_history_player_1 ON match_history(player_1_id);
CREATE INDEX idx_match_history_player_2 ON match_history(player_2_id);
CREATE INDEX idx_match_history_played_at ON match_history(played_at);

-- Denormalized cache: current state of each player
CREATE TABLE user_stats (
    user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_won INTEGER NOT NULL DEFAULT 0,
    current_win_streak INTEGER NOT NULL DEFAULT 0,
    best_win_streak INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
```

### Gamification Tables

```sql
-- Reference table: all possible achievements
CREATE TABLE achievements (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    bronze_threshold INTEGER NOT NULL,
    silver_threshold INTEGER NOT NULL,
    gold_threshold INTEGER NOT NULL,
    base_xp_reward INTEGER NOT NULL DEFAULT 20,
    created_at DATETIME NOT NULL
);

-- User progress on achievements
CREATE TABLE user_achievements (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    current_progress INTEGER NOT NULL DEFAULT 0,
    bronze_unlocked_at DATETIME,
    silver_unlocked_at DATETIME,
    gold_unlocked_at DATETIME,
    UNIQUE(user_id, achievement_id)
);

CREATE INDEX idx_user_achievements_user ON user_achievements(user_id);

-- Pool of all possible daily challenges
CREATE TABLE daily_challenge_pool (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    target_value INTEGER NOT NULL,
    stat_to_track TEXT NOT NULL,
    xp_reward INTEGER NOT NULL,
    created_at DATETIME NOT NULL
);

-- Currently active daily challenges (3 per day)
CREATE TABLE active_daily_challenges (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL REFERENCES daily_challenge_pool(id),
    active_date DATE NOT NULL,
    slot INTEGER NOT NULL CHECK (slot IN (1, 2, 3)),
    UNIQUE(active_date, slot)
);

CREATE INDEX idx_active_daily_date ON active_daily_challenges(active_date);

-- User progress on daily challenges
CREATE TABLE user_daily_progress (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_id INTEGER NOT NULL REFERENCES daily_challenge_pool(id),
    progress_date DATE NOT NULL,
    current_progress INTEGER NOT NULL DEFAULT 0,
    completed_at DATETIME,
    xp_claimed BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(user_id, challenge_id, progress_date)
);

CREATE INDEX idx_user_daily_user_date ON user_daily_progress(user_id, progress_date);
```

---

## 3. XP & Level System

Detailed in [xpSysteme.md](./xpSysteme.md).

---

## 4. Achievements

### Achievement Tiers

| Tier | Multiplier | Icon |
|------|------------|------|
| Bronze | 1x | Bronze |
| Silver | 2x | Silver |
| Gold | 3x | Gold |

### Achievement Categories

#### Games
| Code | Name | Bronze | Silver | Gold | Base XP |
|------|------|--------|--------|------|---------|
| `games_played` | Veteran | 10 | 50 | 200 | 20 |
| `games_won` | Champion | 5 | 25 | 100 | 25 |
| `win_streak` | Unstoppable | 3 | 5 | 10 | 30 |

#### Combat
| Code | Name | Bronze | Silver | Gold | Base XP |
|------|------|--------|--------|------|---------|
| `total_kills` | Eliminator | 25 | 100 | 500 | 20 |
| `spells_cast` | Spellcaster | 50 | 200 | 1000 | 15 |
| `perfect_game` | Flawless | 1 | 5 | 20 | 50 |

#### Misc
| Code | Name | Bronze | Silver | Gold | Base XP |
|------|------|--------|--------|------|---------|
| `daily_completed` | Dedicated | 7 | 30 | 100 | 15 |
| `playtime_hours` | Devoted | 5 | 25 | 100 | 20 |
| `first_blood` | Quick Draw | 10 | 50 | 200 | 25 |

---

## 5. Daily Challenges

### Difficulty & Rewards

| Difficulty | XP Reward | Slot |
|------------|-----------|------|
| Easy | 15 XP | 1 |
| Medium | 30 XP | 2 |
| Hard | 50 XP | 3 |

### Daily Selection

Every day at 00:00 UTC: select 1 easy + 1 medium + 1 hard randomly from the pool.

### Challenge Pool Examples

| Code | Description | Difficulty | Target |
|------|-------------|------------|--------|
| `play_games_2` | Play 2 games | Easy | 2 |
| `cast_spells_10` | Cast 10 spells | Easy | 10 |
| `win_game_1` | Win a game | Medium | 1 |
| `kills_5` | Get 5 kills | Medium | 5 |
| `win_games_3` | Win 3 games | Hard | 3 |
| `win_streak_2` | Win 2 in a row | Hard | 2 |
| `perfect_game` | Win without dying | Hard | 1 |

---

## 6. API Endpoints

### Stats (shared)

```
GET  /api/stats/@me              -> Current user stats (XP, level, games)
GET  /api/stats/:userId          -> Public user stats
```

### Record Game (shared entry point)

```
POST /api/stats/record-game      -> Record match result
                                    Writes to: match_history + user_stats
                                    Triggers: achievement check + daily progress
```

### Match History (game stats feature)

```
GET  /api/matches/@me            -> Current user match history
GET  /api/matches/:userId        -> User match history
```

### Achievements

```
GET  /api/achievements           -> All achievements with user progress
GET  /api/achievements/recent    -> Recently unlocked
```

### Daily Challenges

```
GET  /api/challenges/daily       -> Today's 3 challenges with progress
POST /api/challenges/claim/:id   -> Claim XP for completed challenge
```

### Leaderboard

```
GET  /api/leaderboard?type=xp&page=1&limit=50
GET  /api/leaderboard?type=wins&page=1&limit=50
```

---

## 7. Implementation Plan

- Module Minor : Gamification
### Branch 1: XP/Level (current)
1. [x] Create `user_stats` migration
2. [x] Create `UserStats` model
3. [x] Implement XP calculation logic (`gamification/xp.rs`)
4. [x] Stats endpoints (`GET /api/stats/@me`, `GET /api/stats/:userId`)
5. [x] Record game endpoint (`POST /api/stats/record-game`)

### Branch 2: Achievements
6. [ ] Create `achievements` + `user_achievements` migrations
7. [ ] Seed achievement data
8. [ ] Achievement checking logic (triggered by record-game)
9. [ ] Achievement endpoints

### Branch 3: Daily Challenges
10. [ ] Create daily challenge migrations
11. [ ] Seed challenge pool
12. [ ] Daily selection logic (on startup / cron)
13. [ ] Daily challenge endpoints

### Branch 4: Frontend
14. [ ] XP bar component
15. [ ] Match history page
16. [ ] Achievement display
17. [ ] Daily challenges UI
18. [ ] Notification toasts
19. [ ] Leaderboard page

- Module Game : statistics and match history (Here just to link record record-game later)
### Branch 1: Match History & Game Stats
1. [ ] Create `match_history` migration
2. [ ] Create `MatchHistory` model
3. [ ] Match history endpoints
4. [ ] Leaderboard endpoint
5. [ ] Integrate record-game with match_history insert

---

## 8. Future Enhancements

- **Seasonal challenges** - Monthly themed achievements
- **Badges** - Visual flair for profile (separate from achievements)
- **Rewards shop** - Spend XP on cosmetics
- **Friend challenges** - Challenge friends to beat your score
- **Weekly tournaments** - Competitive events with special rewards
