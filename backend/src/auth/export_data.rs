use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as base64std;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;
use chrono::{DateTime, Duration, Utc};
use diesel::OptionalExtension;
use diesel::prelude::*;
use salvo::http::StatusCode;
use salvo::oapi::extract::QueryParam;

use crate::email::{EmailSender, TransactionalEmail};
use crate::error::GdprError;
use crate::models::blob::{Bytes, FixedBlob};
use crate::models::cbor_blob::CborBlob;
use crate::models::{AvatarLarge, AvatarSmall, DataExportRequest, FriendRequestStatus, User};
use crate::notifications::NotificationPayload;
use crate::prelude::*;

use super::gdpr_common::{InitiateResponse, remaining_minutes_until};
use super::router::PasswordInput;

// ── Response types ────────────────────────────────────────────────────────

/// Complete GDPR data export payload (Article 20 right of access).
#[derive(Serialize, Deserialize, ToSchema)]
pub struct DataExport {
    pub exported_at: DateTime<Utc>,
    pub user: ExportUser,
    pub sessions: Vec<ExportSession>,
    pub friend_requests: Vec<ExportFriendRequest>,
    pub notifications: Vec<ExportNotification>,
    pub avatar_large_base64: Option<String>,
    pub avatar_small_base64: Option<String>,
}

/// User profile data for export. Security-sensitive fields (`password_hash`,
/// `totp_secret_enc`, `email_confirmation_token_hash`,
/// `email_confirmation_token_expires_at`) are intentionally excluded.
#[derive(Queryable, Selectable, Serialize, Deserialize, ToSchema)]
#[diesel(table_name = crate::schema::users)]
pub struct ExportUser {
    pub id: i32,
    pub email: String,
    pub nickname: String,
    pub totp_enabled: bool,
    pub totp_confirmed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub description: String,
    pub tos_accepted_at: Option<DateTime<Utc>>,
    pub email_confirmed_at: Option<DateTime<Utc>>,
    /// Pending email change (from `email_confirmation_token_email`)
    #[diesel(column_name = email_confirmation_token_email)]
    pub pending_confirm_email: Option<String>,
}

#[derive(Queryable, Selectable, Serialize, Deserialize, ToSchema)]
#[diesel(table_name = crate::schema::sessions)]
pub struct ExportSession {
    pub id: i32,
    pub user_id: i32,
    pub device_id: String,
    pub device_name: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
    pub refreshed_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
    pub last_authenticated_at: DateTime<Utc>,
}

#[derive(Queryable, Selectable, Serialize, Deserialize, ToSchema)]
#[diesel(table_name = crate::schema::friend_requests)]
pub struct ExportFriendRequest {
    pub id: i32,
    pub sender_id: i32,
    pub receiver_id: i32,
    pub status: FriendRequestStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Queryable, Selectable, Serialize, Deserialize, ToSchema)]
#[diesel(table_name = crate::schema::notifications)]
pub struct ExportNotification {
    pub id: i32,
    #[salvo(schema(value_type = NotificationPayload))]
    pub data: CborBlob<NotificationPayload>,
    pub created_at: DateTime<Utc>,
}

// ── Handlers ─────────────────────────────────────────────────────────────

/// Initiate or execute a GDPR data export.
///
/// - Without `token` query param: initiates export, returns a token and whether email confirmation is required.
/// - With `token` query param: executes export after verifying password, token, and email confirmation.
#[endpoint]
pub async fn export_my_data(
    token: QueryParam<FixedBlob<32, Bytes>, false>,
    json: JsonBody<PasswordInput>,
    depot: &mut Depot,
    res: &mut Response,
    db: Db,
) -> AppResult<()> {
    let PasswordInput { password, mfa_code } = json.into_inner();
    let user_id = depot.user_id();

    if let Some(token) = token.into_inner() {
        execute_export(token, password, mfa_code, user_id, depot, res, &db).await
    } else {
        initiate_export(password, mfa_code, user_id, depot, res, &db).await
    }
}

/// Confirm data export request via email link (returns HTML page).
#[endpoint]
pub async fn confirm_data_export(
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
            use crate::schema::data_export_requests::dsl as der;

            let maybe_request: Option<DataExportRequest> = der::data_export_requests
                .filter(der::user_id.eq(user_id))
                .filter(der::confirm_token.eq(Some(token.as_ref())))
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
            diesel::update(der::data_export_requests.filter(der::user_id.eq(user_id)))
                .set(der::confirm_token.eq(None::<Vec<u8>>))
                .execute(conn)?;

            Ok(true)
        })
        .await
    {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => {
            tracing::error!(error = ?e, "database error confirming data export");
            false
        }
        Err(e) => {
            tracing::error!(error = ?e, "task error confirming data export");
            false
        }
    };

    if confirmed {
        res.render(salvo::writing::Text::Html(html_action_result_card(
            "Data export confirmed",
            "Data export confirmed",
            true,
            "Your data export request has been confirmed. You may now download your data from the app.",
        )));
    } else {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(salvo::writing::Text::Html(html_action_result_card(
            "Confirmation Failed",
            "Confirmation Failed",
            false,
            "This confirmation link is invalid or has expired. Please request a new export.",
        )));
    }
}

// ── Private helpers ────────────────────────────────────────────────────────

async fn initiate_export(
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

    // Fetch user and upsert the export request in one write to avoid an
    // extra round-trip. The user is needed for the confirmation email.
    let (user, token_bytes, confirm_token_bytes_opt, expires_at) = db
        .write(move |conn| {
            use crate::schema::data_export_requests::dsl as der;
            use crate::schema::users::dsl as u;

            let user: User = u::users.find(user_id).first(conn)?;
            let email_confirmed = user.email_confirmed_at.is_some();

            let existing: Option<DataExportRequest> = der::data_export_requests
                .filter(der::user_id.eq(user_id))
                .first(conn)
                .optional()?;

            if let Some(req) = existing {
                if Utc::now() <= req.expires_at {
                    return Ok::<_, ApiError>((user, req.token, req.confirm_token, req.expires_at));
                }
                diesel::delete(der::data_export_requests.filter(der::user_id.eq(user_id)))
                    .execute(conn)?;
            }

            let token: Vec<u8> = rand::random::<[u8; 32]>().to_vec();
            let confirm_token: Option<Vec<u8>> = if email_confirmed {
                Some(rand::random::<[u8; 32]>().to_vec())
            } else {
                None
            };
            let expires_at = Utc::now() + Duration::minutes(30);

            diesel::insert_into(der::data_export_requests)
                .values(&DataExportRequest {
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
            "{base_url}/api/gdpr/confirm-data-export?user_id={user_id}&token={encoded_confirm_token}"
        );

        let send_result = mailer
            .send(
                &user,
                TransactionalEmail::DataExportConfirmation {
                    confirm_url,
                    remaining_minutes: remaining_minutes_until(expires_at),
                },
            )
            .await;

        if send_result.is_err() {
            let _ = db
                .write(move |conn| {
                    use crate::schema::data_export_requests::dsl as der;
                    diesel::update(der::data_export_requests.filter(der::user_id.eq(user_id)))
                        .set(der::confirm_token.eq(None::<Vec<u8>>))
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

async fn execute_export(
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

    let mailer = depot.mailer().clone();

    let (export_data, user_for_email) = db
        .write(move |conn| {
            use crate::schema::avatars_large::dsl as al;
            use crate::schema::avatars_small::dsl as as_;
            use crate::schema::data_export_requests::dsl as der;
            use crate::schema::friend_requests::dsl as fr;
            use crate::schema::notifications::dsl as n;
            use crate::schema::sessions::dsl as s;
            use crate::schema::users::dsl as u;

            let request: DataExportRequest = der::data_export_requests
                .filter(der::user_id.eq(user_id))
                .filter(der::token.eq(token.as_ref()))
                .first(conn)
                .map_err(|_| ApiError::Gdpr(GdprError::InvalidToken))?;

            if Utc::now() > request.expires_at {
                return Err(ApiError::Gdpr(GdprError::TokenExpired));
            }

            if request.confirm_token.is_some() {
                return Err(ApiError::Gdpr(GdprError::EmailConfirmationPending));
            }

            diesel::delete(der::data_export_requests.filter(der::user_id.eq(user_id)))
                .execute(conn)?;

            let user: User = u::users.find(user_id).first(conn)?;

            let export = DataExport {
                exported_at: Utc::now(),
                user: u::users
                    .find(user_id)
                    .select(ExportUser::as_select())
                    .first(conn)?,
                sessions: s::sessions
                    .filter(s::user_id.eq(user_id))
                    .select(ExportSession::as_select())
                    .load(conn)?,
                friend_requests: fr::friend_requests
                    .filter(fr::sender_id.eq(user_id).or(fr::receiver_id.eq(user_id)))
                    .select(ExportFriendRequest::as_select())
                    .load(conn)?,
                notifications: n::notifications
                    .filter(n::user_id.eq(user_id))
                    .select(ExportNotification::as_select())
                    .load(conn)?,
                avatar_large_base64: al::avatars_large
                    .filter(al::user_id.eq(user_id))
                    .first::<AvatarLarge>(conn)
                    .optional()?
                    .map(|a| base64std.encode(&a.data)),
                avatar_small_base64: as_::avatars_small
                    .filter(as_::user_id.eq(user_id))
                    .first::<AvatarSmall>(conn)
                    .optional()?
                    .map(|a| base64std.encode(&a.data)),
            };

            Ok::<_, ApiError>((export, user))
        })
        .await??;

    // Best-effort notification.
    let _ = mailer
        .send(&user_for_email, TransactionalEmail::DataExported)
        .await;

    res.render(Json(export_data));
    Ok(())
}
