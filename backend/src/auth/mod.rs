use std::{sync::LazyLock, time::Duration};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

mod hoops;
mod router;
pub mod session_token;
mod two_factor;
mod user;
mod util;

pub use hoops::{AuthError, DepotAuthExt, RouterAuthExt, device_id_inserter_hoop};
pub use router::router;
pub use two_factor::TwoFactorError;
pub use user::router as user_router;
#[cfg(test)]
pub use user::{SessionInfo, TwoFaConfirmOutput, TwoFaStartOutput, UserSessionInfo};

#[cfg(test)]
mod tests;

use crate::models::Session;

pub const JWT_COOKIE_NAME: &str = "access_token";
pub const SESSION_COOKIE_NAME: &str = "session_token";
/// tied to `session.last_authenticated_at`
pub const SESSION_LOGIN_EXPIRY: Duration = Duration::from_hours(30 * 24);
/// tied to `session.refreshed_at`
pub const SESSION_LOGIN_EXPIRY_ROLLING: Duration = Duration::from_hours(7 * 24);
/// tied to `session.refreshed_at`
pub const SESSION_ACCESS_EXPIRY: Duration = Duration::from_mins(15);

/// Maximum number of sessions to keep per user.
///
/// When a new session is created, older sessions are pruned down to this limit.
const MAX_SESSIONS_PER_USER: i64 = 10;

/// How long the browser should keep the refresh-token cookie.
///
/// Server-side rules (rolling expiry / forced reauth) still apply; this just
/// allows reactivation of long-lived sessions at a later time.
const SESSION_COOKIE_MAX_AGE: Duration = Duration::from_secs(60 * 60 * 24 * 365 * 10);

/// Dont care about old JWT tokens when server restarts,
/// clients can just refresh their access tokens.
static JWT_SECRET: LazyLock<[u8; 32]> = LazyLock::new(rand::random);

static JWT_ENCODING_KEY: LazyLock<jsonwebtoken::EncodingKey> =
    LazyLock::new(|| jsonwebtoken::EncodingKey::from_secret(JWT_SECRET.as_slice()));

static JWT_DECODING_KEY: LazyLock<jsonwebtoken::DecodingKey> =
    LazyLock::new(|| jsonwebtoken::DecodingKey::from_secret(JWT_SECRET.as_slice()));

static JWT_VALIDATION: LazyLock<jsonwebtoken::Validation> =
    LazyLock::new(jsonwebtoken::Validation::default);

fn jwt_encoding_key() -> &'static jsonwebtoken::EncodingKey {
    &JWT_ENCODING_KEY
}

fn jwt_decoding_key() -> &'static jsonwebtoken::DecodingKey {
    &JWT_DECODING_KEY
}

fn jwt_validation() -> &'static jsonwebtoken::Validation {
    &JWT_VALIDATION
}

#[derive(Debug, Serialize, Deserialize)]
struct JwtClaims {
    pub sub: i32,
    pub sid: i32,
    pub jti: session_token::SessionTokenHashTruncated,
    pub exp: usize,
    pub iat: usize,
    /// `tos_accepted_at` as a unix timestamp, or `None` if never accepted.
    pub tos: Option<i64>,
}

impl Session {
    // This includes any form of expiry which can happen to this session
    pub fn access_expiry(&self) -> DateTime<Utc> {
        (self.refreshed_at + SESSION_ACCESS_EXPIRY).min(self.login_expiry())
    }

    pub fn login_expiry(&self) -> DateTime<Utc> {
        (self.refreshed_at + SESSION_LOGIN_EXPIRY_ROLLING)
            .min(self.last_authenticated_at + SESSION_LOGIN_EXPIRY)
    }
}
