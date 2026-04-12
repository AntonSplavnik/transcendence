use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;

use crate::auth::export_data::DataExport;
use crate::auth::gdpr_common::InitiateResponse;
use crate::auth::router::PasswordInput;
use crate::db::Database;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ───────────────────────────────

impl mock::User<mock::Registered> {
    /// Initiate data export with correct password.
    pub(crate) async fn initiate_export(&mut self) -> InitiateResponse {
        let mut res = self.try_initiate_export().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "export initiation should succeed"
        );
        res.take_json().await.unwrap()
    }

    /// Initiate data export, returning the raw response.
    pub async fn try_initiate_export(&mut self) -> salvo::Response {
        let mfa_code = self.mfa_code().await;
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code,
        };
        let req = self.client.post("/api/user/export-my-data").json(&body);
        self.client.send(req).await
    }

    /// Initiate export with wrong password (supplies correct MFA if enrolled).
    pub async fn try_initiate_export_wrong_pw(&mut self) -> salvo::Response {
        let mfa_code = self.mfa_code().await;
        let body = PasswordInput {
            password: "wrong-password".to_string(),
            mfa_code,
        };
        let req = self.client.post("/api/user/export-my-data").json(&body);
        self.client.send(req).await
    }

    /// Execute data export with the given token, asserting 200 OK.
    pub(crate) async fn execute_export(&mut self, token: &str) -> DataExport {
        let mut res = self.try_execute_export(token).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "export execution should succeed"
        );
        res.take_json().await.unwrap()
    }

    /// Execute data export, returning the raw response.
    pub async fn try_execute_export(&mut self, token: &str) -> salvo::Response {
        let mfa_code = self.mfa_code().await;
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code,
        };
        let req = self
            .client
            .post(format!("/api/user/export-my-data?token={token}"))
            .json(&body);
        self.client.send(req).await
    }

    /// Execute export with wrong password (supplies correct MFA if enrolled).
    pub async fn try_execute_export_wrong_pw(&mut self, token: &str) -> salvo::Response {
        let mfa_code = self.mfa_code().await;
        let body = PasswordInput {
            password: "wrong-password".to_string(),
            mfa_code,
        };
        let req = self
            .client
            .post(format!("/api/user/export-my-data?token={token}"))
            .json(&body);
        self.client.send(req).await
    }
}

// ── Tests ─────────────────────────────────────────────────────────

// ── Initiation: happy path ─────────────────────────────────────────────────

#[tokio::test]
async fn initiate_export_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_export().await;
    assert!(!resp.token.is_empty(), "token must not be empty");
    assert!(
        !resp.email_confirmation_required,
        "no email confirmation required for unconfirmed email"
    );
}

#[tokio::test]
async fn initiate_export_confirmed_email_requires_confirmation() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.confirm_email(&server).await;

    let resp = user.initiate_export().await;
    assert!(
        resp.email_confirmation_required,
        "confirmed email must require email confirmation"
    );
}

// ── Initiation: auth / password guards ─────────────────────────────────────

#[tokio::test]
async fn initiate_export_unauthenticated_rejected() {
    let server = mock::Server::default();
    let user = server.user().register().await;

    user.assert_requires_auth(|c| {
        c.post("/api/user/export-my-data").json(&PasswordInput {
            password: "irrelevant".to_string(),
            mfa_code: None,
        })
    })
    .await;
}

#[tokio::test]
async fn initiate_export_wrong_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user.try_initiate_export_wrong_pw().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "wrong password must be rejected"
    );
}

// ── Initiation: idempotency ────────────────────────────────────────────────

#[tokio::test]
async fn initiate_export_idempotent_reuses_token() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp1 = user.initiate_export().await;
    let resp2 = user.initiate_export().await;

    assert_eq!(
        resp1.token, resp2.token,
        "repeated initiation must return the same token"
    );
}

// ── Execution: happy path ──────────────────────────────────────────────────

#[tokio::test]
async fn execute_export_returns_user_data() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_export().await;
    let export = user.execute_export(&resp.token).await;

    assert_eq!(
        export.user.id,
        user.user_id(),
        "exported user id must match"
    );
    assert_eq!(
        export.user.email,
        user.email.as_ref(),
        "exported email must match"
    );
    assert_eq!(
        export.user.nickname,
        user.nickname.to_string(),
        "exported nickname must match"
    );
    assert!(
        !export.sessions.is_empty(),
        "should have at least one active session"
    );
}

#[tokio::test]
async fn execute_export_includes_friend_requests() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let user2 = server.user().register().await;

    // Seed a friend request from user to user2.
    let u1_id = user.user_id();
    let u2_id = user2.user_id();
    server
        .db
        .write(move |conn| {
            use crate::schema::friend_requests::dsl::*;
            use diesel::prelude::*;
            diesel::insert_into(friend_requests)
                .values((
                    sender_id.eq(u1_id),
                    receiver_id.eq(u2_id),
                    status.eq(0),
                    created_at.eq(chrono::Utc::now()),
                    updated_at.eq(chrono::Utc::now()),
                ))
                .execute(conn)
        })
        .await
        .unwrap()
        .unwrap();

    let resp = user.initiate_export().await;
    let export = user.execute_export(&resp.token).await;

    assert_eq!(
        export.friend_requests.len(),
        1,
        "export must include the friend request"
    );
    assert_eq!(
        export.friend_requests[0].sender_id, u1_id,
        "sender_id must match"
    );
    assert_eq!(
        export.friend_requests[0].receiver_id, u2_id,
        "receiver_id must match"
    );
}

// ── Execution: sensitive field leakage ────────────────────────────────────

#[tokio::test]
async fn execute_export_excludes_sensitive_fields() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_export().await;
    let mut res = user.try_execute_export(&resp.token).await;
    let body = res.take_string().await.unwrap();

    assert!(
        !body.contains("password_hash"),
        "must not leak password_hash"
    );
    assert!(
        !body.contains("totp_secret_enc"),
        "must not leak totp_secret_enc"
    );
    assert!(
        !body.contains("token_hash"),
        "must not leak session token_hash"
    );
    assert!(
        !body.contains("email_confirmation_token_hash"),
        "must not leak email confirmation token hash"
    );
}

// ── Execution: auth / password guards ─────────────────────────────────────

#[tokio::test]
async fn execute_export_unauthenticated_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_export().await;

    user.assert_requires_auth(|c| {
        c.post(format!("/api/user/export-my-data?token={}", resp.token))
            .json(&PasswordInput {
                password: "irrelevant".to_string(),
                mfa_code: None,
            })
    })
    .await;
}

#[tokio::test]
async fn execute_export_wrong_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_export().await;
    let res = user.try_execute_export_wrong_pw(&resp.token).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "wrong password must be rejected on execution"
    );
}

// ── Execution: invalid state transitions ──────────────────────────────────

#[tokio::test]
async fn execute_export_without_initiation_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user
        .try_execute_export("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        .await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "execution without initiation must be rejected"
    );
}

#[tokio::test]
async fn execute_export_invalid_token_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    user.initiate_export().await;
    let res = user
        .try_execute_export("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        .await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "invalid token must be rejected"
    );
}

#[tokio::test]
async fn execute_export_email_confirmation_pending_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.confirm_email(&server).await;

    // Initiate — produces a confirm_token because email is confirmed.
    let resp = user.initiate_export().await;
    assert!(
        resp.email_confirmation_required,
        "confirmed email must require confirmation"
    );

    // Try to execute without clicking the email link — must be rejected.
    let res = user.try_execute_export(&resp.token).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "execute with email confirmation pending must return 403"
    );
}

#[tokio::test]
async fn execute_export_double_execute_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_export().await;
    // First execution — succeeds and removes the export request row.
    user.execute_export(&resp.token).await;

    // Second execution — row is gone, must return 400.
    let res = user.try_execute_export(&resp.token).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "second execution must fail: export request row was consumed"
    );
}

// ── Execution: mutation side-effects ──────────────────────────────────────

#[tokio::test]
async fn export_request_row_cleaned_after_execution() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let uid = user.user_id();

    let resp = user.initiate_export().await;
    user.execute_export(&resp.token).await;

    let count = server
        .db
        .read(move |conn| {
            use crate::schema::data_export_requests::dsl::*;
            use diesel::prelude::*;
            data_export_requests
                .filter(user_id.eq(uid))
                .count()
                .get_result::<i64>(conn)
        })
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        count, 0,
        "export request row must be removed after execution"
    );
}

#[tokio::test]
async fn execute_export_notification_email_skipped_for_unconfirmed() {
    // Notification emails are best-effort and require a confirmed email.
    // For unconfirmed users, the email is silently skipped (not an error).
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_export().await;
    server.mailer.take_emails(); // clear any prior emails
    user.execute_export(&resp.token).await;

    let emails = server.mailer.sent_emails();
    assert!(
        !emails
            .iter()
            .any(|e| matches!(e.email, crate::email::TransactionalEmail::DataExported)),
        "unconfirmed email user should not receive notification"
    );
}

#[tokio::test]
async fn execute_export_sends_notification_for_confirmed_email() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Confirm the email so the notification email is actually sent.
    user.confirm_email(&server).await;

    let resp = user.initiate_export().await;
    // Initiation sends a confirmation email; drain it.
    server.mailer.take_emails();

    // Clear the confirm_token so execution proceeds.
    let user_id = user.user_id();
    server
        .db
        .write(move |conn| {
            use crate::schema::data_export_requests::dsl as der;
            use diesel::prelude::*;
            diesel::update(der::data_export_requests.filter(der::user_id.eq(user_id)))
                .set(der::confirm_token.eq(None::<Vec<u8>>))
                .execute(conn)
        })
        .await
        .unwrap()
        .unwrap();

    user.execute_export(&resp.token).await;

    let emails = server.mailer.sent_emails();
    assert!(
        emails
            .iter()
            .any(|e| matches!(e.email, crate::email::TransactionalEmail::DataExported)),
        "confirmed email user should receive DataExported notification"
    );
}

#[tokio::test]
async fn execute_export_sessions_not_deleted() {
    // Unlike deletion, export must NOT remove sessions.
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let uid = user.user_id();

    let resp = user.initiate_export().await;
    user.execute_export(&resp.token).await;

    let session_count = server
        .db
        .read(move |conn| {
            use crate::schema::sessions::dsl::*;
            use diesel::prelude::*;
            sessions
                .filter(user_id.eq(uid))
                .count()
                .get_result::<i64>(conn)
        })
        .await
        .unwrap()
        .unwrap();

    assert!(
        session_count > 0,
        "sessions must NOT be cleared by a data export"
    );
}

#[tokio::test]
async fn execute_export_user_still_accessible_after_export() {
    // Export must not touch the user record — /api/user/me should still work.
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_export().await;
    user.execute_export(&resp.token).await;

    let info = user.me().await;
    assert_eq!(
        info.user.id,
        user.user_id(),
        "user must remain accessible after export"
    );
}

// ── Email confirmation flow ────────────────────────────────────────────────

#[tokio::test]
async fn confirm_export_missing_params_returns_error_html() {
    let server = mock::Server::default();
    let mut client = server.client();

    let req = client.get("/api/gdpr/confirm-data-export");
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "missing query params must return 400"
    );
}

#[tokio::test]
async fn confirm_export_invalid_base64_token_returns_error_html() {
    let server = mock::Server::default();
    let mut client = server.client();

    // Contains characters not valid in base64url.
    let req = client.get("/api/gdpr/confirm-data-export?user_id=999&token=bad+token!!!");
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "invalid base64 token must return 400"
    );
}

#[tokio::test]
async fn confirm_export_invalid_token_returns_error_html() {
    let server = mock::Server::default();
    let mut client = server.client();

    // Valid base64url but no matching DB row.
    let fake_token = base64url.encode([0u8; 32]);
    let req = client.get(format!(
        "/api/gdpr/confirm-data-export?user_id=999&token={fake_token}"
    ));
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "unknown token must return 400"
    );
}

#[tokio::test]
async fn confirm_export_happy_path_clears_confirm_token() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    let user_id = user.user_id();

    // Create an export request row with a known confirm_token.
    let confirm_token = rand::random::<[u8; 32]>().to_vec();
    let main_token = rand::random::<[u8; 32]>().to_vec();
    let ct = confirm_token.clone();
    let mt = main_token.clone();
    server
        .db
        .write(move |conn| {
            use crate::schema::data_export_requests::dsl as der;
            use diesel::prelude::*;
            diesel::insert_into(der::data_export_requests)
                .values(crate::models::DataExportRequest {
                    user_id,
                    token: mt,
                    confirm_token: Some(ct),
                    expires_at: chrono::Utc::now() + chrono::Duration::minutes(30),
                })
                .execute(conn)
        })
        .await
        .unwrap()
        .unwrap();

    // Hit the confirm endpoint.
    let encoded_confirm = base64url.encode(&confirm_token);
    let mut client = server.client();
    let req = client.get(format!(
        "/api/gdpr/confirm-data-export?user_id={user_id}&token={encoded_confirm}"
    ));
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "confirm link with valid token must return 200"
    );

    // The confirm_token must now be NULL in the DB.
    let row = server
        .db
        .read(move |conn| {
            use crate::schema::data_export_requests::dsl as der;
            use diesel::prelude::*;
            der::data_export_requests
                .filter(der::user_id.eq(user_id))
                .first::<crate::models::DataExportRequest>(conn)
        })
        .await
        .unwrap()
        .unwrap();

    assert!(
        row.confirm_token.is_none(),
        "confirm_token must be cleared after email confirmation"
    );
}

#[tokio::test]
async fn confirm_export_reuse_fails() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    let user_id = user.user_id();

    let confirm_token = rand::random::<[u8; 32]>().to_vec();
    let main_token = rand::random::<[u8; 32]>().to_vec();
    let ct = confirm_token.clone();
    let mt = main_token.clone();
    server
        .db
        .write(move |conn| {
            use crate::schema::data_export_requests::dsl as der;
            use diesel::prelude::*;
            diesel::insert_into(der::data_export_requests)
                .values(crate::models::DataExportRequest {
                    user_id,
                    token: mt,
                    confirm_token: Some(ct),
                    expires_at: chrono::Utc::now() + chrono::Duration::minutes(30),
                })
                .execute(conn)
        })
        .await
        .unwrap()
        .unwrap();

    let encoded_confirm = base64url.encode(&confirm_token);
    let mut client = server.client();

    // First use — succeeds and clears confirm_token.
    let req = client.get(format!(
        "/api/gdpr/confirm-data-export?user_id={user_id}&token={encoded_confirm}"
    ));
    let res = client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    // Second use of same confirm_token — confirm_token is now NULL, must return 400.
    let req2 = client.get(format!(
        "/api/gdpr/confirm-data-export?user_id={user_id}&token={encoded_confirm}"
    ));
    let res2 = client.send(req2).await;
    assert_eq!(
        res2.status_code,
        Some(StatusCode::BAD_REQUEST),
        "reuse of confirm token must return 400"
    );
}
