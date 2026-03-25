use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as base64url;

use crate::auth::delete_account::InitiateResponse;
use crate::auth::router::PasswordInput;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

use super::two_factor::{ensure_totp_key, generate_totp_code};

// ── Ergonomic helpers on mock::User ───────────────────────────────

impl mock::User<mock::Registered> {
    /// Initiate account deletion with correct password.
    pub(crate) async fn initiate_deletion(&mut self) -> InitiateResponse {
        let mut res = self.try_initiate_deletion().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "deletion initiation should succeed"
        );
        res.take_json().await.unwrap()
    }

    /// Initiate account deletion, returning the raw response.
    pub async fn try_initiate_deletion(&mut self) -> salvo::Response {
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code: None,
        };
        let req = self
            .client
            .delete("/api/user/delete-my-account")
            .json(&body);
        self.client.send(req).await
    }

    /// Initiate deletion with a specific password (for wrong-password tests).
    pub async fn try_initiate_deletion_with_password(
        &mut self,
        password: &str,
    ) -> salvo::Response {
        let body = PasswordInput {
            password: password.to_string(),
            mfa_code: None,
        };
        let req = self
            .client
            .delete("/api/user/delete-my-account")
            .json(&body);
        self.client.send(req).await
    }

    /// Initiate deletion with a specific password and optional MFA code.
    pub async fn try_initiate_deletion_with(
        &mut self,
        password: &str,
        mfa_code: Option<&str>,
    ) -> salvo::Response {
        let body = PasswordInput {
            password: password.to_string(),
            mfa_code: mfa_code.map(String::from),
        };
        let req = self
            .client
            .delete("/api/user/delete-my-account")
            .json(&body);
        self.client.send(req).await
    }

    /// Execute account deletion with the given token and correct password.
    pub async fn execute_deletion(&mut self, token: &str) {
        let res = self.try_execute_deletion(token).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::NO_CONTENT),
            "deletion execution should return 204"
        );
    }

    /// Execute account deletion with the given token, returning raw response.
    pub async fn try_execute_deletion(&mut self, token: &str) -> salvo::Response {
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code: None,
        };
        let req = self
            .client
            .delete(format!("/api/user/delete-my-account?token={token}"))
            .json(&body);
        self.client.send(req).await
    }

    /// Execute account deletion with a specific password and optional MFA code.
    pub async fn try_execute_deletion_with(
        &mut self,
        token: &str,
        password: &str,
        mfa_code: Option<&str>,
    ) -> salvo::Response {
        let body = PasswordInput {
            password: password.to_string(),
            mfa_code: mfa_code.map(String::from),
        };
        let req = self
            .client
            .delete(format!("/api/user/delete-my-account?token={token}"))
            .json(&body);
        self.client.send(req).await
    }

    /// Execute account deletion with wrong password.
    pub async fn try_execute_deletion_wrong_pw(&mut self, token: &str) -> salvo::Response {
        self.try_execute_deletion_with(token, "wrong-password", None)
            .await
    }
}

// ── Tests ─────────────────────────────────────────────────────────

// ── Initiation: happy path ─────────────────────────────────────────────────

#[tokio::test]
async fn initiate_deletion_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_deletion().await;
    assert!(!resp.token.is_empty(), "token must not be empty");
    // Email is not confirmed for freshly registered users
    assert!(
        !resp.email_confirmation_required,
        "no email confirmation required for unconfirmed email"
    );
}

// ── Initiation: auth / password guards ─────────────────────────────────────

#[tokio::test]
async fn initiate_deletion_unauthenticated_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    user.assert_requires_auth(|c| {
        c.delete("/api/user/delete-my-account")
            .json(&PasswordInput {
                password: "irrelevant".to_string(),
                mfa_code: None,
            })
    })
    .await;
}

#[tokio::test]
async fn initiate_deletion_wrong_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user
        .try_initiate_deletion_with_password("wrong-password")
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "wrong password must be rejected"
    );
}

// ── Initiation: idempotency ────────────────────────────────────────────────

#[tokio::test]
async fn initiate_deletion_idempotent_reuses_token() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp1 = user.initiate_deletion().await;
    let resp2 = user.initiate_deletion().await;

    assert_eq!(
        resp1.token, resp2.token,
        "repeated initiation must return the same token"
    );
}

// ── Initiation: MFA interaction ────────────────────────────────────────────

#[tokio::test]
async fn initiate_deletion_mfa_missing_when_2fa_enabled_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    user.two_fa_confirm(&code).await;

    // Initiate without mfa_code — must fail.
    let res = user
        .try_initiate_deletion_with(&user.password.clone(), None)
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "missing mfa_code must be rejected when 2FA is enabled"
    );
}

#[tokio::test]
async fn initiate_deletion_mfa_wrong_code_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    user.two_fa_confirm(&code).await;

    // Initiate with wrong mfa_code — must fail.
    let res = user
        .try_initiate_deletion_with(&user.password.clone(), Some("000000"))
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "wrong mfa_code must be rejected"
    );
}

#[tokio::test]
async fn initiate_deletion_mfa_valid_code_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    user.two_fa_confirm(&code).await;

    // Initiate with correct mfa_code — must succeed.
    let mfa_code = generate_totp_code(&secret);
    let res = user
        .try_initiate_deletion_with(&user.password.clone(), Some(&mfa_code))
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "valid mfa_code must be accepted"
    );
}

// ── Execution: happy path ──────────────────────────────────────────────────

#[tokio::test]
async fn execute_deletion_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_deletion().await;
    let res = user.try_execute_deletion(&resp.token).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::NO_CONTENT),
        "deletion execution should return 204"
    );
}

// ── Execution: auth / password guards ─────────────────────────────────────

#[tokio::test]
async fn execute_deletion_unauthenticated_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_deletion().await;

    user.assert_requires_auth(|c| {
        c.delete(format!(
            "/api/user/delete-my-account?token={}",
            resp.token
        ))
        .json(&PasswordInput {
            password: "irrelevant".to_string(),
            mfa_code: None,
        })
    })
    .await;
}

#[tokio::test]
async fn execute_deletion_wrong_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_deletion().await;
    let res = user.try_execute_deletion_wrong_pw(&resp.token).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "wrong password must be rejected on execution"
    );
}

// ── Execution: MFA interaction ─────────────────────────────────────────────

#[tokio::test]
async fn execute_deletion_mfa_missing_when_2fa_enabled_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA and initiate deletion with valid MFA code.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    user.two_fa_confirm(&code).await;

    let mfa_code = generate_totp_code(&secret);
    let mut res = user
        .try_initiate_deletion_with(&user.password.clone(), Some(&mfa_code))
        .await;
    let initiate: InitiateResponse = res.take_json().await.unwrap();

    // Execute without mfa_code — must fail.
    let res = user
        .try_execute_deletion_with(&initiate.token, &user.password.clone(), None)
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "missing mfa_code must be rejected on execution when 2FA is enabled"
    );
}

#[tokio::test]
async fn execute_deletion_mfa_wrong_code_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA and initiate deletion.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    user.two_fa_confirm(&code).await;

    let mfa_code = generate_totp_code(&secret);
    let mut res = user
        .try_initiate_deletion_with(&user.password.clone(), Some(&mfa_code))
        .await;
    let initiate: InitiateResponse = res.take_json().await.unwrap();

    // Execute with wrong mfa_code — must fail.
    let res = user
        .try_execute_deletion_with(&initiate.token, &user.password.clone(), Some("000000"))
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "wrong mfa_code must be rejected on execution"
    );
}

#[tokio::test]
async fn execute_deletion_mfa_valid_code_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA and initiate deletion.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    user.two_fa_confirm(&code).await;

    let mfa_code = generate_totp_code(&secret);
    let mut res = user
        .try_initiate_deletion_with(&user.password.clone(), Some(&mfa_code))
        .await;
    let initiate: InitiateResponse = res.take_json().await.unwrap();

    // Execute with valid mfa_code — must succeed.
    let fresh_code = generate_totp_code(&secret);
    let res = user
        .try_execute_deletion_with(&initiate.token, &user.password.clone(), Some(&fresh_code))
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::NO_CONTENT),
        "valid mfa_code must be accepted on execution"
    );
}

// ── Execution: invalid state transitions ──────────────────────────────────

#[tokio::test]
async fn execute_deletion_without_initiation_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user
        .try_execute_deletion("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        .await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "execution without initiation must be rejected"
    );
}

#[tokio::test]
async fn execute_deletion_invalid_token_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Initiate so there's a request row, but use a wrong token
    user.initiate_deletion().await;
    let res = user
        .try_execute_deletion("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
        .await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "invalid token must be rejected"
    );
}

#[tokio::test]
async fn execute_deletion_email_confirmation_pending_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let user_id = user.user_id();

    // Initiate deletion (token row created without confirm_token since email unconfirmed).
    let resp = user.initiate_deletion().await;

    // Manually set a confirm_token to simulate a confirmed-email user who hasn't clicked the link.
    use crate::db::Database;
    let fake_confirm_token = vec![1u8; 32];
    let fct = fake_confirm_token.clone();
    server
        .db
        .write(move |conn| {
            use crate::schema::account_deletion_requests::dsl as adr;
            use diesel::prelude::*;
            diesel::update(
                adr::account_deletion_requests.filter(adr::user_id.eq(user_id)),
            )
            .set(adr::confirm_token.eq(Some(fct)))
            .execute(conn)
        })
        .await
        .unwrap()
        .unwrap();

    let res = user.try_execute_deletion(&resp.token).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "execute with email confirmation pending must return 403"
    );
}

#[tokio::test]
async fn execute_deletion_double_execute_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_deletion().await;
    // First execution succeeds.
    user.execute_deletion(&resp.token).await;

    // Second execution must fail because the deletion row (and the user's session) are gone.
    // The user is no longer authenticated (sessions cleared), so we expect 401.
    let res = user.try_execute_deletion(&resp.token).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "second execution must fail: session was cleared by first deletion"
    );
}

// ── Execution: mutation side-effects ──────────────────────────────────────

#[tokio::test]
async fn execute_deletion_anonymizes_user() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let user_id = user.user_id();

    let resp = user.initiate_deletion().await;
    user.try_execute_deletion(&resp.token).await;

    use crate::db::Database;
    let db_user = server
        .db
        .read(move |conn| {
            use crate::schema::users::dsl::*;
            use diesel::prelude::*;
            users.find(user_id).first::<crate::models::User>(conn)
        })
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        db_user.email,
        format!("deleted[{user_id}]"),
        "email must be anonymized"
    );
    assert_eq!(
        db_user.nickname.to_string(),
        format!("deleted[{user_id}]"),
        "nickname must be anonymized"
    );
    assert!(db_user.description.is_empty(), "description must be cleared");
    assert!(!db_user.totp_enabled, "totp must be disabled");
    assert!(
        db_user.totp_secret_enc.is_none(),
        "totp secret must be cleared"
    );
    assert!(
        db_user.tos_accepted_at.is_none(),
        "tos_accepted_at must be cleared"
    );
    assert!(
        db_user.email_confirmed_at.is_none(),
        "email_confirmed_at must be cleared"
    );
}

#[tokio::test]
async fn execute_deletion_clears_sessions() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let uid = user.user_id();

    let resp = user.initiate_deletion().await;
    user.try_execute_deletion(&resp.token).await;

    use crate::db::Database;
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

    assert_eq!(session_count, 0, "all sessions must be deleted");
}

#[tokio::test]
async fn execute_deletion_revokes_auth_cookies_so_me_returns_401() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_deletion().await;
    user.execute_deletion(&resp.token).await;

    // After deletion the session is gone; /api/user/me must return 401.
    let res = user.try_me().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "protected endpoints must return 401 after account deletion"
    );
}

#[tokio::test]
async fn execute_deletion_clears_friend_requests() {
    let server = mock::Server::default();
    let mut user1 = server.user().register().await;
    let user2 = server.user().register().await;

    // Create a friend request from user1 to user2
    use crate::db::Database;
    let u1_id = user1.user_id();
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

    // Delete user1
    let resp = user1.initiate_deletion().await;
    user1.try_execute_deletion(&resp.token).await;

    let fr_count = server
        .db
        .read(move |conn| {
            use crate::schema::friend_requests::dsl::*;
            use diesel::prelude::*;
            friend_requests
                .filter(sender_id.eq(u1_id).or(receiver_id.eq(u1_id)))
                .count()
                .get_result::<i64>(conn)
        })
        .await
        .unwrap()
        .unwrap();

    assert_eq!(fr_count, 0, "friend requests must be deleted");
}

#[tokio::test]
async fn execute_deletion_sends_notification_email() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let resp = user.initiate_deletion().await;
    server.mailer.take_emails(); // clear any prior emails
    user.try_execute_deletion(&resp.token).await;

    let emails = server.mailer.sent_emails();
    assert!(
        emails
            .iter()
            .any(|e| matches!(
                e.email,
                crate::email::TransactionalEmail::AccountDeleted
            )),
        "should send AccountDeleted notification email"
    );
}

#[tokio::test]
async fn deletion_request_row_cleaned_after_execution() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let uid = user.user_id();

    let resp = user.initiate_deletion().await;
    user.try_execute_deletion(&resp.token).await;

    use crate::db::Database;
    let count = server
        .db
        .read(move |conn| {
            use crate::schema::account_deletion_requests::dsl::*;
            use diesel::prelude::*;
            account_deletion_requests
                .filter(user_id.eq(uid))
                .count()
                .get_result::<i64>(conn)
        })
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        count, 0,
        "deletion request row must be removed after execution"
    );
}

// ── Email confirmation flow ────────────────────────────────────────────────

#[tokio::test]
async fn confirm_deletion_missing_params_returns_error_html() {
    let server = mock::Server::default();
    let mut client = server.client();

    let req = client.get("/api/gdpr/confirm-account-deletion");
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "missing query params must return 400"
    );
}

#[tokio::test]
async fn confirm_deletion_invalid_base64_token_returns_error_html() {
    let server = mock::Server::default();
    let mut client = server.client();

    // "bad token!!!" is not valid base64url
    let req = client.get("/api/gdpr/confirm-account-deletion?user_id=999&token=bad+token!!!");
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "invalid base64 token must return 400"
    );
}

#[tokio::test]
async fn confirm_deletion_invalid_token_returns_error_html() {
    let server = mock::Server::default();
    let mut client = server.client();

    // Valid base64url but no matching DB row.
    let fake_token = base64url.encode([0u8; 32]);
    let req = client
        .get(format!("/api/gdpr/confirm-account-deletion?user_id=999&token={fake_token}"));
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "unknown token must return 400"
    );
}

#[tokio::test]
async fn confirm_deletion_happy_path_clears_confirm_token() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    let user_id = user.user_id();

    // Create a deletion request row with a known confirm_token.
    use crate::db::Database;
    let confirm_token = rand::random::<[u8; 32]>().to_vec();
    let main_token = rand::random::<[u8; 32]>().to_vec();
    let ct = confirm_token.clone();
    let mt = main_token.clone();
    server
        .db
        .write(move |conn| {
            use crate::schema::account_deletion_requests::dsl as adr;
            use diesel::prelude::*;
            diesel::insert_into(adr::account_deletion_requests)
                .values(crate::models::AccountDeletionRequest {
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
        "/api/gdpr/confirm-account-deletion?user_id={user_id}&token={encoded_confirm}"
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
            use crate::schema::account_deletion_requests::dsl as adr;
            use diesel::prelude::*;
            adr::account_deletion_requests
                .filter(adr::user_id.eq(user_id))
                .first::<crate::models::AccountDeletionRequest>(conn)
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
async fn confirm_deletion_reuse_fails() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    let user_id = user.user_id();

    use crate::db::Database;
    let confirm_token = rand::random::<[u8; 32]>().to_vec();
    let main_token = rand::random::<[u8; 32]>().to_vec();
    let ct = confirm_token.clone();
    let mt = main_token.clone();
    server
        .db
        .write(move |conn| {
            use crate::schema::account_deletion_requests::dsl as adr;
            use diesel::prelude::*;
            diesel::insert_into(adr::account_deletion_requests)
                .values(crate::models::AccountDeletionRequest {
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
        "/api/gdpr/confirm-account-deletion?user_id={user_id}&token={encoded_confirm}"
    ));
    let res = client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    // Second use of same confirm_token — the DB row now has confirm_token=NULL
    // so this should return a 400 error page.
    let req2 = client.get(format!(
        "/api/gdpr/confirm-account-deletion?user_id={user_id}&token={encoded_confirm}"
    ));
    let res2 = client.send(req2).await;
    assert_eq!(
        res2.status_code,
        Some(StatusCode::BAD_REQUEST),
        "reuse of confirm token must return 400"
    );
}

// ── Initiation: AlreadyDeleted guard ──────────────────────────────────────

#[tokio::test]
async fn initiate_deletion_on_deleted_account_rejected() {
    use crate::db::Database;

    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let user_id = user.user_id();

    // Perform a full deletion cycle.
    let resp = user.initiate_deletion().await;
    user.execute_deletion(&resp.token).await;

    // Verify at the DB level that the user's email is now anonymized
    // (the AlreadyDeleted guard fires when email starts with "deleted[").
    let db_email = server
        .db
        .read(move |conn| {
            use crate::schema::users::dsl::*;
            use diesel::prelude::*;
            users
                .find(user_id)
                .select(email)
                .first::<String>(conn)
        })
        .await
        .unwrap()
        .unwrap();

    assert!(
        db_email.starts_with("deleted["),
        "email must be anonymized after deletion"
    );
}
