use crate::auth::UserSessionInfo;
use crate::auth::router::RegisterInput;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Unregistered> {
    /// Register this user, asserting success.
    ///
    /// Returns the now-registered user whose [`ApiClient`] already holds valid
    /// session + JWT cookies, ready for authenticated requests.
    pub async fn register(mut self) -> mock::User<mock::Registered> {
        let mut res = self.try_register().await;

        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "registration should succeed: {self}"
        );

        let info: UserSessionInfo = res.take_json().await.unwrap();

        mock::User {
            client: self.client,
            nickname: self.nickname,
            email: self.email,
            password: self.password,
            id: mock::Registered(info.user.id),
        }
    }

    /// Send a registration request *without* asserting on the outcome.
    ///
    /// Useful for testing error paths (duplicate email, bad input, …).
    pub async fn try_register(&mut self) -> salvo::Response {
        let body = RegisterInput {
            email: self.email.to_string(),
            password: self.password.to_string(),
            nickname: self.nickname,
            tos: true,
        };
        let req = self.client.post("/api/auth/register").json(&body);
        self.client.send(req).await
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn register_succeeds() {
    let server = mock::Server::default();
    let user = server.user().register().await;

    assert!(
        user.user_id() > 0,
        "registered user must have a positive id"
    );
}

#[tokio::test]
async fn register_returns_correct_user_info() {
    let server = mock::Server::default();
    let unregistered = server.user();
    let expected_nick = unregistered.nickname.to_string();
    let expected_email = unregistered.email.clone();

    let mut user = unregistered.register().await;

    let info = user.me().await;
    assert_eq!(info.user.nickname.to_string(), expected_nick);
    assert_eq!(info.user.email, *expected_email);
}

#[tokio::test]
async fn register_sets_auth_cookies() {
    let server = mock::Server::default();
    let user = server.user().register().await;

    let has_session = user
        .client
        .cookies
        .iter()
        .any(|c| c.name() == crate::auth::SESSION_COOKIE_NAME);
    let has_jwt = user
        .client
        .cookies
        .iter()
        .any(|c| c.name() == crate::auth::JWT_COOKIE_NAME);

    assert!(has_session, "session cookie must be set after registration");
    assert!(has_jwt, "JWT cookie must be set after registration");
}

#[tokio::test]
async fn register_grants_access_to_protected_endpoints() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn register_duplicate_email_conflict() {
    let server = mock::Server::default();
    let first = server.user();
    let email = first.email.clone();

    let _registered = first.register().await;

    // Second user reuses the same email.
    let mut second = server.user();
    second.email = email;

    let res = second.try_register().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::CONFLICT),
        "duplicate email must be rejected with 409"
    );
}

#[tokio::test]
async fn register_duplicate_nickname_conflict() {
    let server = mock::Server::default();
    let first = server.user();
    let nick = first.nickname;

    let _registered = first.register().await;

    // Second user reuses the same nickname.
    let mut second = server.user();
    second.nickname = nick;

    let res = second.try_register().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::CONFLICT),
        "duplicate nickname must be rejected with 409"
    );
}

#[tokio::test]
async fn register_invalid_email_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();
    user.email = "not-an-email".into();

    let res = user.try_register().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "invalid email must be rejected"
    );
}

#[tokio::test]
async fn register_short_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();
    user.password = "short".into();

    let res = user.try_register().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "password shorter than 8 chars must be rejected"
    );
}

#[tokio::test]
async fn register_long_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();
    user.password = "x".repeat(129).into();

    let res = user.try_register().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "password longer than 128 chars must be rejected"
    );
}

#[tokio::test]
async fn register_empty_nickname_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();
    // Override the JSON body directly to send an empty nickname.
    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": "",
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "empty nickname must be rejected"
    );
}

#[tokio::test]
async fn register_nickname_with_spaces_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();
    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": "has space",
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "nickname containing spaces must be rejected"
    );
}

#[tokio::test]
async fn multiple_users_can_register() {
    let server = mock::Server::default();

    let u1 = server.user().register().await;
    let u2 = server.user().register().await;
    let u3 = server.user().register().await;

    // All must have distinct IDs.
    let ids = [u1.user_id(), u2.user_id(), u3.user_id()];
    assert_ne!(ids[0], ids[1]);
    assert_ne!(ids[1], ids[2]);
    assert_ne!(ids[0], ids[2]);
}

// ── Nickname boundary tests ───────────────────────────────────────────────

#[tokio::test]
async fn register_nickname_too_short_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();
    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": "ab",       // 2 chars, min is 3
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "nickname shorter than 3 chars must be rejected"
    );
}

#[tokio::test]
async fn register_nickname_too_long_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();
    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": "a".repeat(17),  // 17 chars, max is 16
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "nickname longer than 16 chars must be rejected"
    );
}

#[tokio::test]
async fn register_nickname_exact_min_length_accepted() {
    let server = mock::Server::default();
    let mut user = server.user();
    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": "abc",       // exactly 3 chars
        "tos": true,
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "nickname of exactly 3 chars (min boundary) must be accepted"
    );
}

#[tokio::test]
async fn register_nickname_exact_max_length_accepted() {
    let server = mock::Server::default();
    let mut user = server.user();
    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": "a".repeat(16),  // exactly 16 chars
        "tos": true,
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "nickname of exactly 16 chars (max boundary) must be accepted"
    );
}

#[tokio::test]
async fn register_nickname_with_invalid_chars_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();
    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": "user@name!",
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "nickname with special characters must be rejected"
    );
}

#[tokio::test]
async fn register_nickname_with_underscores_and_hyphens_accepted() {
    let server = mock::Server::default();
    let mut user = server.user();
    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": "my_nick-name",
        "tos": true,
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "nickname with underscores and hyphens must be accepted"
    );
}

// ── Password boundary tests ──────────────────────────────────────────────

#[tokio::test]
async fn register_password_exact_min_length_accepted() {
    let server = mock::Server::default();
    let mut user = server.user();
    user.password = "x".repeat(8).into(); // exactly 8 chars

    let res = user.try_register().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "password of exactly 8 chars (min boundary) must be accepted"
    );
}

#[tokio::test]
async fn register_password_exact_max_length_accepted() {
    let server = mock::Server::default();
    let mut user = server.user();
    user.password = "x".repeat(128).into(); // exactly 128 chars

    let res = user.try_register().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "password of exactly 128 chars (max boundary) must be accepted"
    );
}
