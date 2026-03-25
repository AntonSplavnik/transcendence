use std::sync::Arc;

#[cfg(debug_assertions)]
use salvo::oapi::security::{ApiKey, ApiKeyValue, SecurityScheme};

#[cfg(not(test))]
use crate::ON_SHUTDOWN;
use crate::{
    email::Mailer, notifications::NotificationManager, prelude::*, stream::StreamManager,
    tos::CurrentTosTimestamp, utils::NickCache,
};

pub mod users;

#[cfg(debug_assertions)]
const OPENAPI_JSON: &str = "/api-doc/openapi.json";

pub fn rest_api(database: Db, tos_timestamp: CurrentTosTimestamp, mailer: Mailer) -> Router {
    let api_routes = Router::with_path("api")
        .hoop(affix_state::inject(NickCache::new(
            crate::utils::NICK_CACHE_TTI,
        )))
        .hoop(crate::auth::device_id_inserter_hoop)
        .hoop(crate::utils::logger::Logger)
        .hoop(Timeout::new(std::time::Duration::from_secs(30)))
        .append(&mut vec![
            crate::auth::router("auth"),
            crate::auth::user_router("user"),
            users::router("users"),
            crate::avatar::router("avatar"),
            crate::friends::router("friends"),
            crate::stream::router("stream"),
            Router::with_path("tos")
                .oapi_tag("tos")
                .ip_rate_limit(&RateLimit::per_minute(30))
                .get(crate::tos::current_tos),
            crate::email::confirm::router("email"),
            Router::with_path("gdpr")
                .oapi_tag("gdpr")
                .ip_rate_limit(&RateLimit::per_minute(10))
                .push(
                    Router::with_path("confirm-account-deletion")
                        .get(crate::auth::delete_account::confirm_account_deletion),
                )
                .push(
                    Router::with_path("confirm-data-export")
                        .get(crate::auth::export_data::confirm_data_export),
                ),
        ]);

    let stream_manager = Arc::new(StreamManager::new());
    #[cfg(not(test))]
    {
        let sm_shutdown = Arc::downgrade(&stream_manager);
        tokio::spawn(async move {
            ON_SHUTDOWN.notified().await;
            if let Some(sm) = sm_shutdown.upgrade() {
                sm.shutdown();
            }
        });
    }

    let notification_manager = NotificationManager::new(database.clone());

    Router::new()
        .hoop(affix_state::inject(database))
        .hoop(affix_state::inject(tos_timestamp))
        .hoop(affix_state::inject(mailer))
        .hoop(affix_state::inject(stream_manager))
        .hoop(affix_state::inject(notification_manager))
        .push(api_routes)
        .push(crate::stream::webtransport_router("api/stream/connect"))
}

#[cfg_attr(test, allow(dead_code))]
pub fn root(
    database: Db,
    tos_timestamp: CurrentTosTimestamp,
    mailer: Mailer,
    https_port: u16,
) -> Router {
    let api_routes = rest_api(database, tos_timestamp, mailer);
    #[cfg(debug_assertions)]
    let doc = openapi_doc(&api_routes);
    let router = Router::new()
        .push(api_routes.hoop(ForceHttps::new().https_port(https_port)))
        .push(
            Router::with_path("{*path}")
                .get(StaticDir::new(&crate::config::get().serve_dir).defaults("index.html"))
                .hoop(ForceHttps::new().https_port(https_port)),
        );

    #[cfg(debug_assertions)]
    let router = router
        .unshift(doc.into_router(OPENAPI_JSON))
        .unshift(Scalar::new(OPENAPI_JSON).into_router("scalar"));

    router
}

#[cfg(debug_assertions)]
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
        .merge_router(to_document)
}
