CREATE TABLE account_deletion_requests (
    user_id INTEGER PRIMARY KEY NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    token BLOB NOT NULL,
    confirm_token BLOB DEFAULT NULL,
    expires_at TIMESTAMP NOT NULL
);

CREATE TABLE data_export_requests (
    user_id INTEGER PRIMARY KEY NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    token BLOB NOT NULL,
    confirm_token BLOB DEFAULT NULL,
    expires_at TIMESTAMP NOT NULL
);
