CREATE TABLE notifications (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	-- CBOR encoded notification data which decodes to the rust Notification enum
	data BLOB NOT NULL,
	created_at DATETIME NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_notifications_user_created_at ON notifications (user_id, created_at);
