use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as base64std;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;
use chrono::{DateTime, Duration, Utc};
use diesel::OptionalExtension;
use salvo::http::StatusCode;
use salvo::oapi::extract::QueryParam;

use crate::email::{EmailSender, TransactionalEmail};
use crate::error::GdprError;
use crate::models::{
    AvatarLarge, AvatarSmall, DataExportRequest, FriendRequest, FriendRequestStatus,
    OfflineNotification, Session, User,
};
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use super::router::PasswordInput;

// ── HTML pages ───────────────────────────────────────────────────────────

const CONFIRMED_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Export Confirmed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:400px}
h1{color:#22c55e;margin-bottom:.5rem}</style></head>
<body><div class="card"><h1>Email Confirmed</h1><p>Your data export request has been confirmed. You may now download your data from the app.</p></div></body>
</html>"#;

const ERROR_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Confirmation Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:400px}
h1{color:#ef4444;margin-bottom:.5rem}</style></head>
<body><div class="card"><h1>Confirmation Failed</h1><p>This confirmation link is invalid or has expired. Please request a new export.</p></div></body>
</html>"#;

// ── Response types ────────────────────────────────────────────────────────

#[derive(Serialize, ToSchema)]
struct InitiateResponse {
    token: String,
    email_confirmation_required: bool,
    expires_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
pub struct DataExport {
    exported_at: DateTime<Utc>,
    user: ExportUser,
    sessions: Vec<ExportSession>,
    friend_requests: Vec<ExportFriendRequest>,
    notifications: Vec<ExportNotification>,
    avatar_large_base64: Option<String>,
    avatar_small_base64: Option<String>,
}

#[derive(Serialize, ToSchema)]
struct ExportUser {
    id: i32,
    email: String,
    nickname: String,
    totp_enabled: bool,
    totp_confirmed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    description: String,
    tos_accepted_at: Option<DateTime<Utc>>,
    email_confirmed_at: Option<DateTime<Utc>>,
    /// Pending email change (from email_confirmation_token_email)
    pending_email_change: Option<String>,
}

#[derive(Serialize, ToSchema)]
struct ExportSession {
    id: i32,
    user_id: i32,
    device_id: String,
    device_name: Option<String>,
    ip_address: Option<String>,
    created_at: DateTime<Utc>,
    refreshed_at: DateTime<Utc>,
    last_used_at: DateTime<Utc>,
    last_authenticated_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
struct ExportFriendRequest {
    id: i32,
    sender_id: i32,
    receiver_id: i32,
    status: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
struct ExportNotification {
    id: i32,
    payload: NotificationPayload,
    created_at: DateTime<Utc>,
}

// ── Handlers ─────────────────────────────────────────────────────────────

/// Initiate or execute a GDPR data export.
///
/// - Without `token` query param: initiates export, returns a token and whether email confirmation is required.
/// - With `token` query param: executes export after verifying password, token, and email confirmation.
#[endpoint]
pub async fn export_my_data(
    token: QueryParam<String, false>,
    json: JsonBody<PasswordInput>,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> AppResult<()> {
    let PasswordInput { password, mfa_code } = json.into_inner();

    if let Some(token_str) = token.into_inner() {
        // ── Execution path ────────────────────────────────────────────

        let user_id = depot.user_id();

        // Verify password + MFA
        db.write(move |conn| {
            super::util::check_password_and_mfa_if_enabled(
                user_id,
                &password,
                mfa_code.as_deref(),
                conn,
            )
        })
        .await??;

        // Decode token from base64url
        let token_bytes = base64url
            .decode(token_str.as_bytes())
            .map_err(|_| ApiError::Gdpr(GdprError::InvalidToken))?;

        let mailer = depot.mailer().clone();

        // Delete export request and gather all user data
        let (export_data, user_for_email) = db
            .write(move |conn| {
                use crate::schema::data_export_requests::dsl as der;

                // Look up export request
                let request: DataExportRequest = der::data_export_requests
                    .filter(der::user_id.eq(user_id))
                    .filter(der::token.eq(&token_bytes))
                    .first(conn)
                    .map_err(|_| ApiError::Gdpr(GdprError::InvalidToken))?;

                // Verify not expired
                if Utc::now() > request.expires_at {
                    return Err(ApiError::Gdpr(GdprError::TokenExpired));
                }

                // Check email confirmation still pending
                if request.confirm_token.is_some() {
                    return Err(ApiError::Gdpr(GdprError::EmailConfirmationPending));
                }

                // Delete the export request row
                diesel::delete(
                    der::data_export_requests.filter(der::user_id.eq(user_id)),
                )
                .execute(conn)?;

                // Gather all user data
                use crate::schema::avatars_large::dsl as al;
                use crate::schema::avatars_small::dsl as as_;
                use crate::schema::friend_requests::dsl as fr;
                use crate::schema::notifications::dsl as n;
                use crate::schema::sessions::dsl as s;
                use crate::schema::users::dsl as u;

                // 1. Get user
                let user: User = u::users.find(user_id).first(conn)?;

                // 2. Get all sessions (excluding token_hash)
                let user_sessions: Vec<Session> =
                    s::sessions.filter(s::user_id.eq(user_id)).load(conn)?;

                // 3. Get friend requests where sender or receiver
                let user_friend_requests: Vec<FriendRequest> = fr::friend_requests
                    .filter(fr::sender_id.eq(user_id).or(fr::receiver_id.eq(user_id)))
                    .load(conn)?;

                // 4. Get notifications
                let user_notifications: Vec<OfflineNotification> =
                    n::notifications.filter(n::user_id.eq(user_id)).load(conn)?;

                // 5. Get avatars
                let avatar_large: Option<AvatarLarge> = al::avatars_large
                    .filter(al::user_id.eq(user_id))
                    .first(conn)
                    .optional()?;
                let avatar_small: Option<AvatarSmall> = as_::avatars_small
                    .filter(as_::user_id.eq(user_id))
                    .first(conn)
                    .optional()?;

                // Build DataExport
                let export = DataExport {
                    exported_at: Utc::now(),
                    user: ExportUser {
                        id: user.id,
                        email: user.email.clone(),
                        nickname: user.nickname.to_string(),
                        totp_enabled: user.totp_enabled,
                        totp_confirmed_at: user.totp_confirmed_at,
                        created_at: user.created_at,
                        description: user.description.clone(),
                        tos_accepted_at: user.tos_accepted_at,
                        email_confirmed_at: user.email_confirmed_at,
                        pending_email_change: user.email_confirmation_token_email.clone(),
                    },
                    sessions: user_sessions
                        .into_iter()
                        .map(|sess| ExportSession {
                            id: sess.id,
                            user_id: sess.user_id,
                            device_id: sess.device_id,
                            device_name: sess.device_name,
                            ip_address: sess.ip_address,
                            created_at: sess.created_at,
                            refreshed_at: sess.refreshed_at,
                            last_used_at: sess.last_used_at,
                            last_authenticated_at: sess.last_authenticated_at,
                        })
                        .collect(),
                    friend_requests: user_friend_requests
                        .into_iter()
                        .map(|fr| ExportFriendRequest {
                            id: fr.id,
                            sender_id: fr.sender_id,
                            receiver_id: fr.receiver_id,
                            status: match fr.status {
                                FriendRequestStatus::Pending => "pending",
                                FriendRequestStatus::Accepted => "accepted",
                            }
                            .to_string(),
                            created_at: fr.created_at,
                            updated_at: fr.updated_at,
                        })
                        .collect(),
                    notifications: user_notifications
                        .into_iter()
                        .map(|notif| ExportNotification {
                            id: notif.id,
                            payload: (*notif.data).clone(),
                            created_at: notif.created_at,
                        })
                        .collect(),
                    avatar_large_base64: avatar_large
                        .map(|a| base64std.encode(&a.data)),
                    avatar_small_base64: avatar_small
                        .map(|a| base64std.encode(&a.data)),
                };

                Ok::<_, ApiError>((export, user))
            })
            .await??;

        // Send "data exported" notification email (best-effort)
        let _ = mailer
            .send(&user_for_email, TransactionalEmail::DataExported)
            .await;

        res.render(Json(export_data));
        Ok(())
    } else {
        // ── Initiation path ───────────────────────────────────────────

        let user_id = depot.user_id();

        // Verify password + MFA
        db.write(move |conn| {
            super::util::check_password_and_mfa_if_enabled(
                user_id,
                &password,
                mfa_code.as_deref(),
                conn,
            )
        })
        .await??;

        // Get the full user (for email address and email_confirmed_at)
        let user = db.get_user(user_id).await?;

        let mailer = depot.mailer().clone();
        let email_confirmed = user.email_confirmed_at.is_some();

        let (token_bytes, confirm_token_bytes_opt, expires_at) = db
            .write(move |conn| {
                use crate::schema::data_export_requests::dsl as der;

                // Check for existing non-expired request
                let existing: Option<DataExportRequest> = der::data_export_requests
                    .filter(der::user_id.eq(user_id))
                    .first(conn)
                    .optional()?;

                if let Some(req) = existing {
                    if Utc::now() <= req.expires_at {
                        // Reuse existing token + confirm_token
                        return Ok::<_, ApiError>((req.token, req.confirm_token, req.expires_at));
                    }
                    // Expired — delete it
                    diesel::delete(
                        der::data_export_requests.filter(der::user_id.eq(user_id)),
                    )
                    .execute(conn)?;
                }

                // Generate new tokens
                let token: Vec<u8> = rand::random::<[u8; 32]>().to_vec();
                let confirm_token: Option<Vec<u8>> = if email_confirmed {
                    Some(rand::random::<[u8; 32]>().to_vec())
                } else {
                    None
                };
                let expires_at = Utc::now() + Duration::minutes(30);

                let new_request = DataExportRequest {
                    user_id,
                    token: token.clone(),
                    confirm_token: confirm_token.clone(),
                    expires_at,
                };

                diesel::insert_into(der::data_export_requests)
                    .values(&new_request)
                    .execute(conn)?;

                Ok::<_, ApiError>((token, confirm_token, expires_at))
            })
            .await??;

        // If confirm_token is set, send confirmation email
        if let Some(ref confirm_token_bytes) = confirm_token_bytes_opt {
            let base_url = &crate::config::get().email.base_url;
            let encoded_confirm_token = base64url.encode(confirm_token_bytes);
            let confirm_url = format!(
                "{base_url}/api/gdpr/confirm-data-export?user_id={user_id}&token={encoded_confirm_token}"
            );
            let remaining_minutes = {
                let diff = expires_at - Utc::now();
                diff.num_minutes().max(0) as u32
            };

            let send_result = mailer
                .send(
                    &user,
                    TransactionalEmail::DataExportConfirmation {
                        confirm_url,
                        remaining_minutes,
                    },
                )
                .await;

            if send_result.is_err() {
                // Clear confirm_token on send failure
                let _ = db
                    .write(move |conn| {
                        use crate::schema::data_export_requests::dsl as der;
                        diesel::update(
                            der::data_export_requests.filter(der::user_id.eq(user_id)),
                        )
                        .set(der::confirm_token.eq(None::<Vec<u8>>))
                        .execute(conn)
                    })
                    .await;
            }
        }

        let encoded_token = base64url.encode(&token_bytes);
        let email_confirmation_required = confirm_token_bytes_opt.is_some();

        res.render(Json(InitiateResponse {
            token: encoded_token,
            email_confirmation_required,
            expires_at,
        }));
        Ok(())
    }
}

/// Confirm data export request via email link (returns HTML page).
#[endpoint]
pub async fn confirm_data_export(
    user_id_param: QueryParam<i32, false>,
    token: QueryParam<String, false>,
    res: &mut Response,
    db: Db,
) {
    let (user_id, token_str) = match (user_id_param.into_inner(), token.into_inner()) {
        (Some(uid), Some(tok)) => (uid, tok),
        _ => {
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(salvo::writing::Text::Html(ERROR_HTML));
            return;
        }
    };

    // Decode token from base64url
    let token_bytes = match base64url.decode(token_str.as_bytes()) {
        Ok(b) => b,
        Err(_) => {
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(salvo::writing::Text::Html(ERROR_HTML));
            return;
        }
    };

    let result: Result<bool, _> = db
        .write(move |conn| {
            use crate::schema::data_export_requests::dsl as der;

            let maybe_request: Option<DataExportRequest> = match der::data_export_requests
                .filter(der::user_id.eq(user_id))
                .filter(der::confirm_token.eq(Some(&token_bytes)))
                .first(conn)
                .optional()
            {
                Ok(r) => r,
                Err(_) => return false,
            };

            let request = match maybe_request {
                Some(r) => r,
                None => return false,
            };

            if Utc::now() > request.expires_at {
                return false;
            }

            // Clear confirm_token
            let updated = diesel::update(
                der::data_export_requests.filter(der::user_id.eq(user_id)),
            )
            .set(der::confirm_token.eq(None::<Vec<u8>>))
            .execute(conn);

            updated.is_ok()
        })
        .await;

    match result {
        Ok(true) => {
            res.render(salvo::writing::Text::Html(CONFIRMED_HTML));
        }
        _ => {
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(salvo::writing::Text::Html(ERROR_HTML));
        }
    }
}
