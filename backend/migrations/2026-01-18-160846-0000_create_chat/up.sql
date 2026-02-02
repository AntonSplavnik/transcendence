-- Chat backbone tables (rooms + participants + messages)
CREATE TABLE chat_rooms (
	id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
	name TEXT,
	chat_type INTEGER NOT NULL,
	-- For DM rooms we store a stable unique key "min_user_id:max_user_id".
	-- For other room types this is NULL.
	dm_key TEXT UNIQUE,
	created_at TIMESTAMP NOT NULL
);
CREATE TABLE chat_members (
	room_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	is_admin BOOLEAN NOT NULL,
	last_read_message_id INTEGER,
	joined_at TIMESTAMP NOT NULL,
	PRIMARY KEY (room_id, user_id),
	FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- Pending invitation list, depending on room type
CREATE TABLE chat_invitations (
	room_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	actor_id INTEGER,
	created_at TIMESTAMP NOT NULL,
	PRIMARY KEY (room_id, user_id),
	FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE
	SET NULL
);
CREATE TABLE chat_messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
	room_id INTEGER NOT NULL,
	sender_id INTEGER NOT NULL,
	content TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL,
	FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
	FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_messages_room_id_id ON chat_messages(room_id, id);
