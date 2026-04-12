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

-- Seed achievements
-- Category: Games
INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('games_played', 'Veteran', 'Play games to earn this achievement', 'Games', 10, 50, 200, 20, datetime('now'));

INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('games_won', 'Champion', 'Win games to earn this achievement', 'Games', 5, 25, 100, 25, datetime('now'));

INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('win_streak', 'Unstoppable', 'Achieve consecutive wins', 'Games', 3, 5, 10, 30, datetime('now'));

-- Category: Combat
INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('total_kills', 'Eliminator', 'Eliminate opponents', 'Combat', 25, 100, 500, 20, datetime('now'));

INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('spells_cast', 'Spellcaster', 'Cast spells during games', 'Combat', 50, 200, 1000, 15, datetime('now'));

INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('perfect_game', 'Flawless', 'Win without dying', 'Combat', 1, 5, 20, 50, datetime('now'));

-- Category: Misc
INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('daily_completed', 'Dedicated', 'Complete daily challenges', 'Misc', 7, 30, 100, 15, datetime('now'));

INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('playtime_hours', 'Devoted', 'Spend time playing', 'Misc', 5, 25, 100, 20, datetime('now'));

INSERT INTO achievements (code, name, description, category, bronze_threshold, silver_threshold, gold_threshold, base_xp_reward, created_at)
VALUES ('first_blood', 'Quick Draw', 'Score the first point in a game', 'Misc', 10, 50, 200, 25, datetime('now'));
