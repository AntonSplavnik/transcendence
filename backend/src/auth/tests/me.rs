use crate::auth::UserSessionInfo;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `GET /api/user/me` — returns the parsed response, asserting 200 OK.
    pub async fn me(&mut self) -> UserSessionInfo {
        let mut res = self.try_me().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "GET /api/user/me should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// `GET /api/user/me` without asserting the outcome.
    pub async fn try_me(&mut self) -> salvo::Response {
        let req = self.client.get("/api/user/me");
        self.client.send(req).await
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn me_returns_correct_user_info() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let info = user.me().await;

    assert_eq!(info.user.id, user.user_id());
    assert_eq!(info.user.email, *user.email);
    assert_eq!(info.user.nickname.to_string(), user.nickname.to_string());
    assert!(!info.user.totp_enabled);
}

#[tokio::test]
async fn me_includes_session_info() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let info = user.me().await;

    assert!(info.session.session_id > 0, "session_id must be present");
    assert_eq!(info.session.user_id, user.user_id());
}

#[tokio::test]
async fn me_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| c.get("/api/user/me")).await;
}

#[tokio::test]
async fn me_does_not_leak_password_hash() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let mut res = user.try_me().await;
    let body = res.take_string().await.unwrap();

    assert!(
        !body.contains("password_hash"),
        "response must not contain password_hash"
    );
}

#[tokio::test]
async fn me_does_not_leak_totp_secret() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let mut res = user.try_me().await;
    let body = res.take_string().await.unwrap();

    assert!(
        !body.contains("totp_secret_enc"),
        "response must not contain totp_secret_enc"
    );
}
