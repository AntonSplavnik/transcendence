use chrono::{Duration, Utc};
use diesel::prelude::*;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

use crate::db::Database;
use crate::email::TransactionalEmail;
use crate::utils::mock;

// ── Ergonomic helpers on mock::User ─────────────────────────────────────

impl mock::User<mock::Registered> {
    /// Send a confirmation email for this user, asserting 200 OK.
    pub async fn send_confirmation_email(&mut self) {
        let res = self.try_send_confirmation_email().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "send_confirmation_email must succeed for user {}",
            self.user_id()
        );
    }

    /// Send a confirmation email request without asserting on the outcome.
    pub async fn try_send_confirmation_email(&mut self) -> salvo::Response {
        let req = self.client.post("/api/email/send-confirmation");
        self.client.send(req).await
    }

    /// Send a confirmation email and click the link, confirming this user's email address.
    ///
    /// Asserts every step succeeds. Drains any accumulated emails from the mock mailer
    /// before sending so the token extraction always finds exactly one email.
    pub async fn confirm_email(&mut self, server: &mock::Server) {
        server.mailer.take_emails(); // drain stale mail
        self.send_confirmation_email().await;

        let token = server
            .mailer
            .take_emails()
            .into_iter()
            .find_map(|e| {
                if let TransactionalEmail::EmailConfirmation { confirmation_token } = e.email {
                    Some(confirmation_token)
                } else {
                    None
                }
            })
            .expect("no EmailConfirmation found in mock mailer after send_confirmation_email");

        let mut anon = server.client();
        let req = anon.get(format!("/api/email/confirm?token={token}"));
        let res = anon.send(req).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "email confirmation must succeed for user {}",
            self.user_id()
        );
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Extract the raw confirmation token from the first (and only) captured email.
fn extract_token_from_mock(server: &mock::Server) -> String {
    let emails = server.mailer.take_emails();
    assert_eq!(emails.len(), 1, "exactly one email should have been sent");
    match &emails[0].email {
        TransactionalEmail::EmailConfirmation {
            confirmation_token, ..
        } => confirmation_token.clone(),
        _ => panic!("expected EmailConfirmation variant"),
    }
}

// ── Tests ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn happy_path_send_then_confirm() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Send confirmation email
    let req = user.client.post("/api/email/send-confirmation");
    let res = user.client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    // Extract token from mock mailer
    let token = extract_token_from_mock(&server);

    // Confirm the email
    let mut client = server.client();
    let req = client.get(format!("/api/email/confirm?token={token}"));
    let mut res = client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    let body = res.take_string().await.unwrap();
    assert!(
        body.contains("Email Confirmed"),
        "success page must contain 'Email Confirmed'"
    );
}

#[tokio::test]
async fn send_confirmation_unauthenticated_returns_401() {
    let server = mock::Server::default();
    let mut client = server.client();

    let req = client.post("/api/email/send-confirmation");
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "unauthenticated send-confirmation must return 401"
    );
}

#[tokio::test]
async fn send_confirmation_already_confirmed_returns_409() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Mark the user as already confirmed directly in the DB to avoid rate limits.
    let uid = user.user_id();
    server
        .db
        .write(move |conn| {
            use crate::schema::users::dsl::*;
            diesel::update(users.find(uid))
                .set(email_confirmed_at.eq(Some(Utc::now())))
                .execute(conn)
        })
        .await
        .unwrap()
        .unwrap();

    // Try to send confirmation — user is already confirmed
    let req = user.client.post("/api/email/send-confirmation");
    let res = user.client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::CONFLICT),
        "already-confirmed user must get 409"
    );
}

#[tokio::test]
async fn confirm_invalid_token_returns_error_html() {
    let server = mock::Server::default();
    let mut client = server.client();

    let req = client.get("/api/email/confirm?token=totallyinvalidtoken");
    let mut res = client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::BAD_REQUEST));

    let body = res.take_string().await.unwrap();
    assert!(
        body.contains("Confirmation Failed"),
        "error page must contain 'Confirmation Failed'"
    );
}

#[tokio::test]
async fn confirm_expired_token_returns_error_html() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Send confirmation
    let req = user.client.post("/api/email/send-confirmation");
    user.client.send(req).await;
    let token = extract_token_from_mock(&server);

    // Expire the token in the DB
    let uid = user.user_id();
    server
        .db
        .write(move |conn| {
            use crate::schema::users::dsl::*;
            diesel::update(users.find(uid))
                .set(email_confirmation_token_expires_at.eq(Some(Utc::now() - Duration::hours(1))))
                .execute(conn)
        })
        .await
        .unwrap()
        .unwrap();

    // Try to confirm
    let mut anon = server.client();
    let req = anon.get(format!("/api/email/confirm?token={token}"));
    let mut res = anon.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::BAD_REQUEST));

    let body = res.take_string().await.unwrap();
    assert!(
        body.contains("Confirmation Failed"),
        "expired token must show error page"
    );
}

#[tokio::test]
async fn replay_protection_second_confirm_fails() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let req = user.client.post("/api/email/send-confirmation");
    user.client.send(req).await;
    let token = extract_token_from_mock(&server);

    // First confirm succeeds
    let mut anon = server.client();
    let req = anon.get(format!("/api/email/confirm?token={token}"));
    let res = anon.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    // Second confirm with same token fails
    let mut anon2 = server.client();
    let req = anon2.get(format!("/api/email/confirm?token={token}"));
    let mut res = anon2.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "replayed token must be rejected"
    );

    let body = res.take_string().await.unwrap();
    assert!(
        body.contains("Confirmation Failed"),
        "replayed token must show error page"
    );
}

#[tokio::test]
async fn email_changed_since_issuance_returns_error_html() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Send confirmation
    let req = user.client.post("/api/email/send-confirmation");
    user.client.send(req).await;
    let token = extract_token_from_mock(&server);

    // Change the user's email in the DB after token was issued
    let uid = user.user_id();
    server
        .db
        .write(move |conn| {
            use crate::schema::users::dsl::*;
            diesel::update(users.find(uid))
                .set(email.eq("changed@example.com"))
                .execute(conn)
        })
        .await
        .unwrap()
        .unwrap();

    // Try to confirm — should fail because email changed
    let mut anon = server.client();
    let req = anon.get(format!("/api/email/confirm?token={token}"));
    let mut res = anon.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::BAD_REQUEST));

    let body = res.take_string().await.unwrap();
    assert!(
        body.contains("Confirmation Failed"),
        "email-changed-since-issuance must show error page"
    );
}

#[tokio::test]
async fn confirm_missing_token_query_param_returns_error_html() {
    let server = mock::Server::default();
    let mut client = server.client();

    let req = client.get("/api/email/confirm");
    let mut res = client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::BAD_REQUEST));

    let body = res.take_string().await.unwrap();
    assert!(
        body.contains("Confirmation Failed"),
        "missing token param must show error page"
    );
}

#[tokio::test]
async fn user_json_does_not_leak_sensitive_token_fields() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Send a confirmation so token columns are populated
    let req = user.client.post("/api/email/send-confirmation");
    user.client.send(req).await;
    let _ = server.mailer.take_emails(); // drain

    // Fetch user JSON via /api/user/me
    let req = user.client.get("/api/user/me");
    let mut res = user.client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    let body = res.take_string().await.unwrap();
    assert!(
        !body.contains("email_confirmation_token_hash"),
        "response must not leak token_hash"
    );
    assert!(
        !body.contains("email_confirmation_token_expires_at"),
        "response must not leak token_expires_at"
    );
    assert!(
        !body.contains("email_confirmation_token_email"),
        "response must not leak token_email"
    );
}

#[tokio::test]
async fn send_confirmation_stores_token_and_email_snapshot_in_db() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let user_email = user.email.to_string();

    let req = user.client.post("/api/email/send-confirmation");
    let res = user.client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    // Verify DB state
    let uid = user.user_id();
    let (tok_hash, tok_expires, tok_email): (
        Option<Vec<u8>>,
        Option<chrono::DateTime<chrono::Utc>>,
        Option<String>,
    ) = server
        .db
        .read(move |conn| {
            use crate::schema::users::dsl::*;
            users
                .find(uid)
                .select((
                    email_confirmation_token_hash,
                    email_confirmation_token_expires_at,
                    email_confirmation_token_email,
                ))
                .first(conn)
                .unwrap()
        })
        .await
        .unwrap();

    assert!(tok_hash.is_some(), "token hash must be stored");
    assert!(tok_expires.is_some(), "token expiry must be stored");
    assert_eq!(
        tok_email.as_deref(),
        Some(user_email.as_str()),
        "token email snapshot must match user email at time of issuance"
    );

    // Verify expiry is roughly 24h from now
    let expires = tok_expires.unwrap();
    let diff = expires - Utc::now();
    assert!(
        diff > Duration::hours(23) && diff < Duration::hours(25),
        "token expiry should be approximately 24 hours from now, got {}h",
        diff.num_hours()
    );
}

#[tokio::test]
async fn send_confirmation_new_token_overwrites_old_token() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // First confirmation email → token A
    user.send_confirmation_email().await;
    let token_a = extract_token_from_mock(&server);

    // Second confirmation email → token B (overwrites token A in DB)
    user.send_confirmation_email().await;
    let token_b = extract_token_from_mock(&server);

    assert_ne!(token_a, token_b, "each issuance must produce a distinct token");

    // Token A must now be invalid (its hash was overwritten)
    let mut anon = server.client();
    let req = anon.get(format!("/api/email/confirm?token={token_a}"));
    let mut res = anon.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "old token must be rejected after a new one is issued"
    );
    let body = res.take_string().await.unwrap();
    assert!(
        body.contains("Confirmation Failed"),
        "old token must show error page"
    );

    // Token B must still be valid
    let mut anon2 = server.client();
    let req = anon2.get(format!("/api/email/confirm?token={token_b}"));
    let res = anon2.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "new token must confirm successfully"
    );
}

#[tokio::test]
async fn confirm_email_sets_confirmed_at_in_db() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let uid = user.user_id();

    user.send_confirmation_email().await;
    let token = extract_token_from_mock(&server);

    // Before confirmation: email_confirmed_at must be NULL
    let confirmed_before: Option<chrono::DateTime<Utc>> = server
        .db
        .read(move |conn| {
            use crate::schema::users::dsl::*;
            users
                .find(uid)
                .select(email_confirmed_at)
                .first(conn)
                .unwrap()
        })
        .await
        .unwrap();
    assert!(
        confirmed_before.is_none(),
        "email_confirmed_at must be NULL before confirmation"
    );

    // Confirm the email
    let mut anon = server.client();
    let req = anon.get(format!("/api/email/confirm?token={token}"));
    let res = anon.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    // After confirmation: email_confirmed_at must be set and token columns cleared
    let (confirmed_after, tok_hash, tok_expires, tok_email): (
        Option<chrono::DateTime<Utc>>,
        Option<Vec<u8>>,
        Option<chrono::DateTime<Utc>>,
        Option<String>,
    ) = server
        .db
        .read(move |conn| {
            use crate::schema::users::dsl::*;
            users
                .find(uid)
                .select((
                    email_confirmed_at,
                    email_confirmation_token_hash,
                    email_confirmation_token_expires_at,
                    email_confirmation_token_email,
                ))
                .first(conn)
                .unwrap()
        })
        .await
        .unwrap();

    assert!(
        confirmed_after.is_some(),
        "email_confirmed_at must be set after confirmation"
    );
    assert!(
        tok_hash.is_none(),
        "token hash must be cleared after confirmation"
    );
    assert!(
        tok_expires.is_none(),
        "token expiry must be cleared after confirmation"
    );
    assert!(
        tok_email.is_none(),
        "token email snapshot must be cleared after confirmation"
    );
}

#[tokio::test]
async fn confirm_valid_format_but_unknown_token_rejected() {
    let server = mock::Server::default();
    // Use a well-formed token (valid base64url, 32 bytes) that was never stored
    let unknown_token = {
        use base64::Engine as _;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([0xde, 0xad, 0xbe, 0xef,
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
            0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
            0x19, 0x1a, 0x1b, 0x1c])
    };

    let mut client = server.client();
    let req = client.get(format!("/api/email/confirm?token={unknown_token}"));
    let mut res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "valid-format but unknown token must be rejected"
    );
    let body = res.take_string().await.unwrap();
    assert!(
        body.contains("Confirmation Failed"),
        "unknown token must show error page"
    );
}
