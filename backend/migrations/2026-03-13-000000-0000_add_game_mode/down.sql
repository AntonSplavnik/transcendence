-- SQLite does not support DROP COLUMN in older versions; recreate the table without the mode column
CREATE TABLE games_backup (
    id         INTEGER  NOT NULL PRIMARY KEY AUTOINCREMENT,
    player1_id INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player2_id INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    winner_id  INTEGER  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score_p1   INTEGER  NOT NULL,
    score_p2   INTEGER  NOT NULL,
    played_at  DATETIME NOT NULL
);
INSERT INTO games_backup SELECT id, player1_id, player2_id, winner_id, score_p1, score_p2, played_at FROM games;
DROP TABLE games;
ALTER TABLE games_backup RENAME TO games;
CREATE INDEX idx_games_player1   ON games(player1_id);
CREATE INDEX idx_games_player2   ON games(player2_id);
CREATE INDEX idx_games_played_at ON games(played_at);
