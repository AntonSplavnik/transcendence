-- User stats table (XP/Level system)
CREATE TABLE IF NOT EXISTS user_stats (
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
    active_challenge_id INTEGER NOT NULL REFERENCES active_daily_challenges(id),
    current_progress INTEGER NOT NULL DEFAULT 0,
    completed_at DATETIME,
    xp_claimed BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(user_id, active_challenge_id)
);

CREATE INDEX idx_user_daily_user ON user_daily_progress(user_id);

-- Seed daily challenge pool
INSERT INTO daily_challenge_pool (code, description, difficulty, target_value, stat_to_track, xp_reward, created_at)
VALUES ('play_games_1', 'Play a game', 'easy', 1, 'games_played', 15, datetime('now'));

INSERT INTO daily_challenge_pool (code, description, difficulty, target_value, stat_to_track, xp_reward, created_at)
VALUES ('play_games_3', 'Play 3 games', 'easy', 3, 'games_played', 15, datetime('now'));

INSERT INTO daily_challenge_pool (code, description, difficulty, target_value, stat_to_track, xp_reward, created_at)
VALUES ('win_game_1', 'Win a game', 'medium', 1, 'games_won', 30, datetime('now'));

INSERT INTO daily_challenge_pool (code, description, difficulty, target_value, stat_to_track, xp_reward, created_at)
VALUES ('win_games_2', 'Win 2 games', 'medium', 2, 'games_won', 30, datetime('now'));

INSERT INTO daily_challenge_pool (code, description, difficulty, target_value, stat_to_track, xp_reward, created_at)
VALUES ('win_games_3', 'Win 3 games', 'hard', 3, 'games_won', 50, datetime('now'));

INSERT INTO daily_challenge_pool (code, description, difficulty, target_value, stat_to_track, xp_reward, created_at)
VALUES ('win_streak_2', 'Win 2 in a row', 'hard', 2, 'win_streak', 50, datetime('now'));

INSERT INTO daily_challenge_pool (code, description, difficulty, target_value, stat_to_track, xp_reward, created_at)
VALUES ('win_streak_3', 'Win 3 in a row', 'hard', 3, 'win_streak', 50, datetime('now'));
