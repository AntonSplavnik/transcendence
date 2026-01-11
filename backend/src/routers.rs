use salvo::oapi::security::{ApiKey, ApiKeyValue, SecurityScheme};

use crate::prelude::*;

pub mod users;

const OPENAPI_JSON: &str = "/api-doc/openapi.json";

pub fn root() -> Router {
    let api_routes = Router::with_path("api")
        .hoop(crate::utils::logger::Logger)
        .hoop(Timeout::new(std::time::Duration::from_secs(30)))
        .append(&mut vec![
            crate::auth::router("auth"),
            crate::auth::user_router("user"),
            users::router("users"),
            crate::stream::router("stream"),
        ]);
    let api_routes = Router::new()
        .push(api_routes)
        .push(crate::stream::webtransport_router("api/stream/connect"));
    let doc = openapi_doc(&api_routes);
    let router = Router::new().push(api_routes);
    router
        .unshift(doc.into_router(OPENAPI_JSON))
        .unshift(Scalar::new(OPENAPI_JSON).into_router("scalar"))
        .unshift(SwaggerUi::new(OPENAPI_JSON).into_router("swagger-ui"))
        .unshift(RapiDoc::new(OPENAPI_JSON).into_router("rapidoc"))
        .unshift(ReDoc::new(OPENAPI_JSON).into_router("redoc"))
}

fn openapi_doc(to_document: &Router) -> OpenApi {
    OpenApi::new("Transcendence API", "0.0.1")
        .add_security_scheme(
            "session",
            SecurityScheme::ApiKey(ApiKey::Cookie(
                ApiKeyValue::with_description(
                    crate::auth::SESSION_COOKIE_NAME,
                    "HttpOnly cookie containing a 32-byte base64url-encoded refresh token. \
                     Issued by /api/auth/register and /api/auth/login and rotated on each refresh/reauth. \
                     Used only for /api/auth/session-management/* endpoints. \
                     Has a 7-day rolling session window and may require credential reauthentication \
                     based on server-side rules (e.g. after 30 days since last credential auth). \
                     Sessions are not deleted automatically.",
                ),
            )),
        )
        .add_security_scheme("reauth_session", SecurityScheme::ApiKey(ApiKey::Cookie(
                ApiKeyValue::with_description(
                    crate::auth::SESSION_COOKIE_NAME,
                    "Same as 'session' but only valid for reauth endpoints which \
                     do not enforce the requirement for the session to be non-reauth (used by /api/auth/session-management/reauth).",
                ),
            )),)
        .add_security_scheme("jwt", SecurityScheme::ApiKey(ApiKey::Cookie(
            ApiKeyValue::with_description(
                crate::auth::JWT_COOKIE_NAME,
                "JWT access token cookie used for authentication on most \
                /api/ endpoints. Explicitly issued by /api/auth/register, /api/auth/login and /api/auth/session-management/* endpoints. \
                Short-lived (a few minutes) and rotated on each refresh."),
            )),
        )
        .merge_router(&to_document)
}
