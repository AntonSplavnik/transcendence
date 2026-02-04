use chrono::{DateTime, NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel_autoincrement_new_struct::{NewInsertable, apply};
use salvo::oapi::ToSchema;
use serde::Serialize;

use crate::auth::session_token::SessionTokenHash;

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, ToSchema, Serialize, Debug, Clone)]
#[diesel(table_name = crate::schema::users)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct User {
    pub id: i32,
    pub email: String,
    pub nickname: String,
    pub totp_enabled: bool,
    #[serde(skip)]
    pub totp_secret_enc: Option<String>,
    totp_confirmed_at: Option<NaiveDateTime>,
    #[serde(skip)]
    pub password_hash: String,
    created_at: NaiveDateTime,
}

impl User {
    pub fn totp_confirmed_at(&self) -> Option<DateTime<Utc>> {
        self.totp_confirmed_at.map(|dt| dt.and_utc())
    }
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at.and_utc()
    }
}

impl NewUser {
    pub fn new(email: String, nickname: String, password_hash: String) -> Self {
        NewUser {
            email,
            nickname,
            totp_enabled: false,
            totp_secret_enc: None,
            totp_confirmed_at: None,
            password_hash,
            created_at: chrono::Utc::now().naive_utc(),
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
    created_at: NaiveDateTime,
    refreshed_at: NaiveDateTime,
    last_used_at: NaiveDateTime,
    last_authenticated_at: NaiveDateTime,
}

impl Session {
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at.and_utc()
    }
    pub fn refreshed_at(&self) -> DateTime<Utc> {
        self.refreshed_at.and_utc()
    }
    pub fn last_used_at(&self) -> DateTime<Utc> {
        self.last_used_at.and_utc()
    }
    pub fn last_authenticated_at(&self) -> DateTime<Utc> {
        self.last_authenticated_at.and_utc()
    }
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
    used_at: Option<NaiveDateTime>,
    created_at: NaiveDateTime,
}

impl TwoFaRecoveryCode {
    pub fn used_at(&self) -> Option<DateTime<Utc>> {
        self.used_at.map(|dt| dt.and_utc())
    }
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at.and_utc()
    }
}

impl NewTwoFaRecoveryCode {
    pub fn new(user_id: i32, code_hash: Vec<u8>) -> Self {
        NewTwoFaRecoveryCode {
            user_id,
            code_hash,
            used_at: None,
            created_at: chrono::Utc::now().naive_utc(),
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
    created_at: NaiveDateTime,
    updated_at: NaiveDateTime,
}

impl UserStats {
    pub fn new(user_id: i32) -> Self {
        let now = chrono::Utc::now().naive_utc();
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
        self.created_at.and_utc()
    }

    pub fn updated_at(&self) -> DateTime<Utc> {
        self.updated_at.and_utc()
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
        self.updated_at = chrono::Utc::now().naive_utc();

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
        let now = chrono::Utc::now().naive_utc();

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
        let now = chrono::Utc::now().naive_utc();
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
