use std::sync::Arc;

use diesel::OptionalExtension;

use crate::auth::hoops::set_session;
use crate::auth::session_token::{SessionToken, SessionTokenHash};
use crate::auth::user::{SessionInfo, UserSessionInfo};
use crate::auth::AuthError;
use crate::models::nickname::Nickname;
use crate::models::{NewSession, NewUser, Session, User};
use crate::prelude::*;
use crate::stream::StreamManager;

use super::util;

pub fn router(path: &str) -> Router {
    Router::with_path(path).oapi_tag("auth").append(&mut vec![
        Router::with_path("register")
            .ip_rate_limit(&RateLimit::per_5_minutes(10))
            .ip_rate_limit(&RateLimit::per_day(50))
            .post(register),
        Router::with_path("login")
            .ip_rate_limit(&RateLimit::per_minute(10))
            .post(login),
        // Session Cookie is limited to this path
        Router::with_path("session-management")
            .push(
                Router::with_path("reauth")
                    .hoop(session_allow_reauth_hoop)
                    .user_rate_limit(&RateLimit::per_15_minutes(10))
                    .post(reauth),
            )
            .push(
                Router::with_path("refresh-jwt")
                    .hoop(session_hoop)
                    .user_rate_limit(&RateLimit::per_5_minutes(10))
                    .post(refresh_jwt),
            )
            .push(
                Router::with_path("accept-tos")
                    .hoop(session_hoop)
                    .user_rate_limit(&RateLimit::per_15_minutes(5))
                    .post(accept_tos),
            ),
    ])
}

#[derive(Debug, Serialize, Deserialize, Validate, ToSchema)]
pub struct RegisterInput {
    #[validate(email(message = "Must be a valid email address."))]
    pub email: String,
    #[validate(custom(function = "crate::validate::password"))]
    pub password: String,
    #[validate(custom(function = "crate::validate::nickname"))]
    pub nickname: Nickname,
    /// Must be `true` to accept the Terms of Service.
    pub tos: bool,
}

/// Register a new User and create a new Session
#[endpoint]
async fn register(
    json: JsonBody<RegisterInput>,
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> JsonResult<UserSessionInfo> {
    let RegisterInput {
        email,
        password,
        nickname,
        tos: _,
    } = {
        let input = json.into_inner();
        input.validate()?;
        if !input.tos {
            let mut errors = validator::ValidationErrors::new();
            errors.add(
                "tos",
                validator::ValidationError::new("accepted").with_message(
                    std::borrow::Cow::Borrowed("Terms of Service must be accepted"),
                ),
            );
            return Err(ApiError::Validation(errors));
        }
        input
    };
    let new_user = NewUser::new(email, nickname, util::hash_password(&password)?);
    let (device_name, ip_address) = util::get_device_and_ip(req);
    let device_id = depot.device_id().to_owned();
    let token = SessionToken::generate();
    let token_hash_value = token.to_hash();
    let token_truncated = token_hash_value.to_truncated();

    // FIXME (not planned yet) account email enumeration vulnerability (need email confirmation flow)
    let (user, session) = db
        .write(move |conn| {
            use crate::schema::users::dsl::*;
            let user: User = diesel::insert_into(users)
                .values(&new_user)
                .get_result(conn)?;

            let session = create_session(
                conn,
                user.id,
                &device_id,
                device_name,
                ip_address,
                token_hash_value,
            )?;

            Ok::<_, ApiError>((user, session))
        })
        .await??;

    let jwt = util::jwt_create(&session, token_truncated, user.tos_accepted_at)?;
    depot.nickname_cache().add(user.id, user.nickname);
    set_auth_cookies(res, token, jwt);
    json_ok(UserSessionInfo::new(user, session))
}

#[derive(Debug, Serialize, Deserialize, Validate, ToSchema)]
pub struct LoginInput {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub mfa_code: Option<String>,
}

/// Login a User and create a new Session
///
/// We will try to find a session to reauth for the user with the matching `device_id`.
/// Otherwise, a new session will be created.
#[endpoint]
async fn login(
    json: JsonBody<LoginInput>,
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> JsonResult<UserSessionInfo> {
    use crate::schema::sessions::dsl::*;

    let LoginInput {
        email,
        password,
        mfa_code,
    } = json.into_inner();
    let (device_name_value, ip_address_value) = util::get_device_and_ip(req);
    let device_id_value = depot.device_id().to_owned();
    let token = SessionToken::generate();
    let token_hash_value = token.to_hash();
    let token_truncated = token_hash_value.to_truncated();
    let streams = depot.stream_manager().clone();

    let (user, session) = db
        .write(move |conn| {
            let user = util::get_user_by_credentials(&email, &password, conn)?;

            super::two_factor::require_mfa_if_enabled(conn, &user, mfa_code.as_deref())?;

            let session = match sessions
                .filter(user_id.eq(user.id))
                .filter(device_id.eq(&device_id_value))
                .first(conn)
                .optional()
            {
                Ok(Some(session)) => rotate_session::<true>(
                    conn,
                    &streams,
                    &session,
                    &device_id_value,
                    device_name_value,
                    ip_address_value,
                    token_hash_value,
                )?,
                Ok(None) => create_session(
                    conn,
                    user.id,
                    &device_id_value,
                    device_name_value,
                    ip_address_value,
                    token_hash_value,
                )?,
                Err(err) => return Err(err.into()),
            };

            Ok::<_, ApiError>((user, session))
        })
        .await??;

    let jwt = util::jwt_create(&session, token_truncated, user.tos_accepted_at)?;
    set_auth_cookies(res, token, jwt);
    json_ok(UserSessionInfo::new(user, session))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PasswordInput {
    pub password: String,
    #[serde(default)]
    pub mfa_code: Option<String>,
}

/// Reauthenticate the current Session.
///
/// Requires current password for verification.
#[endpoint(
    security(("reauth_session" = []))
)]
async fn reauth(
    json: JsonBody<PasswordInput>,
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> JsonResult<UserSessionInfo> {
    let session = depot.session();
    let PasswordInput { password, mfa_code } = json.into_inner();
    let (device_name_value, ip_address_value) = util::get_device_and_ip(req);
    let device_id_value = depot.device_id().to_owned();
    let token = SessionToken::generate();
    let token_hash_value = token.to_hash();
    let token_truncated = token_hash_value.to_truncated();
    let session = session.clone();
    let streams = depot.stream_manager().clone();

    let (session, tos_accepted_at) = db
        .write(move |conn| {
            let user = util::check_password_and_mfa_if_enabled(
                session.user_id,
                &password,
                mfa_code.as_deref(),
                conn,
            )?;

            let rotated = rotate_session::<true>(
                conn,
                &streams,
                &session,
                &device_id_value,
                device_name_value,
                ip_address_value,
                token_hash_value,
            )?;
            Ok::<_, ApiError>((rotated, user.tos_accepted_at))
        })
        .await??;

    let jwt = util::jwt_create(&session, token_truncated, tos_accepted_at)?;
    set_auth_cookies(res, token, jwt);
    let user_session = db
        .read(move |conn| UserSessionInfo::from_session(conn, session))
        .await??;

    json_ok(user_session)
}

/// Refresh JWT access token for the current Session
#[endpoint(
    security(("session" = []))
)]
async fn refresh_jwt(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> JsonResult<SessionInfo> {
    let session = depot.session();
    let (device_name_value, ip_address_value) = util::get_device_and_ip(req);
    let device_id_value = depot.device_id().to_owned();
    let token = SessionToken::generate();
    let token_hash_value = token.to_hash();
    let token_truncated = token_hash_value.to_truncated();
    let session = session.clone();
    let streams = depot.stream_manager().clone();

    let (session, tos_accepted_at) = db
        .write(move |conn| {
            use crate::schema::users::dsl as users_dsl;
            let tos: Option<chrono::DateTime<chrono::Utc>> = users_dsl::users
                .filter(users_dsl::id.eq(session.user_id))
                .select(users_dsl::tos_accepted_at)
                .first(conn)?;

            let rotated = rotate_session::<false>(
                conn,
                &streams,
                &session,
                &device_id_value,
                device_name_value,
                ip_address_value,
                token_hash_value,
            )?;
            Ok::<_, ApiError>((rotated, tos))
        })
        .await??;

    let jwt = util::jwt_create(&session, token_truncated, tos_accepted_at)?;
    set_auth_cookies(res, token, jwt);
    json_ok(session.into())
}

/// Accept the current Terms of Service and issue a fresh JWT.
///
/// Behaves like `refresh_jwt` but also sets `tos_accepted_at` on the user.
#[endpoint(
    security(("session" = []))
)]
async fn accept_tos(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> JsonResult<SessionInfo> {
    let session = depot.session();
    let (device_name_value, ip_address_value) = util::get_device_and_ip(req);
    let device_id_value = depot.device_id().to_owned();
    let token = SessionToken::generate();
    let token_hash_value = token.to_hash();
    let token_truncated = token_hash_value.to_truncated();
    let session = session.clone();
    let streams = depot.stream_manager().clone();

    let (session, tos_accepted_at) = db
        .write(move |conn| {
            use crate::schema::users::dsl as users_dsl;

            let now = chrono::Utc::now();
            diesel::update(users_dsl::users.find(session.user_id))
                .set(users_dsl::tos_accepted_at.eq(Some(now)))
                .execute(conn)?;

            let rotated = rotate_session::<false>(
                conn,
                &streams,
                &session,
                &device_id_value,
                device_name_value,
                ip_address_value,
                token_hash_value,
            )?;
            Ok::<_, ApiError>((rotated, Some(now)))
        })
        .await??;

    let jwt = util::jwt_create(&session, token_truncated, tos_accepted_at)?;
    set_auth_cookies(res, token, jwt);
    json_ok(session.into())
}

fn set_auth_cookies(res: &mut Response, token: SessionToken, jwt: String) {
    res.add_cookie(util::session_cookie(token));
    res.add_cookie(util::jwt_cookie(jwt));
}

fn rotate_session<const DO_REAUTH: bool>(
    conn: &mut DbConn,
    streams: &Arc<StreamManager>,
    session: &Session,
    device_id: &str,
    device_name: Option<String>,
    ip_address: Option<String>,
    token_hash: SessionTokenHash,
) -> AppResult<Session> {
    use crate::schema::sessions::dsl as sessions_dsl;

    let rotated =
        session.rotate::<DO_REAUTH>(token_hash, device_id.to_owned(), device_name, ip_address);

    let updated = diesel::update(
        sessions_dsl::sessions
            .filter(sessions_dsl::id.eq(session.id))
            .filter(sessions_dsl::token_hash.eq(session.token_hash)),
    )
    .set(&rotated)
    .execute(conn)?;

    // If the session was rotated concurrently, do not issue cookies for a token
    // that is not stored in the DB anymore.
    if updated != 1 {
        return Err(AuthError::SessionMismatch.into());
    }

    streams.refresh_auth(&rotated);
    Ok(rotated)
}

fn create_session(
    conn: &mut DbConn,
    user_id: i32,
    device_id: &str,
    device_name: Option<String>,
    ip_address: Option<String>,
    token_hash: SessionTokenHash,
) -> AppResult<Session> {
    use crate::schema::sessions::dsl::sessions;
    let new_session = NewSession::new(
        user_id,
        token_hash,
        device_id.to_owned(),
        device_name,
        ip_address,
    );

    let session: Session = diesel::insert_into(sessions)
        .values(&new_session)
        .get_result(conn)?;

    if let Err(err) = util::prune_excess_sessions(conn, user_id, Some(session.id)) {
        tracing::error!(%err, user_id, "Failed to prune excess sessions after creating a new session");
    }

    Ok(session)
}

pub(super) async fn session_hoop_inner<const NO_PENDING_REAUTH: bool>(
    req: &Request,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> Result<(), ApiError> {
    use crate::schema::sessions::dsl::*;
    let session_token = SessionToken::try_from(
        req.cookie(super::SESSION_COOKIE_NAME)
            .ok_or(AuthError::MissingSessionCookie)?
            .value(),
    )
    .map_err(|_| AuthError::InvalidSessionToken)?;

    let token_hash_value = session_token.to_hash();
    let session: Session = db
        .read(move |conn| sessions.filter(token_hash.eq(token_hash_value)).first(conn))
        .await?
        .map_err(|_| AuthError::SessionNotFound)?;

    if NO_PENDING_REAUTH && session.login_expiry() < chrono::Utc::now() {
        return Err(AuthError::NeedReauth.into());
    }
    set_session(depot, session);
    res.add_cookie(super::util::device_id_cookie(depot));
    Ok(())
}

/// Load a Session from the session cookie, enforcing reauth requirements.
///
/// If the session requires reauth, an error is returned.
/// Only to be used by the auth module
#[handler]
pub async fn session_hoop(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    ctrl: &mut FlowCtrl,
    db: Db,
) {
    if let Err(err) = session_hoop_inner::<true>(req, depot, res, db).await {
        err.render(res);
        ctrl.skip_rest();
    }
}

/// Load a Session from the session cookie without enforcing reauth requirements.
///
/// This is used for endpoints that *perform* reauthentication (or credentialed
/// operations like change-password) and should remain reachable even when the
/// session is currently in a "needs reauth" state.
/// Only to be used by the auth module
#[handler]
async fn session_allow_reauth_hoop(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    ctrl: &mut FlowCtrl,
    db: Db,
) {
    if let Err(err) = session_hoop_inner::<false>(req, depot, res, db).await {
        err.render(res);
        ctrl.skip_rest();
    }
}
