use crate::{
    auth::session_token::SessionTokenHash,
    models::{
        blob::{VarStr, WritableVarBlob},
        chatname::Chatname,
        nickname::Nickname,
    },
};
use ::ulid::Ulid;
use chrono::{DateTime, NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel_autoincrement_new_struct::{NewInsertable, apply};
use diesel_derive_newtype::DieselNewType;
use salvo::oapi::ToSchema;
use serde::Serialize;

#[macro_use]
mod i32_enum;
pub mod blob;
pub mod chatname;
pub mod nickname;
mod ulid;

pub use ulid::SqlUlid;

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, ToSchema, Serialize, Debug, Clone)]
#[diesel(table_name = crate::schema::users)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct User {
    pub id: i32,
    pub email: String,
    pub nickname: Nickname,
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
    pub fn new(
        email: String,
        nickname: Nickname,
        password_hash: String,
    ) -> Self {
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

diesel_i32_enum! {
    #[derive(Serialize, serde::Deserialize)]
    pub enum ChatRoomType {
        Global,
        Public,
        InviteOnly,
        Dm,
        GameLobby,
    }
}

/// Direct Message Key
///
/// Internal use only to identify DM chat rooms between two users.
/// Format: "min_user_id:max_user_id"
#[derive(DieselNewType, Debug, Hash, PartialEq, Eq, ToSchema, Clone, Copy)]
pub struct DmKey(VarStr<23>);

impl DmKey {
    pub fn new(users: (i32, i32)) -> Self {
        use std::io::Write;
        let mut s = WritableVarBlob::new();
        let (min_user, max_user) = if users.0 < users.1 {
            (users.0, users.1)
        } else {
            (users.1, users.0)
        };
        write!(&mut s, "{}:{}", min_user, max_user)
            .expect("23 bytes is enough for two i32 and colon");
        Self(s.finish())
    }

    /// Only returns None, if the string from database is malformed
    pub fn users(&self) -> Option<(i32, i32)> {
        let parts: (&str, &str) = self.0.as_str_unchecked().split_once(':')?;
        let user1 = parts.0.parse::<i32>().ok()?;
        let user2 = parts.1.parse::<i32>().ok()?;
        Some((user1, user2))
    }
}

#[apply(NewInsertable!)]
#[derive(Queryable, Selectable, ToSchema, Debug, Clone, Serialize)]
#[diesel(table_name = crate::schema::chat_rooms)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ChatRoom {
    pub id: i32,
    pub name: Option<Chatname>,
    pub chat_type: ChatRoomType,
    #[serde(skip)]
    pub dm_key: Option<DmKey>,
    created_at: NaiveDateTime,
}

impl ChatRoom {
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at.and_utc()
    }
}

impl NewChatRoom {
    pub fn new_dm(users: (i32, i32), created_at: DateTime<Utc>) -> Self {
        Self {
            name: None,
            chat_type: ChatRoomType::Dm,
            dm_key: Some(DmKey::new(users)),
            created_at: created_at.naive_utc(),
        }
    }
}

#[derive(
    Queryable, Selectable, Insertable, Associations, Debug, Clone, Serialize,
)]
#[diesel(table_name = crate::schema::chat_members)]
#[diesel(belongs_to(User))]
#[diesel(belongs_to(ChatRoom, foreign_key = room_id))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ChatMember {
    #[serde(skip)]
    pub room_id: i32,
    pub user_id: i32,
    pub is_admin: bool,
    pub last_read_message_id: Option<i32>,
    joined_at: NaiveDateTime,
}

impl ChatMember {
    pub fn joined_at(&self) -> DateTime<Utc> {
        self.joined_at.and_utc()
    }

    pub fn new(
        room_id: i32,
        user_id: i32,
        is_admin: bool,
        joined_at: DateTime<Utc>,
    ) -> Self {
        Self {
            room_id,
            user_id,
            is_admin,
            last_read_message_id: None,
            joined_at: joined_at.naive_utc(),
        }
    }
}

#[derive(
    Queryable, Selectable, Insertable, Associations, Debug, Clone, Serialize,
)]
#[diesel(table_name = crate::schema::chat_invitations)]
#[diesel(belongs_to(User))]
#[diesel(belongs_to(ChatRoom, foreign_key = room_id))]
#[diesel(belongs_to(User, foreign_key = actor_id))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ChatInvitation {
    #[serde(skip)]
    pub room_id: i32,
    pub user_id: i32,
    /// user who created the invitation
    pub actor_id: Option<i32>,
    created_at: NaiveDateTime,
}

impl ChatInvitation {
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at.and_utc()
    }

    pub fn new(
        room_id: i32,
        user_id: i32,
        actor_id: i32,
        created_at: DateTime<Utc>,
    ) -> Self {
        Self {
            room_id,
            user_id,
            actor_id: Some(actor_id),
            created_at: created_at.naive_utc(),
        }
    }
}

#[derive(Queryable, Selectable, Associations, Debug, Clone, Serialize)]
#[diesel(table_name = crate::schema::chat_messages)]
#[diesel(belongs_to(User, foreign_key = sender_id))]
#[diesel(belongs_to(ChatRoom, foreign_key = room_id))]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ChatMessage {
    // using ULID for sortable unique IDs that dont need to be created by the database
    // i.e. for in-memory message stores
    pub id: SqlUlid,
    // #[serde(skip)]
    pub room_id: i32,
    pub sender_id: i32,
    pub content: String,
    created_at: NaiveDateTime,
}

impl ChatMessage {
    pub fn created_at(&self) -> DateTime<Utc> {
        self.created_at.and_utc()
    }

    pub fn new(
        room_id: i32,
        sender_id: i32,
        content: String,
        created_at: DateTime<Utc>,
    ) -> Self {
        let id = Ulid::from_datetime(created_at.into()).into();
        Self {
            id,
            room_id,
            sender_id,
            content,
            created_at: created_at.naive_utc(),
        }
    }
}
