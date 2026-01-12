use std::collections::HashSet;

use super::two_factor;
use super::util;
use crate::auth::TwoFactorError;
use crate::auth::router::PasswordInput;
use crate::models::{Session, User};
use crate::prelude::*;
use crate::stream::StreamManager;

pub fn router(path: &str) -> Router {
    Router::with_path(path)
        .oapi_tag("user")
        .requires_user_login()
        .user_rate_limit(&RateLimit::per_minute(15))
        .append(&mut vec![
            Router::with_path("me").get(get_me),
            Router::with_path("2fa")
                .push(Router::with_path("start").post(two_fa_start))
                .push(Router::with_path("confirm").post(two_fa_confirm))
                .push(Router::with_path("disable").post(two_fa_disable)),
            Router::with_path("change-password")
                .user_rate_limit(&RateLimit::per_15_minutes(10))
                .post(change_pw),
            Router::with_path("logout").post(logout),
            Router::with_path("logout-sessions").post(logout_sessions),
            Router::with_path("logout-other-sessions")
                .post(logout_other_sessions),
            Router::with_path("session").get(current_session),
            Router::with_path("sessions")
                .post(all_sessions)
                .delete(delete_sessions),
        ])
}

#[derive(Debug, Serialize, ToSchema)]
pub struct UserSessionInfo {
    pub user: User,
    pub session: SessionInfo,
}

impl UserSessionInfo {
    pub fn new(user: User, session: Session) -> Self {
        Self {
            user,
            session: SessionInfo::from(session),
        }
    }

    pub fn from_session(
        conn: &mut db::DbConn,
        session: Session,
    ) -> AppResult<Self> {
        use crate::schema::users::dsl::*;
        let user: User = users.filter(id.eq(session.user_id)).first(conn)?;

        Ok(Self {
            user,
            session: SessionInfo::from(session),
        })
    }
}

/// Retrieve the current User info
#[endpoint]
fn get_me(depot: &mut Depot) -> JsonResult<UserSessionInfo> {
    let conn = &mut db::get()?;
    let session = depot.session();

    json_ok(UserSessionInfo::from_session(conn, session.to_owned())?)
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
struct ChangePasswordInput {
    password: String,
    #[serde(default)]
    mfa_code: Option<String>,
    #[validate(custom(function = "crate::validate::password"))]
    new_password: String,
    #[serde(default)]
    keep_other_sessions_logged_in: bool,
}

/// Change password for the current User
///
/// Requires current password for verification.
/// Optionally forces reauthentication on all other Sessions.
#[endpoint]
fn change_pw(
    json: JsonBody<ChangePasswordInput>,
    depot: &mut Depot,
) -> JsonResult<()> {
    let conn = &mut db::get()?;
    let session = depot.session();
    let ChangePasswordInput {
        password,
        mfa_code,
        new_password,
        keep_other_sessions_logged_in,
    } = {
        let input = json.into_inner();
        input.validate()?;
        input
    };
    util::check_password_and_mfa_if_enabled(
        session.user_id,
        &password,
        mfa_code.as_deref(),
        conn,
    )?;
    let new_hash = util::hash_password(&new_password)?;

    conn.transaction::<_, ApiError, _>(|conn| {
        use crate::schema::users::dsl::*;

        diesel::update(users.find(session.user_id))
            .set(password_hash.eq(&new_hash))
            .execute(conn)?;

        if !keep_other_sessions_logged_in {
            deauth_other_sessions(conn, session.user_id, session.id)?;
        }
        Ok(())
    })?;

    json_ok(())
}

/// Logout the current Session
#[endpoint]
fn logout(depot: &mut Depot, res: &mut Response) -> JsonResult<()> {
    let conn = &mut db::get()?;
    let session = depot.session();
    deauth_sessions(conn, session.user_id, &[session.id])?;
    delete_auth_cookies(res);
    json_ok(())
}

#[derive(Debug, Deserialize, ToSchema)]
struct SessionsInput {
    password: String,
    #[serde(default)]
    mfa_code: Option<String>,
    session_ids: HashSet<i32>,
}

/// Logout the specified Sessions for the current User
///
/// Requires current password for verification.
#[endpoint]
fn logout_sessions(
    json: JsonBody<SessionsInput>,
    depot: &mut Depot,
    res: &mut Response,
) -> JsonResult<()> {
    let conn = &mut db::get()?;
    let session = depot.session();
    let SessionsInput {
        password,
        mfa_code,
        session_ids,
    } = json.into_inner();
    util::check_password_and_mfa_if_enabled(
        session.user_id,
        &password,
        mfa_code.as_deref(),
        conn,
    )?;

    deauth_sessions(
        conn,
        session.user_id,
        &session_ids.iter().copied().collect::<Vec<_>>(),
    )?;

    if session_ids.contains(&session.id) {
        delete_auth_cookies(res);
        Err(super::AuthError::DidLogout.into())
    } else {
        json_ok(())
    }
}

/// Logout all other Sessions for the current User
///
/// Requires current password for verification.
#[endpoint]
fn logout_other_sessions(
    json: JsonBody<PasswordInput>,
    depot: &mut Depot,
) -> JsonResult<()> {
    let conn = &mut db::get()?;
    let session = depot.session();
    let PasswordInput { password, mfa_code } = json.into_inner();
    util::check_password_and_mfa_if_enabled(
        session.user_id,
        &password,
        mfa_code.as_deref(),
        conn,
    )?;

    deauth_other_sessions(conn, session.user_id, session.id)?;
    json_ok(())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SessionInfo {
    pub session_id: i32,
    pub user_id: i32,
    pub device_name: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: chrono::NaiveDateTime,
    pub last_used_at: chrono::NaiveDateTime,
    pub access_expiry: chrono::NaiveDateTime,
    pub login_expiry: chrono::NaiveDateTime,
}

impl From<&Session> for SessionInfo {
    fn from(session: &Session) -> Self {
        SessionInfo {
            session_id: session.id,
            user_id: session.user_id,
            device_name: session.device_name.clone(),
            ip_address: session.ip_address.clone(),
            created_at: session.created_at().naive_utc(),
            last_used_at: session.last_used_at().naive_utc(),
            access_expiry: session.access_expiry().naive_utc(),
            login_expiry: session.login_expiry().naive_utc(),
        }
    }
}

impl From<Session> for SessionInfo {
    fn from(session: Session) -> Self {
        (&session).into()
    }
}

/// Retrieve the current Session info
#[endpoint]
pub fn current_session(depot: &mut Depot) -> JsonResult<SessionInfo> {
    let session = depot.session();
    json_ok(SessionInfo::from(session))
}

/// Retrieve all Sessions for the current User
///
/// Requires current password for verification.
#[endpoint]
pub fn all_sessions(
    json: JsonBody<PasswordInput>,
    depot: &mut Depot,
) -> JsonResult<Vec<SessionInfo>> {
    use crate::schema::sessions::dsl::*;

    let conn = &mut db::get()?;
    let session = depot.session();
    let PasswordInput { password, mfa_code } = json.into_inner();
    util::check_password_and_mfa_if_enabled(
        session.user_id,
        &password,
        mfa_code.as_deref(),
        conn,
    )?;

    let user_sessions: Vec<Session> =
        sessions.filter(user_id.eq(session.user_id)).load(conn)?;

    json_ok(user_sessions.into_iter().map(Into::into).collect())
}

/// Delete specific Sessions for the current User
///
/// Requires current password for verification.
#[endpoint]
fn delete_sessions(
    json: JsonBody<SessionsInput>,
    depot: &mut Depot,
    res: &mut Response,
) -> JsonResult<()> {
    use crate::schema::sessions::dsl::*;

    let conn = &mut db::get()?;
    let session = depot.session();
    let SessionsInput {
        password,
        mfa_code,
        session_ids,
    } = json.into_inner();
    util::check_password_and_mfa_if_enabled(
        session.user_id,
        &password,
        mfa_code.as_deref(),
        conn,
    )?;

    diesel::delete(
        sessions
            .filter(user_id.eq(session.user_id))
            .filter(id.eq_any(&session_ids)),
    )
    .execute(conn)?;

    // short-circuiting to avoid iterating all sessions,
    // as there can be at maximum only one session where closing a stream returns true.
    session_ids.iter().any(|session_id| {
        StreamManager::global().close_stream(session.user_id, Some(*session_id))
    });

    if session_ids.contains(&session.id) {
        delete_auth_cookies(res);
        Err(super::AuthError::DidLogout.into())
    } else {
        json_ok(())
    }
}

fn delete_auth_cookies(res: &mut Response) {
    res.remove_cookie(super::SESSION_COOKIE_NAME);
    res.remove_cookie(super::JWT_COOKIE_NAME);
}

fn deauth_other_sessions(
    conn: &mut db::DbConn,
    target_user: i32,
    current_session_id: i32,
) -> AppResult<usize> {
    use crate::schema::sessions::dsl::*;

    let other_sessions: Vec<i32> = sessions
        .filter(user_id.eq(target_user))
        .filter(id.ne(current_session_id))
        .select(id)
        .load::<i32>(conn)?;

    deauth_sessions(conn, target_user, &other_sessions)
}

fn deauth_sessions(
    conn: &mut db::DbConn,
    target_user: i32,
    session_ids: &[i32],
) -> AppResult<usize> {
    use crate::schema::sessions::dsl::*;
    let epoch = chrono::DateTime::UNIX_EPOCH.naive_utc();
    let result = diesel::update(
        sessions
            .filter(user_id.eq(target_user))
            .filter(id.eq_any(session_ids)),
    )
    .set(last_authenticated_at.eq(epoch))
    .execute(conn)?;

    // short-circuiting to avoid iterating all sessions,
    // as there can be at maximum only one session where closing a stream returns true.
    session_ids.iter().any(|session_id| {
        StreamManager::global().close_stream(target_user, Some(*session_id))
    });

    Ok(result)
}

#[derive(Debug, Deserialize, ToSchema)]
struct TwoFaStartInput {
    password: String,
}

#[derive(Debug, Serialize, ToSchema)]
struct TwoFaStartOutput {
    /// The raw base32-encoded TOTP secret for users to be manually added to authenticator apps
    base32_secret: String,
    /// The otpauth URL for the TOTP secret for integration with authenticator apps
    url: String,
    /// A base64-encoded PNG QR code representing the otpauth URL
    qr_base64: String,
}

/// Start 2FA enrollment for the current user
#[endpoint]
fn two_fa_start(
    json: JsonBody<TwoFaStartInput>,
    depot: &mut Depot,
) -> JsonResult<TwoFaStartOutput> {
    use crate::schema::users::dsl::*;

    let conn = &mut db::get()?;
    let session = depot.session();
    let TwoFaStartInput { password } = json.into_inner();

    let user: User = util::check_password(session.user_id, &password, conn)?;
    if user.totp_enabled {
        return Err(ApiError::TwoFa(TwoFactorError::AlreadyEnabled));
    }

    let secret_raw = two_factor::generate_totp_secret()
        .to_bytes()
        .expect("Generated secret in bytes");

    let totp = two_factor::totp_for_user(&user, secret_raw.clone());
    let base32_secret = totp.get_secret_base32();
    let url = totp.get_url();
    let qr_base64 = totp.get_qr_base64().map_err(|err| {
        ApiError::TwoFa(TwoFactorError::Internal(format!(
            "Failed to generate QR code: {}",
            err
        )))
    })?;

    let secret_enc = two_factor::encrypt_totp_secret(user.id, &secret_raw)?;
    // we dont filter for totp_secret_enc.eq(None) here to allow users to restart the process even when
    // they already started the process once before, but didnt complete it
    let updated = diesel::update(
        users.filter(id.eq(user.id)).filter(totp_enabled.eq(false)),
    )
    .set((
        totp_secret_enc.eq(Some(secret_enc)),
        totp_confirmed_at.eq::<Option<chrono::NaiveDateTime>>(None),
    ))
    .execute(conn)?;

    if updated == 0 {
        return Err(ApiError::TwoFa(TwoFactorError::AlreadyEnabled));
    }

    json_ok(TwoFaStartOutput {
        base32_secret,
        url,
        qr_base64,
    })
}

#[derive(Debug, Deserialize, ToSchema)]
struct TwoFaConfirmInput {
    password: String,
    code: String,
}

#[derive(Debug, Serialize, ToSchema)]
struct TwoFaConfirmOutput {
    recovery_codes: Vec<String>,
}

/// Confirm 2FA enrollment and generate recovery codes
///
/// Recovery codes are returned once and cannot be retrieved later.
#[endpoint]
fn two_fa_confirm(
    json: JsonBody<TwoFaConfirmInput>,
    depot: &mut Depot,
) -> JsonResult<TwoFaConfirmOutput> {
    use crate::schema::users::dsl::*;

    let conn = &mut db::get()?;
    let session = depot.session();
    let TwoFaConfirmInput { password, code } = json.into_inner();

    let user: User = util::check_password(session.user_id, &password, conn)?;
    if user.totp_enabled {
        return Err(ApiError::TwoFa(TwoFactorError::AlreadyEnabled));
    }

    let secret_enc = user
        .totp_secret_enc
        .as_deref()
        .ok_or(ApiError::TwoFa(TwoFactorError::NotStarted))?;

    let secret_raw = two_factor::decrypt_totp_secret(user.id, secret_enc)?;
    let totp = two_factor::totp_for_user(&user, secret_raw);
    let ok = totp.check_current(&code).map_err(|err| {
        ApiError::TwoFa(TwoFactorError::Internal(format!(
            "Failed to validate TOTP code (Time went backwards): {}",
            err
        )))
    })?;

    if !ok {
        return Err(super::AuthError::TwoFactorInvalid.into());
    }

    let recovery_codes = conn.transaction::<_, ApiError, _>(|conn| {
        let now = chrono::Utc::now().naive_utc();
        let updated = diesel::update(
            users
                .filter(id.eq(user.id))
                .filter(totp_enabled.eq(false))
                .filter(totp_secret_enc.eq(&user.totp_secret_enc)),
        )
        .set((totp_enabled.eq(true), totp_confirmed_at.eq(Some(now))))
        .execute(conn)?;

        if updated == 0 {
            return Err(ApiError::TwoFa(
                TwoFactorError::ConcurrentRequestRaced,
            ));
        }

        let recovery_codes = two_factor::generate_recovery_codes();
        two_factor::replace_recovery_codes(conn, user.id, &recovery_codes)?;

        Ok(recovery_codes)
    })?;

    json_ok(TwoFaConfirmOutput { recovery_codes })
}

#[derive(Debug, Deserialize, ToSchema)]
struct TwoFaDisableInput {
    password: String,
    mfa_code: String,
}

/// Disable 2FA for the current user.
///
/// Requires password + either a TOTP code or a recovery code.
#[endpoint]
fn two_fa_disable(
    json: JsonBody<TwoFaDisableInput>,
    depot: &mut Depot,
) -> JsonResult<()> {
    use crate::schema::two_fa_recovery_codes::dsl as recovery_dsl;
    use crate::schema::users::dsl::*;

    let conn = &mut db::get()?;
    let session = depot.session();
    let TwoFaDisableInput { password, mfa_code } = json.into_inner();

    let user = util::check_password_and_mfa_if_enabled(
        session.user_id,
        &password,
        Some(mfa_code.as_str()),
        conn,
    )?;

    if !user.totp_enabled {
        return Err(ApiError::TwoFa(TwoFactorError::NotEnabled));
    }

    conn.transaction::<_, ApiError, _>(|conn| {
        let updates = diesel::update(
            users
                .filter(id.eq(user.id))
                .filter(totp_secret_enc.eq(&user.totp_secret_enc)),
        )
        .set((
            totp_enabled.eq(false),
            totp_secret_enc.eq::<Option<String>>(None),
            totp_confirmed_at.eq::<Option<chrono::NaiveDateTime>>(None),
        ))
        .execute(conn)?;

        if updates == 0 {
            return Err(ApiError::TwoFa(
                TwoFactorError::ConcurrentRequestRaced,
            ));
        }

        diesel::delete(
            recovery_dsl::two_fa_recovery_codes
                .filter(recovery_dsl::user_id.eq(user.id)),
        )
        .execute(conn)?;

        Ok(())
    })?;

    json_ok(())
}
