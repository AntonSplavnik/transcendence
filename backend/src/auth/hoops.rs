use salvo::oapi::SecurityRequirement;
use thiserror::Error;
use ulid::Ulid;

use crate::auth::{JwtClaims, jwt_decoding_key, jwt_validation};
use crate::models::Session;
use crate::prelude::*;

#[derive(Debug, Error, Clone, Copy, strum::IntoStaticStr)]
pub enum AuthError {
    #[error("Missing access token")]
    MissingJwtCookie,
    #[error("Access token is invalid")]
    InvalidJwt,
    #[error("Missing session token")]
    MissingSessionCookie,
    #[error("Session token is invalid")]
    InvalidSessionToken,
    #[error("Session not found")]
    SessionNotFound,
    #[error("Session mismatch")]
    SessionMismatch,
    #[error("Reauthentication required")]
    NeedReauth,
    #[error("Successful Logout")]
    DidLogout,
    #[error("Invalid credentials")]
    InvalidCredentials,
    #[error("Two-factor authentication required")]
    TwoFactorRequired,
    #[error("Two-factor authentication code is invalid")]
    TwoFactorInvalid,
}

#[allow(unused)]
pub trait DepotAuthExt {
    fn user_id(&self) -> i32;
    fn session(&self) -> &crate::models::Session;
    fn device_id(&self) -> &str;
}

impl DepotAuthExt for Depot {
    fn user_id(&self) -> i32 {
        self.session().user_id
    }

    fn session(&self) -> &crate::models::Session {
        self.get::<crate::models::Session>("session")
            .expect("Needs session or access hoop")
    }

    fn device_id(&self) -> &str {
        self.get::<String>("device_id")
            .map(|s| s.as_str())
            .expect("Needs device_id inserter hoop")
    }
}

pub(super) fn set_session(depot: &mut Depot, session: crate::models::Session) {
    depot.insert("session", session);
}

fn set_device_id(depot: &mut Depot, device_id: String) {
    depot.insert("device_id", device_id);
}

#[handler]
pub async fn device_id_inserter_hoop(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
) {
    match req.cookies().get("device_id") {
        Some(cookie) => {
            set_device_id(depot, cookie.value().to_string());
        }
        None => {
            let device_id = Ulid::new().to_string();
            set_device_id(depot, device_id.clone());
            res.add_cookie(super::util::device_id_cookie(depot));
        }
    }
}

/// Load a valid Session from the access_token jwt cookie.
///
///
/// This should be used for authenticated endpoints except for the special endpoints under /auth.
/// For convenience there is a Router extension method [RouterAuthExt::requires_user_login]
/// that adds this hoop along with OpenAPI security metadata.
#[handler]
pub fn access_hoop(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    ctrl: &mut FlowCtrl,
) {
    // TODO triage whether we can introduce a cache (moka or quick-cache) for hot sessions to avoid DB hits on every request
    // need to make sure to update the cache on session refresh, reauth, logout, etc.
    fn inner(req: &mut Request, depot: &mut Depot) -> Result<(), ApiError> {
        let jwt_token = req
            .cookie(super::JWT_COOKIE_NAME)
            .ok_or(AuthError::MissingJwtCookie)?
            .value();
        // decoding checks expiry as well
        let claims: JwtClaims = jsonwebtoken::decode(
            jwt_token,
            jwt_decoding_key(),
            jwt_validation(),
        )
        .map_err(|_| AuthError::InvalidJwt)?
        .claims;

        use crate::schema::sessions::dsl::*;
        let session: Session = sessions
            .filter(id.eq(claims.sid))
            .first(&mut db::get())
            .map_err(|_| AuthError::SessionNotFound)?;

        if session.user_id != claims.sub {
            return Err(AuthError::SessionMismatch.into());
        }

        if session.token_hash != claims.jti {
            return Err(AuthError::SessionMismatch.into());
        }

        // even though this expiry is accounted for in the jwt,
        // it might be that the session got logged out since jwt creation
        if session.login_expiry() < chrono::Utc::now() {
            return Err(AuthError::NeedReauth.into());
        }

        set_session(depot, session);
        Ok(())
    }

    if let Err(err) = inner(req, depot) {
        err.render(res);
        ctrl.skip_rest();
    }
}

pub trait RouterAuthExt {
    /// see [access_hoop]
    fn requires_user_login(self) -> Self;
}

impl RouterAuthExt for Router {
    fn requires_user_login(self) -> Self {
        self.hoop(access_hoop)
            .oapi_security(SecurityRequirement::new(
                "jwt",
                Vec::<String>::new(),
            ))
    }
}
