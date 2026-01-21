use chrono::{DateTime, NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel_autoincrement_new_struct::{NewInsertable, apply};
use salvo::oapi::ToSchema;
use serde::Serialize;

use crate::auth::session_token::SessionTokenHash;

macro_rules! diesel_i32_enum {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $($variant:ident),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(
            Debug,
            Clone,
            Copy,
            PartialEq,
            Eq,
            diesel::expression::AsExpression,
            diesel::deserialize::FromSqlRow,
            salvo::oapi::ToSchema,
            strum::FromRepr,
        )]
        #[diesel(sql_type = diesel::sql_types::Integer)]
        #[repr(i32)]
        $vis enum $name {
            $($variant),+
        }

        impl
            diesel::serialize::ToSql<diesel::sql_types::Integer, diesel::sqlite::Sqlite>
            for $name
        where
            i32: diesel::serialize::ToSql<
                    diesel::sql_types::Integer,
                    diesel::sqlite::Sqlite,
                >,
        {
            fn to_sql<'b>(
                &'b self,
                out: &mut diesel::serialize::Output<'b, '_, diesel::sqlite::Sqlite>,
            ) -> diesel::serialize::Result {
                out.set_value(*self as i32);
                Ok(diesel::serialize::IsNull::No)
            }
        }

        impl<DB> diesel::deserialize::FromSql<diesel::sql_types::Integer, DB>
            for $name
        where
            DB: diesel::backend::Backend,
            i32: diesel::deserialize::FromSql<diesel::sql_types::Integer, DB>,
        {
            fn from_sql(bytes: DB::RawValue<'_>) -> diesel::deserialize::Result<Self> {
                match $name::from_repr(i32::from_sql(bytes)?) {
                    Some(ty) => Ok(ty),
                    None => Err("Unrecognized enum variant".into()),
                }
            }
        }
    };
}

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
