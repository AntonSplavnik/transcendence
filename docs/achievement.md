# Achievements

Implementation of a classic achievement system

## Schema

## Achievement List

### Games
| Code           | Name        | Bronze | Silver | Gold | Base XP |
|----------------|-------------|--------|--------|------|---------|
| `games_played` | Veteran     | 10     | 50     | 200  | 20      |
| `games_won`    | Champion    | 5      | 25     | 100  | 25      |
| `win_streak`   | Unstoppable | 3      | 5      | 10   | 30      |

### Combat (future - stats not yet tracked)
| Code          | Name        | Bronze | Silver | Gold | Base XP |
|---------------|-------------|--------|--------|------|---------|
| `total_kills` | Eliminator  | 25     | 100    | 500  | 20      |
| `spells_cast` | Spellcaster | 50     | 200    | 1000 | 15      |

### Misc (future - stats not yet tracked)
| Code                 | Name       | Bronze | Silver | Gold | Base XP |
|----------------------|------------|--------|--------|------|---------|
| `daily_completed`    | Dedicated  | 7      | 30     | 100  | 15      |
| `playtime_hours`     | Devoted    | 5      | 25     | 100  | 20      |
| `first_blood`        | Quick Draw | 10     | 50     | 200  | 25      |

More to add !

## XP Rewards

| Tier   | Multiplier | Example (base 20) |
|--------|------------|-------------------|
| Bronze | 1x         | 20 XP             |
| Silver | 2x         | 40 XP             |
| Gold   | 3x         | 60 XP             |

## API Endpoints

```
GET  /api/stats/achievements        -> All achievements + user progress
GET  /api/stats/achievements/recent -> Last 20 unlocked tiers (most recent first)
POST /api/stats/record-game         -> Records game, checks achievements, returns unlocks
```

### `POST /api/stats/record-game` response
```json
{
  "xp_gained": 55,
  "leveled_up": false,
  "stats": { "..." },
  "achievement_unlocks": [
    { "achievement_code": "games_played", "tier": "bronze", "xp_reward": 20 }
  ]
}
```

## Flow

```
record_game()
  -> update user_stats (counters + XP + level)
  -> check_achievements(stats)
       -> for each achievement with a trackable stat:
            compare current value vs thresholds
            if new tier unlocked -> upsert user_achievements, return unlock
  -> award achievement XP (added to user_stats)
  -> return response with unlocks
```

## Currently Trackable

Only 3 achievements map to existing `user_stats` fields:
- `games_played` -> `stats.games_played`
- `games_won` -> `stats.games_won`
- `win_streak` -> `stats.best_win_streak`

The other 6 are seeded but skipped until their stats are added to `user_stats`.
