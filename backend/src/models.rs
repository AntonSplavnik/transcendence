use chrono::NaiveDateTime;
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
    pub totp_confirmed_at: Option<NaiveDateTime>,
    #[serde(skip)]
    pub password_hash: String,
    pub created_at: NaiveDateTime,
    pub avatar_url: Option<String>,
    pub is_online: bool,
    pub last_seen: Option<NaiveDateTime>,
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
    pub created_at: NaiveDateTime,
    pub refreshed_at: NaiveDateTime,
    pub last_used_at: NaiveDateTime,
    pub last_authenticated_at: NaiveDateTime,
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
    pub used_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
}

impl Session {
    pub fn rotate(
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
            last_authenticated_at: self.last_authenticated_at,
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

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, Associations, ToSchema, Serialize, Debug, Clone)]
#[diesel(table_name = crate::schema::user_stats)]
#[diesel(belongs_to(User))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserStats {
    pub id: i32,
    pub user_id: i32,
    pub games_played: i32,
    pub total_kills: i32,
    pub total_time_played: i32,
    pub last_game_kills: i32,
    pub last_game_time: i32,
    pub last_game_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(AsChangeset, Debug)]
#[diesel(table_name = crate::schema::user_stats)]
pub struct UpdateUserStats {
    pub games_played: Option<i32>,
    pub total_kills: Option<i32>,
    pub total_time_played: Option<i32>,
    pub last_game_kills: Option<i32>,
    pub last_game_time: Option<i32>,
    pub last_game_at: Option<NaiveDateTime>,
    pub updated_at: NaiveDateTime,
}

// ===== GAME HISTORY MODELS =====

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, Associations, ToSchema, Serialize, Debug, Clone)]
#[diesel(table_name = crate::schema::game_history)]
#[diesel(belongs_to(User))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct GameHistory {
    pub id: i32,
    pub user_id: i32,
    pub kills: i32,
    pub time_played: i32,
    pub played_at: NaiveDateTime,
}

// ===== FRIENDSHIP MODELS =====

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, Associations, ToSchema, Serialize, Debug, Clone)]
#[diesel(table_name = crate::schema::friendships)]
#[diesel(belongs_to(User, foreign_key = from_user_id))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct Friendship {
    pub id: i32,
    pub from_user_id: i32,
    pub to_user_id: i32,
    pub status: String,  // "pending", "accepted", "declined", "blocked"
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(AsChangeset, Debug)]
#[diesel(table_name = crate::schema::friendships)]
pub struct UpdateFriendship {
    pub status: Option<String>,
    pub updated_at: NaiveDateTime,
}

// ===== ACHIEVEMENT MODELS =====

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, Associations, ToSchema, Serialize, Debug, Clone)]
#[diesel(table_name = crate::schema::user_achievements)]
#[diesel(belongs_to(User))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserAchievement {
    pub id: i32,
    pub user_id: i32,
    pub achievement_id: String,
    pub unlocked_at: NaiveDateTime,
}