-- Large avatar images (450x450, AVIF format, max ~12kb)
-- One avatar per user, stores the binary AVIF data directly
CREATE TABLE avatars_large (
    user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data BLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
