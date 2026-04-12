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
CREATE INDEX idx_games_player1   ON games(player1_id);
CREATE INDEX idx_games_player2   ON games(player2_id);
CREATE INDEX idx_games_played_at ON games(played_at);
