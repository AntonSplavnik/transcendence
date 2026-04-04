use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;
use chrono::{Duration, Utc};
use diesel::OptionalExtension;
use salvo::http::StatusCode;
use salvo::oapi::extract::QueryParam;

use crate::email::{EmailSender, TransactionalEmail};
use crate::error::GdprError;
use crate::models::AccountDeletionRequest;
use crate::models::blob::{Bytes, FixedBlob};
use crate::prelude::*;

use super::gdpr_common::{InitiateResponse, remaining_minutes_until};
use super::router::PasswordInput;

// ── Handlers ─────────────────────────────────────────────────────────────

/// Initiate or execute account deletion.
///
/// - Without `token` query param: initiates deletion, returns a token and whether email confirmation is required.
/// - With `token` query param: executes deletion after verifying password, token, and email confirmation.
#[endpoint]
pub async fn delete_my_account(
    token: QueryParam<FixedBlob<32, Bytes>, false>,
    json: JsonBody<PasswordInput>,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> AppResult<()> {
    let PasswordInput { password, mfa_code } = json.into_inner();
    let user_id = depot.user_id();

    if let Some(token) = token.into_inner() {
        execute_deletion(token, password, mfa_code, user_id, depot, res, &db).await
    } else {
        initiate_deletion(password, mfa_code, user_id, depot, res, &db).await
    }
}

/// Confirm account deletion via email link (returns HTML page).
#[endpoint]
pub async fn confirm_account_deletion(
    user_id: QueryParam<i32, true>,
    token: QueryParam<FixedBlob<32, Bytes>, true>,
    res: &mut Response,
    db: Db,
) {
    use crate::utils::html_action_result_card;

    let user_id = user_id.into_inner();
    let token = token.into_inner();

    let confirmed = match db
        .write(move |conn| -> Result<bool, diesel::result::Error> {
            use crate::schema::account_deletion_requests::dsl as adr;

            let maybe_request: Option<AccountDeletionRequest> = adr::account_deletion_requests
                .filter(adr::user_id.eq(user_id))
                .filter(adr::confirm_token.eq(Some(token.as_ref())))
                .first(conn)
                .optional()?;

            let Some(request) = maybe_request else {
                return Ok(false);
            };

            if Utc::now() > request.expires_at {
                return Ok(false);
            }

            // Clear confirm_token. Safe to filter only by user_id here because
            // user_id is the PK (at most one row) and we hold the exclusive
            // writer connection, so no concurrent mutation can race.
            diesel::update(adr::account_deletion_requests.filter(adr::user_id.eq(user_id)))
                .set(adr::confirm_token.eq(None::<Vec<u8>>))
                .execute(conn)?;

            Ok(true)
        })
        .await
    {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            tracing::error!(error = ?e, "database error confirming account deletion");
            false
        }
        Err(e) => {
            tracing::error!(error = ?e, "task error confirming account deletion");
            false
        }
    };

    if confirmed {
        res.render(salvo::writing::Text::Html(html_action_result_card(
            "Account deletion confirmed",
            "Account deletion confirmed",
            true,
            "Your account deletion request has been confirmed. You may now complete the deletion from the app.",
        )));
    } else {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(salvo::writing::Text::Html(html_action_result_card(
            "Confirmation Failed",
            "Confirmation Failed",
            false,
            "This confirmation link is invalid or has expired. Please request a new deletion.",
        )));
    }
}

// ── Private helpers ────────────────────────────────────────────────────────

async fn initiate_deletion(
    password: String,
    mfa_code: Option<String>,
    user_id: i32,
    depot: &Depot,
    res: &mut Response,
    db: &Db,
) -> AppResult<()> {
    db.write(move |conn| {
        super::util::check_password_and_mfa_if_enabled(
            user_id,
            &password,
            mfa_code.as_deref(),
            conn,
        )
    })
    .await??;

    let mailer = depot.mailer().clone();

    // Fetch user and upsert the deletion request in one write to avoid an
    // extra round-trip. The user is needed for the confirmation email.
    let (user, token_bytes, confirm_token_bytes_opt, expires_at) = db
        .write(move |conn| {
            use crate::schema::account_deletion_requests::dsl as adr;
            use crate::schema::users::dsl as u;

            let user: crate::models::User = u::users.find(user_id).first(conn)?;

            if user.email.starts_with("deleted[") {
                return Err(ApiError::Gdpr(GdprError::AlreadyDeleted));
            }

            let email_confirmed = user.email_confirmed_at.is_some();

            let existing: Option<AccountDeletionRequest> = adr::account_deletion_requests
                .filter(adr::user_id.eq(user_id))
                .first(conn)
                .optional()?;

            if let Some(req) = existing {
                if Utc::now() <= req.expires_at {
                    return Ok::<_, ApiError>((user, req.token, req.confirm_token, req.expires_at));
                }
                diesel::delete(adr::account_deletion_requests.filter(adr::user_id.eq(user_id)))
                    .execute(conn)?;
            }

            let token: Vec<u8> = rand::random::<[u8; 32]>().to_vec();
            let confirm_token: Option<Vec<u8>> = if email_confirmed {
                Some(rand::random::<[u8; 32]>().to_vec())
            } else {
                None
            };
            let expires_at = Utc::now() + Duration::minutes(30);

            diesel::insert_into(adr::account_deletion_requests)
                .values(&AccountDeletionRequest {
                    user_id,
                    token: token.clone(),
                    confirm_token: confirm_token.clone(),
                    expires_at,
                })
                .execute(conn)?;

            Ok::<_, ApiError>((user, token, confirm_token, expires_at))
        })
        .await??;

    if let Some(ref confirm_token_bytes) = confirm_token_bytes_opt {
        let base_url = &crate::config::get().email.base_url;
        let encoded_confirm_token = base64url.encode(confirm_token_bytes);
        let confirm_url = format!(
            "{base_url}/api/gdpr/confirm-account-deletion?user_id={user_id}&token={encoded_confirm_token}"
        );

        let send_result = mailer
            .send(
                &user,
                TransactionalEmail::AccountDeletionConfirmation {
                    confirm_url,
                    remaining_minutes: remaining_minutes_until(expires_at),
                },
            )
            .await;

        if send_result.is_err() {
            let _ = db
                .write(move |conn| {
                    use crate::schema::account_deletion_requests::dsl as adr;
                    diesel::update(adr::account_deletion_requests.filter(adr::user_id.eq(user_id)))
                        .set(adr::confirm_token.eq(None::<Vec<u8>>))
                        .execute(conn)
                })
                .await;
        }
    }

    res.render(Json(InitiateResponse {
        token: base64url.encode(&token_bytes),
        email_confirmation_required: confirm_token_bytes_opt.is_some(),
        expires_at,
    }));
    Ok(())
}

async fn execute_deletion(
    token: FixedBlob<32, Bytes>,
    password: String,
    mfa_code: Option<String>,
    user_id: i32,
    depot: &Depot,
    res: &mut Response,
    db: &Db,
) -> AppResult<()> {
    db.write(move |conn| {
        super::util::check_password_and_mfa_if_enabled(
            user_id,
            &password,
            mfa_code.as_deref(),
            conn,
        )
    })
    .await??;

    let streams = depot.stream_manager().clone();
    let nick_cache = depot.nickname_cache().clone();
    let mailer = depot.mailer().clone();

    // Verify token, run pseudo-anonymization, and return the original user
    // (captured before deletion) for the post-deletion notification email.
    let original_user = db
        .write(move |conn| {
            use crate::schema::account_deletion_requests::dsl as adr;
            use crate::schema::users::dsl as u;

            let request: AccountDeletionRequest = adr::account_deletion_requests
                .filter(adr::user_id.eq(user_id))
                .filter(adr::token.eq(token.as_ref()))
                .first(conn)
                .map_err(|_| ApiError::Gdpr(GdprError::InvalidToken))?;

            if Utc::now() > request.expires_at {
                return Err(ApiError::Gdpr(GdprError::TokenExpired));
            }

            if request.confirm_token.is_some() {
                return Err(ApiError::Gdpr(GdprError::EmailConfirmationPending));
            }

            let user: crate::models::User = u::users.find(user_id).first(conn)?;

            conn.transaction::<_, diesel::result::Error, _>(|conn| {
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

                {
                    use crate::schema::sessions::dsl as s;
                    diesel::delete(s::sessions.filter(s::user_id.eq(user_id))).execute(conn)?;
                }
                {
                    use crate::schema::two_fa_recovery_codes::dsl as tfa;
                    diesel::delete(tfa::two_fa_recovery_codes.filter(tfa::user_id.eq(user_id)))
                        .execute(conn)?;
                }
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
                {
                    use crate::schema::friend_requests::dsl as fr;
                    diesel::delete(
                        fr::friend_requests
                            .filter(fr::sender_id.eq(user_id).or(fr::receiver_id.eq(user_id))),
                    )
                    .execute(conn)?;
                }
                {
                    use crate::schema::notifications::dsl as n;
                    diesel::delete(n::notifications.filter(n::user_id.eq(user_id)))
                        .execute(conn)?;
                }
                {
                    use crate::schema::account_deletion_requests::dsl as adr2;
                    diesel::delete(
                        adr2::account_deletion_requests.filter(adr2::user_id.eq(user_id)),
                    )
                    .execute(conn)?;
                }
                {
                    use crate::schema::data_export_requests::dsl as der;
                    diesel::delete(der::data_export_requests.filter(der::user_id.eq(user_id)))
                        .execute(conn)?;
                }

                Ok(())
            })?;

            Ok::<_, ApiError>(user)
        })
        .await??;

    streams.close_stream(user_id, None);
    crate::avatar::cache::invalidate(user_id);
    nick_cache.invalidate(user_id);
    super::util::delete_auth_cookies(res);

    // Best-effort notification. Only sends if the original email was confirmed;
    // unconfirmed addresses are silently skipped.
    let _ = mailer
        .send(&original_user, TransactionalEmail::AccountDeleted)
        .await;

    res.status_code(StatusCode::NO_CONTENT);
    Ok(())
}
