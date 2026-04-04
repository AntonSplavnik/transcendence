use std::{borrow::Cow, sync::LazyLock};

use argon2::password_hash::{self, SaltString, rand_core::OsRng};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use cookie::Cookie;

use crate::auth::session_token::{SessionToken, SessionTokenHashTruncated};
use crate::auth::{JwtClaims, jwt_encoding_key};
use crate::models::{Session, User};
use crate::prelude::*;

use super::SESSION_ACCESS_EXPIRY;
use super::two_factor;

pub fn prune_excess_sessions(
    conn: &mut DbConn,
    target_user_id: i32,
    keep_session_id: Option<i32>,
) -> AppResult<usize> {
    use crate::schema::sessions::dsl::*;

    // Keep newest sessions by last_used_at (and created_at as a tie-breaker).
    let mut session_ids: Vec<i32> = sessions
        .filter(user_id.eq(target_user_id))
        .order((last_used_at.desc(), created_at.desc()))
        .select(id)
        .load(conn)?;

    #[allow(clippy::cast_possible_truncation)] // MAX_SESSIONS_PER_USER is a small config constant (e.g. 10-20)
    let max_to_keep = super::MAX_SESSIONS_PER_USER as usize;

    // Ensure we never delete the explicitly kept session, and adjust how many
    // other sessions are allowed to remain.
    let allowed = if let Some(keep_id) = keep_session_id {
        session_ids.retain(|sid| *sid != keep_id);
        max_to_keep.saturating_sub(1)
    } else {
        max_to_keep
    };

    if session_ids.len() <= allowed {
        return Ok(0);
    }

    let to_delete: Vec<i32> = session_ids.into_iter().skip(allowed).collect();
    if to_delete.is_empty() {
        return Ok(0);
    }

    Ok(diesel::delete(sessions.filter(id.eq_any(to_delete))).execute(conn)?)
}

pub fn device_id_cookie(depot: &Depot) -> Cookie<'static> {
    cookie::Cookie::build(("device_id", depot.device_id().to_owned()))
        .path("/")
        .http_only(true)
        .secure(true)
        .same_site(cookie::SameSite::Lax)
        .max_age(cookie::time::Duration::seconds(
            crate::auth::SESSION_COOKIE_MAX_AGE.as_secs().cast_signed(),
        ))
        .build()
}

pub fn session_cookie(token: SessionToken) -> Cookie<'static> {
    Cookie::build((super::SESSION_COOKIE_NAME, token.encoded()))
        .path("/api/auth/session-management/")
        .http_only(true)
        .secure(true)
        .same_site(cookie::SameSite::Lax)
        .max_age(cookie::time::Duration::seconds(
            super::SESSION_COOKIE_MAX_AGE.as_secs().cast_signed(),
        ))
        .build()
}

pub fn jwt_cookie(token: impl Into<Cow<'static, str>>) -> Cookie<'static> {
    Cookie::build((super::JWT_COOKIE_NAME, token))
        .path("/api/")
        .http_only(true)
        .secure(true)
        .same_site(cookie::SameSite::Lax)
        .max_age(cookie::time::Duration::seconds(
            SESSION_ACCESS_EXPIRY.as_secs().cast_signed(),
        ))
        .build()
}

pub fn jwt_create(
    session: &Session,
    jti: SessionTokenHashTruncated,
    tos_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
) -> AppResult<String> {
    // JWT standard uses usize for exp/iat; timestamps are positive Unix seconds (after epoch)
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let exp = session.access_expiry().timestamp() as usize;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let iat = session.refreshed_at.timestamp() as usize;
    let claim = JwtClaims {
        sub: session.user_id,
        sid: session.id,
        jti,
        exp,
        iat,
        tos: tos_accepted_at.map(|ts| ts.timestamp()),
    };
    Ok(jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claim,
        jwt_encoding_key(),
    )?)
}

pub fn check_password(user_id: i32, password: &str, conn: &mut DbConn) -> AppResult<User> {
    use crate::schema::users::dsl::*;
    // constant time lookup and verification to prevent timing attacks
    let user = users
        .filter(id.eq(user_id))
        .first::<crate::models::User>(conn);
    verify_password(
        password,
        user.as_ref().ok().map(|user| user.password_hash.as_str()),
    )?;
    let user = user.expect("User must exist after successful password verification");
    Ok(user)
}

pub fn check_password_and_mfa_if_enabled(
    user_id_value: i32,
    password: &str,
    mfa_code: Option<&str>,
    conn: &mut DbConn,
) -> AppResult<User> {
    let user = check_password(user_id_value, password, conn)?;
    two_factor::require_mfa_if_enabled(conn, &user, mfa_code)?;
    Ok(user)
}

pub fn get_user_by_credentials(email: &str, password: &str, conn: &mut DbConn) -> AppResult<User> {
    use crate::schema::users::dsl as users_dsl;
    // constant time lookup and verification to prevent timing attacks
    // TODO (not planned yet) /register is not protected against timing attacks, because we dont have email-sending infrastructure
    let user = users_dsl::users
        .filter(users_dsl::email.eq(email))
        .first::<crate::models::User>(conn);
    verify_password(
        password,
        user.as_ref().ok().map(|user| user.password_hash.as_str()),
    )?;
    let user = user.expect("User must exist after successful password verification");
    Ok(user)
}

pub fn get_device_and_ip(req: &Request) -> (Option<String>, Option<String>) {
    let device = req
        .header::<&str>("User-Agent")
        .and_then(|ua| {
            woothee::parser::Parser::new()
                .parse(ua)
                .map(|info| format!("{} on {} ({})", info.name, info.os, info.category))
        });
    let ip = req
        .remote_addr()
        .to_owned()
        .into_std()
        .map(|addr| addr.ip().to_string());
    (device, ip)
}

static RANDOM_PASSWORD_HASH: LazyLock<String> = LazyLock::new(|| {
    hash_password("dummy password")
        .expect("Failed to generate dummy password hash")
        
});

static ARGON2: LazyLock<Argon2<'static>> = LazyLock::new(Argon2::default);

/// Constant-time password verification
pub fn verify_password(
    password: &str,
    password_hash: Option<&str>,
) -> Result<(), password_hash::Error> {
    let hash = PasswordHash::new(password_hash.unwrap_or(&RANDOM_PASSWORD_HASH))?;
    let res = ARGON2.verify_password(password.as_bytes(), &hash);
    match password_hash {
        Some(_) => res,
        None => Err(password_hash::Error::Password), // when no hash (user does not exist), always return Error::Password
    }
}

pub fn hash_password(password: &str) -> Result<String, password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    ARGON2
        .hash_password(password.as_bytes(), &salt)
        .map(|ph| ph.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_password_produces_valid_hash() {
        let hash = hash_password("test-password").unwrap();
        // Argon2 hashes start with "$argon2"
        assert!(
            hash.starts_with("$argon2"),
            "hash must be a valid Argon2 string: {hash}"
        );
    }

    #[test]
    fn hash_password_different_salts() {
        let h1 = hash_password("same-password").unwrap();
        let h2 = hash_password("same-password").unwrap();
        assert_ne!(
            h1, h2,
            "two hashes of the same password must differ (random salt)"
        );
    }

    #[test]
    fn verify_correct_password_succeeds() {
        let hash = hash_password("correct-password").unwrap();
        assert!(
            verify_password("correct-password", Some(&hash)).is_ok(),
            "correct password must verify"
        );
    }

    #[test]
    fn verify_wrong_password_fails() {
        let hash = hash_password("correct-password").unwrap();
        let result = verify_password("wrong-password", Some(&hash));
        assert!(result.is_err(), "wrong password must fail verification");
    }

    #[test]
    fn verify_no_hash_constant_time_rejection() {
        // When no hash exists (user not found), verify_password must still
        // return Error::Password (not a different error variant).
        let result = verify_password("any-password", None);
        assert!(result.is_err(), "None hash must fail");
        match result.unwrap_err() {
            password_hash::Error::Password => {} // expected
            err => panic!("expected Error::Password, got {err:?}"),
        }
    }

    #[test]
    fn hash_and_verify_roundtrip() {
        let pw = "roundtrip-password-123!@#";
        let hash = hash_password(pw).unwrap();
        assert!(verify_password(pw, Some(&hash)).is_ok());
    }
}
