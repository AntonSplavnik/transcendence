use diesel::OptionalExtension;

use crate::auth::AuthError;
use crate::auth::hoops::set_session;
use crate::auth::session_token::SessionToken;
use crate::auth::user::{SessionInfo, UserSessionInfo};
use crate::models::{NewSession, NewUser, Session, User};
use crate::prelude::*;

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
            ),
    ])
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
struct RegisterInput {
    #[validate(email(message = "Must be a valid email address."))]
    pub email: String,
    #[validate(custom(function = "crate::validate::password"))]
    pub password: String,
    #[validate(custom(function = "crate::validate::nickname"))]
    pub nickname: String,
}

/// Register a new User and create a new Session
#[endpoint]
fn register(
    json: JsonBody<RegisterInput>,
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
) -> JsonResult<UserSessionInfo> {
    let RegisterInput {
        email,
        password,
        nickname,
    } = {
        let input = json.into_inner();
        input.validate()?;
        input
    };
    let new_user =
        NewUser::new(email, nickname, util::hash_password(&password)?);
    let conn = &mut db::get()?;
    // FIXME (not planned yet) account email enumeration vulnerability (need email confirmation flow)
    let user: User = {
        use crate::schema::users::dsl::*;
        diesel::insert_into(users)
            .values(&new_user)
            .get_result(conn)?
    };

    let session = create_session(conn, user.id, req, depot, res)?;
    json_ok(UserSessionInfo::new(user, session))
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
struct LoginInput {
    email: String,
    password: String,
    #[serde(default)]
    mfa_code: Option<String>,
}

/// Login a User and create a new Session
///
/// We will try to find a session to reauth for the user with the matching device_id.
/// Otherwise, a new session will be created.
#[endpoint]
fn login(
    json: JsonBody<LoginInput>,
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
) -> JsonResult<UserSessionInfo> {
    use crate::schema::sessions::dsl::*;

    let conn = &mut db::get()?;
    let LoginInput {
        email,
        password,
        mfa_code,
    } = json.into_inner();
    let user = util::get_user_by_credentials(&email, &password, conn)?;

    super::two_factor::require_mfa_if_enabled(
        conn,
        &user,
        mfa_code.as_deref(),
    )?;

    let session = match sessions
        .filter(user_id.eq(user.id))
        .filter(device_id.eq(depot.device_id()))
        .first(conn)
        .optional()
    {
        Ok(Some(session)) => {
            rotate_session::<true>(conn, &session, req, depot, res)?
        }
        Ok(None) => create_session(conn, user.id, req, depot, res)?,
        Err(err) => return Err(err.into()),
    };

    json_ok(UserSessionInfo::new(user, session))
}

#[derive(Debug, Deserialize, ToSchema)]
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
fn reauth(
    json: JsonBody<PasswordInput>,
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
) -> JsonResult<UserSessionInfo> {
    let conn = &mut db::get()?;
    let session = depot.session();
    let PasswordInput { password, mfa_code } = json.into_inner();
    util::check_password_and_mfa_if_enabled(
        session.user_id,
        &password,
        mfa_code.as_deref(),
        conn,
    )?;

    let session = rotate_session::<true>(conn, session, req, depot, res)?;
    json_ok(UserSessionInfo::from_session(conn, session)?)
}

/// Refresh JWT access token for the current Session
#[endpoint(
    security(("session" = []))
)]
fn refresh_jwt(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
) -> JsonResult<SessionInfo> {
    let conn = &mut db::get()?;
    let session = depot.session();

    json_ok(rotate_session::<false>(conn, session, req, depot, res)?.into())
}

fn set_auth_cookies(res: &mut Response, token: SessionToken, jwt: String) {
    res.add_cookie(util::session_cookie(token));
    res.add_cookie(util::jwt_cookie(jwt));
}

fn rotate_session<const DO_REAUTH: bool>(
    conn: &mut db::DbConn,
    session: &Session,
    req: &Request,
    depot: &Depot,
    res: &mut Response,
) -> AppResult<Session> {
    use crate::schema::sessions::dsl as sessions_dsl;

    let (device_name, ip_address) = util::get_device_and_ip(req);
    let token = SessionToken::generate();
    let hashed_token = token.to_hash();

    let rotated = session.rotate::<DO_REAUTH>(
        hashed_token,
        depot.device_id().to_owned(),
        device_name,
        ip_address,
    );

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

    crate::stream::StreamManager::global().refresh_auth(&rotated);
    let jwt = util::jwt_create(&rotated, hashed_token.to_truncated())?;
    set_auth_cookies(res, token, jwt);
    Ok(rotated)
}

fn create_session(
    conn: &mut db::DbConn,
    user_id: i32,
    req: &Request,
    depot: &Depot,
    res: &mut Response,
) -> AppResult<Session> {
    use crate::schema::sessions::dsl::sessions;

    let token = SessionToken::generate();
    let token_hash = token.to_hash();
    let (device_name, ip_address) = util::get_device_and_ip(req);
    let new_session = NewSession::new(
        user_id,
        token_hash,
        depot.device_id().to_owned(),
        device_name,
        ip_address,
    );

    let session: Session = diesel::insert_into(sessions)
        .values(&new_session)
        .get_result(conn)?;

    if let Err(err) =
        util::prune_excess_sessions(conn, user_id, Some(session.id))
    {
        tracing::error!(%err, user_id, "Failed to prune excess sessions after creating a new session");
    }

    let jwt = util::jwt_create(&session, token_hash.to_truncated())?;
    set_auth_cookies(res, token, jwt);

    Ok(session)
}

pub(super) fn session_hoop_inner<const NO_PENDING_REAUTH: bool>(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
) -> Result<(), ApiError> {
    let session_token = SessionToken::try_from(
        req.cookie(super::SESSION_COOKIE_NAME)
            .ok_or(AuthError::MissingSessionCookie)?
            .value(),
    )
    .map_err(|_| AuthError::InvalidSessionToken)?;

    use crate::schema::sessions::dsl::*;
    let session: Session = sessions
        .filter(token_hash.eq(session_token.to_hash()))
        .first(&mut db::get()?)
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
pub fn session_hoop(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    ctrl: &mut FlowCtrl,
) {
    if let Err(err) = session_hoop_inner::<true>(req, depot, res) {
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
fn session_allow_reauth_hoop(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    ctrl: &mut FlowCtrl,
) {
    if let Err(err) = session_hoop_inner::<false>(req, depot, res) {
        err.render(res);
        ctrl.skip_rest();
    }
}
