use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;
use chrono::{Duration, Utc};
use diesel::prelude::*;
use salvo::http::StatusCode;
use salvo::oapi::extract::QueryParam;

use super::{EmailSender, TransactionalEmail};
use crate::models::User;
use crate::prelude::*;

// ── Token ────────────────────────────────────────────────────────────────

/// A 256-bit random email-confirmation token, base64url-encoded for URLs.
/// Only the blake3 hash is stored in the database.
pub struct ConfirmationToken([u8; 32]);

impl ConfirmationToken {
    #[must_use]
    pub fn generate() -> Self {
        Self(rand::random())
    }

    #[must_use]
    pub fn to_hash(&self) -> Vec<u8> {
        blake3::hash(&self.0).as_bytes().to_vec()
    }

    #[must_use]
    pub fn encoded(&self) -> String {
        base64url.encode(self.0)
    }

    /// # Errors
    /// Returns [`EmailConfirmationError::InvalidToken`] if `s` is not valid base64url or not exactly 32 bytes.
    pub fn from_encoded(s: &str) -> Result<Self, EmailConfirmationError> {
        let decoded = base64url
            .decode(s.as_bytes())
            .map_err(|_| EmailConfirmationError::InvalidToken)?;
        let bytes: [u8; 32] = decoded
            .try_into()
            .map_err(|_| EmailConfirmationError::InvalidToken)?;
        Ok(Self(bytes))
    }
}

// ── Error ────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum EmailConfirmationError {
    #[error("email is not confirmed")]
    UnconfirmedEmail,
    #[error("email is already confirmed")]
    AlreadyConfirmed,
    #[error("invalid or expired confirmation token")]
    InvalidToken,
}

// ── Logic ────────────────────────────────────────────────────────────────

/// Gate function: returns `Ok(())` if the user's email is confirmed.
///
/// # Errors
/// Returns [`EmailConfirmationError::UnconfirmedEmail`] if the user has not yet confirmed their email address.
pub fn require_email_confirmed(user: &User) -> Result<(), EmailConfirmationError> {
    if user.email_confirmed_at.is_some() {
        Ok(())
    } else {
        Err(EmailConfirmationError::UnconfirmedEmail)
    }
}

/// Generate a confirmation token, store its hash in the DB, and send the email.
///
/// # Errors
/// Returns [`ApiError`] if the user is not found, the email is already confirmed,
/// the database write fails, or sending the confirmation email fails.
pub async fn send_confirmation_email(
    mailer: &Mailer,
    db: &Db,
    user_id: i32,
) -> Result<(), ApiError> {
    let token = ConfirmationToken::generate();
    let token_hash = token.to_hash();
    let encoded = token.encoded();
    let expires_at = Utc::now() + Duration::hours(24);

    let user = db
        .write(move |conn| {
            use crate::schema::users::dsl::*;

            conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
                let user: User = users.find(user_id).first(conn)?;

                if user.email_confirmed_at.is_some() {
                    return Ok(Err(EmailConfirmationError::AlreadyConfirmed));
                }

                let user_email = user.email.clone();

                diesel::update(users.find(user_id))
                    .set((
                        email_confirmation_token_hash.eq(Some(&token_hash)),
                        email_confirmation_token_expires_at.eq(Some(expires_at)),
                        email_confirmation_token_email.eq(Some(&user_email)),
                    ))
                    .execute(conn)?;

                Ok(Ok(user))
            })
        })
        .await?
        .map_err(ApiError::from)?
        .map_err(ApiError::from)?;

    mailer
        .send(
            &user,
            TransactionalEmail::EmailConfirmation {
                confirmation_token: encoded,
            },
        )
        .await?;

    Ok(())
}

/// Verify the raw token, mark the email as confirmed, and clear token columns.
///
/// # Errors
/// Returns [`ApiError`] if the token is invalid, expired, or the database write fails.
pub async fn confirm_email(db: &Db, raw_token: &str) -> Result<(), ApiError> {
    let token = ConfirmationToken::from_encoded(raw_token)?;
    let token_hash = token.to_hash();

    db.write(move |conn| {
        use crate::schema::users::dsl::*;

        conn.immediate_transaction::<_, diesel::result::Error, _>(|conn| {
            let user: User = match users
                .filter(email_confirmation_token_hash.eq(Some(&token_hash)))
                .first(conn)
            {
                Ok(u) => u,
                Err(_) => return Ok(Err(EmailConfirmationError::InvalidToken)),
            };

            let Some(expires) = user.email_confirmation_token_expires_at else {
                return Ok(Err(EmailConfirmationError::InvalidToken));
            };

            if Utc::now() > expires {
                return Ok(Err(EmailConfirmationError::InvalidToken));
            }

            // Reject if the email changed since the token was issued
            let Some(token_email) = user.email_confirmation_token_email.as_deref() else {
                return Ok(Err(EmailConfirmationError::InvalidToken));
            };

            if token_email != user.email {
                return Ok(Err(EmailConfirmationError::InvalidToken));
            }

            // Include token_hash in WHERE to guard against concurrent modifications
            let updated = diesel::update(
                users
                    .find(user.id)
                    .filter(email_confirmation_token_hash.eq(Some(&token_hash))),
            )
            .set((
                email_confirmed_at.eq(Some(Utc::now())),
                email_confirmation_token_hash.eq(None::<Vec<u8>>),
                email_confirmation_token_expires_at.eq(None::<chrono::DateTime<chrono::Utc>>),
                email_confirmation_token_email.eq(None::<String>),
            ))
            .execute(conn)?;

            if updated != 1 {
                return Ok(Err(EmailConfirmationError::InvalidToken));
            }

            Ok(Ok(()))
        })
    })
    .await?
    .map_err(ApiError::from)?
    .map_err(ApiError::from)
}

// ── Router / Endpoints ───────────────────────────────────────────────────

#[must_use]
pub fn router(path: &str) -> Router {
    Router::with_path(path).oapi_tag("email").append(&mut vec![
        Router::with_path("send-confirmation")
            .requires_user_login()
            .user_rate_limit(&RateLimit::per_minute(2))
            .user_rate_limit(&RateLimit::per_day(10))
            .post(send_confirmation),
        Router::with_path("confirm")
            .ip_rate_limit(&RateLimit::per_minute(10))
            .ip_rate_limit(&RateLimit::per_day(100))
            .get(confirm),
    ])
}

/// Send a confirmation email to the authenticated user.
#[endpoint]
async fn send_confirmation(depot: &mut Depot, db: Db) -> AppResult<()> {
    let user_id = depot.user_id();
    let mailer = depot.mailer().clone();
    send_confirmation_email(&mailer, &db, user_id).await?;
    Ok(())
}

/// Confirm an email address via magic link (returns HTML).
#[endpoint]
async fn confirm(token: QueryParam<String, false>, res: &mut Response, db: Db) {
    use crate::utils::html_action_result_card;

    let Some(token) = token.into_inner() else {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(salvo::writing::Text::Html(html_action_result_card(
            "Confirmation Failed",
            "Confirmation Failed",
            false,
            "This confirmation link is invalid or has expired. Please request a new one.",
        )));
        return;
    };

    match confirm_email(&db, &token).await {
        Ok(()) => {
            res.render(salvo::writing::Text::Html(html_action_result_card(
                "Email Confirmed",
                "Email Confirmed",
                true,
                "Your email has been confirmed. You can close this tab.",
            )));
        }
        Err(ApiError::EmailConfirmation(EmailConfirmationError::InvalidToken)) => {
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(salvo::writing::Text::Html(html_action_result_card(
                "Confirmation Failed",
                "Confirmation Failed",
                false,
                "This confirmation link is invalid or has expired. Please request a new one.",
            )));
        }
        Err(_) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(salvo::writing::Text::Html(html_action_result_card(
                "Confirmation Failed",
                "Something Went Wrong",
                false,
                "An unexpected error occurred. Please try again later.",
            )));
        }
    }
}

// ── Unit tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod unit_tests {
    use super::*;

    /// Minimal `User` with all fields defaulted. Tests override only what they care about.
    fn test_user() -> User {
        User {
            id: 1,
            email: "a@b.c".into(),
            nickname: crate::models::nickname::Nickname::from_str("test"),
            totp_enabled: false,
            totp_secret_enc: None,
            totp_confirmed_at: None,
            password_hash: String::new(),
            created_at: chrono::Utc::now(),
            description: String::new(),
            tos_accepted_at: None,
            email_confirmed_at: None,
            email_confirmation_token_hash: None,
            email_confirmation_token_expires_at: None,
            email_confirmation_token_email: None,
        }
    }

    #[test]
    fn generate_encode_from_encoded_roundtrip() {
        let token = ConfirmationToken::generate();
        let encoded = token.encoded();
        let decoded = ConfirmationToken::from_encoded(&encoded).expect("roundtrip should succeed");
        assert_eq!(token.0, decoded.0, "decoded bytes must match original");
    }

    #[test]
    fn from_encoded_invalid_base64_returns_invalid_token() {
        let result = ConfirmationToken::from_encoded("!!!not-base64!!!");
        assert!(
            matches!(result, Err(EmailConfirmationError::InvalidToken)),
            "invalid base64 must produce InvalidToken"
        );
    }

    #[test]
    fn from_encoded_wrong_length_returns_invalid_token() {
        let short = base64url.encode([0u8; 16]);
        let result = ConfirmationToken::from_encoded(&short);
        assert!(
            matches!(result, Err(EmailConfirmationError::InvalidToken)),
            "wrong-length input must produce InvalidToken"
        );
    }

    #[test]
    fn to_hash_is_deterministic() {
        let token = ConfirmationToken([42u8; 32]);
        assert_eq!(
            token.to_hash(),
            token.to_hash(),
            "same token must hash identically"
        );
    }

    #[test]
    fn different_tokens_produce_different_hashes() {
        let t1 = ConfirmationToken([1u8; 32]);
        let t2 = ConfirmationToken([2u8; 32]);
        assert_ne!(
            t1.to_hash(),
            t2.to_hash(),
            "different tokens must produce different hashes"
        );
    }

    #[test]
    fn require_email_confirmed_with_confirmed_user() {
        let user = User {
            email_confirmed_at: Some(chrono::Utc::now()),
            ..test_user()
        };
        assert!(
            require_email_confirmed(&user).is_ok(),
            "confirmed user must pass the gate"
        );
    }

    #[test]
    fn require_email_confirmed_with_unconfirmed_user() {
        let user = test_user();
        let err = require_email_confirmed(&user).unwrap_err();
        assert!(
            matches!(err, EmailConfirmationError::UnconfirmedEmail),
            "unconfirmed user must produce UnconfirmedEmail"
        );
    }

    #[test]
    fn encoded_token_has_expected_length() {
        // base64url (no padding) of 32 bytes = ceil(32 * 4 / 3) = 43 chars
        let token = ConfirmationToken([0u8; 32]);
        assert_eq!(
            token.encoded().len(),
            43,
            "base64url encoding of 32 bytes must be 43 characters"
        );
    }

    #[test]
    fn hash_is_32_bytes() {
        let token = ConfirmationToken([7u8; 32]);
        assert_eq!(
            token.to_hash().len(),
            32,
            "blake3 hash output must be 32 bytes"
        );
    }

    #[test]
    fn hash_differs_from_raw_token_bytes() {
        let raw = [0xab_u8; 32];
        let token = ConfirmationToken(raw);
        assert_ne!(
            token.to_hash(),
            raw.to_vec(),
            "stored hash must differ from the raw token bytes"
        );
    }

    #[test]
    fn from_encoded_empty_string_returns_invalid_token() {
        let result = ConfirmationToken::from_encoded("");
        assert!(
            matches!(result, Err(EmailConfirmationError::InvalidToken)),
            "empty string must produce InvalidToken"
        );
    }
}
