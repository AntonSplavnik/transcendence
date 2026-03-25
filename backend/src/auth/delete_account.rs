use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;
use chrono::{Duration, Utc};
use diesel::OptionalExtension;
use salvo::http::StatusCode;
use salvo::oapi::extract::QueryParam;

use crate::email::{EmailSender, TransactionalEmail};
use crate::error::GdprError;
use crate::models::AccountDeletionRequest;
use crate::prelude::*;

use super::router::PasswordInput;

// ── HTML pages ───────────────────────────────────────────────────────────

const CONFIRMED_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Deletion Confirmed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:400px}
h1{color:#22c55e;margin-bottom:.5rem}</style></head>
<body><div class="card"><h1>Email Confirmed</h1><p>Your account deletion request has been confirmed. You may now complete the deletion from the app.</p></div></body>
</html>"#;

const ERROR_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Confirmation Failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center;max-width:400px}
h1{color:#ef4444;margin-bottom:.5rem}</style></head>
<body><div class="card"><h1>Confirmation Failed</h1><p>This confirmation link is invalid or has expired. Please request a new deletion.</p></div></body>
</html>"#;

// ── Response types ────────────────────────────────────────────────────────

#[derive(Serialize, ToSchema)]
struct InitiateResponse {
    token: String,
    email_confirmation_required: bool,
    expires_at: chrono::DateTime<Utc>,
}

// ── Handlers ─────────────────────────────────────────────────────────────

/// Initiate or execute account deletion.
///
/// - Without `token` query param: initiates deletion, returns a token and whether email confirmation is required.
/// - With `token` query param: executes deletion after verifying password, token, and email confirmation.
#[endpoint]
pub async fn delete_my_account(
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

        // Capture depot references before moving into closure
        let streams = depot.stream_manager().clone();
        let nick_cache = depot.nickname_cache().clone();
        let mailer = depot.mailer().clone();

        let original_email = db
            .write(move |conn| {
                use crate::schema::account_deletion_requests::dsl as adr;
                use crate::schema::users::dsl as u;

                // Look up deletion request
                let request: AccountDeletionRequest = adr::account_deletion_requests
                    .filter(adr::user_id.eq(user_id))
                    .filter(adr::token.eq(&token_bytes))
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

                // Capture original email for post-deletion notification
                let user: crate::models::User = u::users.find(user_id).first(conn)?;
                let original_email = user.email.clone();

                // Pseudo-anonymization inside a transaction
                conn.transaction::<_, diesel::result::Error, _>(|conn| {
                    // Anonymize user
                    let deleted_email = format!("deleted[{user_id}]");
                    let deleted_nickname =
                        crate::models::nickname::Nickname::from_str(format!("deleted[{user_id}]"));
                    diesel::update(u::users.find(user_id))
                        .set((
                            u::email.eq(&deleted_email),
                            u::nickname.eq(deleted_nickname),
                            u::description.eq(""),
                            u::password_hash.eq(super::util::random_password_hash()),
                            u::totp_enabled.eq(false),
                            u::totp_secret_enc.eq(None::<String>),
                            u::totp_confirmed_at.eq(None::<chrono::DateTime<chrono::Utc>>),
                            u::tos_accepted_at.eq(None::<chrono::DateTime<chrono::Utc>>),
                            u::email_confirmed_at.eq(None::<chrono::DateTime<chrono::Utc>>),
                            u::email_confirmation_token_hash.eq(None::<Vec<u8>>),
                            u::email_confirmation_token_expires_at
                                .eq(None::<chrono::DateTime<chrono::Utc>>),
                            u::email_confirmation_token_email.eq(None::<String>),
                        ))
                        .execute(conn)?;

                    // Delete sessions
                    {
                        use crate::schema::sessions::dsl as s;
                        diesel::delete(s::sessions.filter(s::user_id.eq(user_id))).execute(conn)?;
                    }

                    // Delete 2FA recovery codes
                    {
                        use crate::schema::two_fa_recovery_codes::dsl as tfa;
                        diesel::delete(tfa::two_fa_recovery_codes.filter(tfa::user_id.eq(user_id)))
                            .execute(conn)?;
                    }

                    // Delete avatars
                    {
                        use crate::schema::avatars_large::dsl as al;
                        diesel::delete(al::avatars_large.filter(al::user_id.eq(user_id)))
                            .execute(conn)?;
                    }
                    {
                        use crate::schema::avatars_small::dsl as as_;
                        diesel::delete(as_::avatars_small.filter(as_::user_id.eq(user_id)))
                            .execute(conn)?;
                    }

                    // Delete friend requests
                    {
                        use crate::schema::friend_requests::dsl as fr;
                        diesel::delete(
                            fr::friend_requests
                                .filter(fr::sender_id.eq(user_id).or(fr::receiver_id.eq(user_id))),
                        )
                        .execute(conn)?;
                    }

                    // Delete notifications
                    {
                        use crate::schema::notifications::dsl as n;
                        diesel::delete(n::notifications.filter(n::user_id.eq(user_id)))
                            .execute(conn)?;
                    }

                    // Delete account_deletion_requests
                    {
                        use crate::schema::account_deletion_requests::dsl as adr2;
                        diesel::delete(
                            adr2::account_deletion_requests.filter(adr2::user_id.eq(user_id)),
                        )
                        .execute(conn)?;
                    }

                    // Delete data_export_requests
                    {
                        use crate::schema::data_export_requests::dsl as der;
                        diesel::delete(der::data_export_requests.filter(der::user_id.eq(user_id)))
                            .execute(conn)?;
                    }

                    Ok(())
                })?;

                Ok::<_, ApiError>(original_email)
            })
            .await??;

        // Post-cleanup
        streams.close_stream(user_id, None);
        crate::avatar::cache::invalidate(user_id);
        nick_cache.invalidate(user_id);
        super::util::delete_auth_cookies(res);

        // Send "account deleted" notification email (best-effort)
        let deleted_user = crate::models::User {
            id: user_id,
            email: original_email,
            nickname: crate::models::nickname::Nickname::from_str(format!("deleted[{user_id}]")),
            totp_enabled: false,
            totp_secret_enc: None,
            totp_confirmed_at: None,
            password_hash: String::new(),
            created_at: Utc::now(),
            description: String::new(),
            tos_accepted_at: None,
            email_confirmed_at: Some(Utc::now()), // ensure mailer doesn't reject it
            email_confirmation_token_hash: None,
            email_confirmation_token_expires_at: None,
            email_confirmation_token_email: None,
        };
        let _ = mailer
            .send(&deleted_user, TransactionalEmail::AccountDeleted)
            .await;

        res.status_code(StatusCode::NO_CONTENT);
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
        let is_deleted = user.email.starts_with("deleted[");

        let (token_bytes, confirm_token_bytes_opt, expires_at) = db
            .write(move |conn| {
                use crate::schema::account_deletion_requests::dsl as adr;

                // Check if account is already deleted
                if is_deleted {
                    return Err(ApiError::Gdpr(GdprError::AlreadyDeleted));
                }

                // Check for existing non-expired request
                let existing: Option<AccountDeletionRequest> = adr::account_deletion_requests
                    .filter(adr::user_id.eq(user_id))
                    .first(conn)
                    .optional()?;

                if let Some(req) = existing {
                    if Utc::now() <= req.expires_at {
                        // Reuse existing token + confirm_token
                        return Ok::<_, ApiError>((req.token, req.confirm_token, req.expires_at));
                    }
                    // Expired — delete it
                    diesel::delete(adr::account_deletion_requests.filter(adr::user_id.eq(user_id)))
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

                let new_request = AccountDeletionRequest {
                    user_id,
                    token: token.clone(),
                    confirm_token: confirm_token.clone(),
                    expires_at,
                };

                diesel::insert_into(adr::account_deletion_requests)
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
                "{base_url}/api/gdpr/confirm-account-deletion?user_id={user_id}&token={encoded_confirm_token}"
            );
            let remaining_minutes = {
                let diff = expires_at - Utc::now();
                diff.num_minutes().max(0) as u32
            };

            let send_result = mailer
                .send(
                    &user,
                    TransactionalEmail::AccountDeletionConfirmation {
                        confirm_url,
                        remaining_minutes,
                    },
                )
                .await;

            if send_result.is_err() {
                // Clear confirm_token on send failure
                let _ = db
                    .write(move |conn| {
                        use crate::schema::account_deletion_requests::dsl as adr;
                        diesel::update(
                            adr::account_deletion_requests.filter(adr::user_id.eq(user_id)),
                        )
                        .set(adr::confirm_token.eq(None::<Vec<u8>>))
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

/// Confirm account deletion via email link (returns HTML page).
#[endpoint]
pub async fn confirm_account_deletion(
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
            use crate::schema::account_deletion_requests::dsl as adr;

            let maybe_request: Option<AccountDeletionRequest> = match adr::account_deletion_requests
                .filter(adr::user_id.eq(user_id))
                .filter(adr::confirm_token.eq(Some(&token_bytes)))
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
            let updated =
                diesel::update(adr::account_deletion_requests.filter(adr::user_id.eq(user_id)))
                    .set(adr::confirm_token.eq(None::<Vec<u8>>))
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
