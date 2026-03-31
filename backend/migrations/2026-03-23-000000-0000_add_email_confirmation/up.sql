ALTER TABLE users ADD COLUMN email_confirmed_at TIMESTAMP DEFAULT NULL;
ALTER TABLE users ADD COLUMN email_confirmation_token_hash BLOB DEFAULT NULL;
ALTER TABLE users ADD COLUMN email_confirmation_token_expires_at TIMESTAMP DEFAULT NULL;
ALTER TABLE users ADD COLUMN email_confirmation_token_email TEXT DEFAULT NULL;
