-- Small avatar images (200x200, AVIF format, max ~4kb)
-- One avatar per user, stores the binary AVIF data directly
CREATE TABLE avatars_small (
    user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data BLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
