//! Database models used by the backend.
//!
//! These structs are mapped to Diesel tables declared in `crate::schema`.
//! The schema file is generated from migrations and then customized via
//! `src/schema.patch`.
//!
//! When changing anything related to database migrations, run:
//! `backend/scripts/run_migrations_update_schema.sh`
//!
//! This applies migrations to the local database and regenerates `src/schema.rs`
//! (and the corresponding patch workflow) so models and schema stay in sync.

use crate::{
    auth::session_token::SessionTokenHash,
    models::{cbor_blob::CborBlob, nickname::Nickname},
    notifications::NotificationPayload,
};
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use diesel_autoincrement_new_struct::{NewInsertable, apply};
use salvo::oapi::ToSchema;
use serde::{Deserialize, Serialize};

#[macro_use]
mod i32_enum;
#[allow(dead_code)]
pub mod blob;
pub mod cbor_blob;
pub mod nickname;
mod ulid;

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, ToSchema, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = crate::schema::users)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct User {
    pub id: i32,
    pub email: String,
    pub nickname: Nickname,
    pub totp_enabled: bool,
    #[serde(skip)]
    pub totp_secret_enc: Option<String>,
    pub totp_confirmed_at: Option<DateTime<Utc>>,
    #[serde(skip)]
    pub password_hash: String,
    pub created_at: DateTime<Utc>,
    pub description: String,
    pub tos_accepted_at: Option<DateTime<Utc>>,
    pub email_confirmed_at: Option<DateTime<Utc>>,
    #[serde(skip)]
    pub email_confirmation_token_hash: Option<Vec<u8>>,
    #[serde(skip)]
    pub email_confirmation_token_expires_at: Option<DateTime<Utc>>,
    #[serde(skip)]
    pub email_confirmation_token_email: Option<String>,
}

impl NewUser {
    pub fn new(email: String, nickname: Nickname, password_hash: String) -> Self {
        let now = chrono::Utc::now();
        NewUser {
            email,
            nickname,
            totp_enabled: false,
            totp_secret_enc: None,
            totp_confirmed_at: None,
            password_hash,
            created_at: now,
            description: String::new(),
            tos_accepted_at: Some(now),
            email_confirmed_at: None,
            email_confirmation_token_hash: None,
            email_confirmation_token_expires_at: None,
            email_confirmation_token_email: None,
        }
    }
}

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, Associations, AsChangeset, Debug, Clone)]
#[diesel(table_name = crate::schema::sessions)]
#[diesel(belongs_to(User))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Session {
    pub id: i32,
    pub user_id: i32,
    pub token_hash: SessionTokenHash,
    pub device_id: String,
    pub device_name: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
    pub refreshed_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
    pub last_authenticated_at: DateTime<Utc>,
}

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, Associations, AsChangeset, Debug, Clone)]
#[diesel(table_name = crate::schema::two_fa_recovery_codes)]
#[diesel(belongs_to(User))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TwoFaRecoveryCode {
    pub id: i32,
    pub user_id: i32,
    pub code_hash: Vec<u8>,
    pub used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl NewTwoFaRecoveryCode {
    pub fn new(user_id: i32, code_hash: Vec<u8>) -> Self {
        NewTwoFaRecoveryCode {
            user_id,
            code_hash,
            used_at: None,
            created_at: chrono::Utc::now(),
        }
    }
}

// ============================================================================
// Games
// ============================================================================

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = crate::schema::games)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Game {
    pub id: i32,
    pub player1_id: i32,
    pub player2_id: i32,
    pub winner_id: i32,
    pub score_p1: i32,
    pub score_p2: i32,
    pub played_at: DateTime<Utc>,
}

impl NewGame {
    pub fn new(
        player1_id: i32,
        player2_id: i32,
        winner_id: i32,
        score_p1: i32,
        score_p2: i32,
    ) -> Self {
        NewGame {
            player1_id,
            player2_id,
            winner_id,
            score_p1,
            score_p2,
            played_at: chrono::Utc::now(),
        }
    }
}

// ============================================================================
// User Stats (XP/Level System)
// ============================================================================

#[derive(Queryable, Selectable, Insertable, AsChangeset, Associations, Debug, Clone)]
#[diesel(table_name = crate::schema::user_stats)]
#[diesel(belongs_to(User))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserStats {
    pub user_id: i32,
    pub xp: i32,
    pub level: i32,
    pub games_played: i32,
    pub games_won: i32,
    pub current_win_streak: i32,
    pub best_win_streak: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl UserStats {
    pub fn new(user_id: i32) -> Self {
        let now = chrono::Utc::now();
        Self {
            user_id,
            xp: 0,
            level: 1,
            games_played: 0,
            games_won: 0,
            current_win_streak: 0,
            best_win_streak: 0,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }

    pub fn updated_at(&self) -> DateTime<Utc> {
        self.updated_at
    }

    pub fn games_lost(&self) -> i32 {
        self.games_played - self.games_won
    }

    pub fn win_rate(&self) -> f32 {
        if self.games_played == 0 {
            0.0
        } else {
            (self.games_won as f32 / self.games_played as f32) * 100.0
        }
    }

    /// Apply a game result: update counters, calculate XP, recalculate level.
    /// Returns the XP gained and whether a level-up occurred.
    pub fn record_game(&mut self, won: bool) -> (i32, bool) {
        use crate::gamification::xp;

        let previous_level = self.level;

        // Update game counters
        self.games_played += 1;
        if won {
            self.games_won += 1;
            self.current_win_streak += 1;
            if self.current_win_streak > self.best_win_streak {
                self.best_win_streak = self.current_win_streak;
            }
        } else {
            self.current_win_streak = 0;
        }

        // Calculate and award XP
        let xp_gained = xp::rewards::calculate_game_xp(won, self.current_win_streak);
        self.xp += xp_gained;

        // Recalculate level from total XP
        self.level = xp::level_from_xp(self.xp);
        self.updated_at = chrono::Utc::now();

        let leveled_up = self.level > previous_level;
        (xp_gained, leveled_up)
    }
}

impl Session {
    pub fn rotate<const DO_REAUTH: bool>(
        &self,
        token_hash: SessionTokenHash,
        device_id: String,
        device_name: Option<String>,
        ip_address: Option<String>,
    ) -> Self {
        let now = chrono::Utc::now();

        Self {
            id: self.id,
            user_id: self.user_id,
            token_hash,
            device_id,
            device_name: device_name.or_else(|| self.device_name.clone()),
            ip_address: ip_address.or_else(|| self.ip_address.clone()),
            created_at: self.created_at,
            refreshed_at: now,
            last_used_at: now,
            last_authenticated_at: match DO_REAUTH {
                true => now,
                false => self.last_authenticated_at,
            },
        }
    }
}

impl NewSession {
    pub fn new(
        user_id: i32,
        token_hash: SessionTokenHash,
        device_id: String,
        device_name: Option<String>,
        ip_address: Option<String>,
    ) -> Self {
        let now = chrono::Utc::now();
        Self {
            user_id,
            token_hash,
            device_id,
            device_name,
            ip_address,
            created_at: now,
            refreshed_at: now,
            last_used_at: now,
            last_authenticated_at: now,
        }
    }
}

/// Large avatar (450x450, AVIF format)
#[derive(Queryable, Selectable, Insertable, AsChangeset, Debug, Clone)]
#[diesel(table_name = crate::schema::avatars_large)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AvatarLarge {
    pub user_id: i32,
    pub data: Vec<u8>,
    pub updated_at: DateTime<Utc>,
}

impl AvatarLarge {
    pub fn new(user_id: i32, data: Vec<u8>) -> Self {
        Self {
            user_id,
            data,
            updated_at: chrono::Utc::now(),
        }
    }
}

/// Small avatar (200x200, AVIF format)
#[derive(Queryable, Selectable, Insertable, AsChangeset, Debug, Clone)]
#[diesel(table_name = crate::schema::avatars_small)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AvatarSmall {
    pub user_id: i32,
    pub data: Vec<u8>,
    pub updated_at: DateTime<Utc>,
}

impl AvatarSmall {
    pub fn new(user_id: i32, data: Vec<u8>) -> Self {
        Self {
            user_id,
            data,
            updated_at: chrono::Utc::now(),
        }
    }
}

diesel_i32_enum! {
    #[serde(rename_all = "lowercase")]
    pub enum FriendRequestStatus {
        Pending = 0,
        Accepted = 1,
    }
}

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, AsChangeset, Debug, Clone)]
#[diesel(table_name = crate::schema::friend_requests)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FriendRequest {
    pub id: i32,
    pub sender_id: i32,
    pub receiver_id: i32,
    pub status: FriendRequestStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl NewFriendRequest {
    pub fn new(sender_id: i32, receiver_id: i32) -> Self {
        let now = chrono::Utc::now();
        Self {
            sender_id,
            receiver_id,
            status: FriendRequestStatus::Pending,
            created_at: now,
            updated_at: now,
        }
    }
}

/// Notification Database model for offline notifications
#[derive(Insertable)]
#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, Associations, AsChangeset, Debug, Clone)]
#[diesel(belongs_to(User))]
#[diesel(table_name = crate::schema::notifications)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct OfflineNotification {
    pub id: i32,
    pub user_id: i32,
    pub data: CborBlob<NotificationPayload>,
    pub created_at: DateTime<Utc>,
}

// construct and use NewOfflineNotification (which omits the id field) for insertion
