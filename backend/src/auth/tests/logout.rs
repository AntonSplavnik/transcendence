use crate::utils::mock;
use salvo::http::StatusCode;

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `POST /api/user/logout` — logout the current session, asserting success.
    pub async fn logout(&mut self) {
        let res = self.try_logout().await;
        // The server returns 200 OK with an empty JSON body on success.
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "logout should succeed: {self}"
        );
    }

    /// `POST /api/user/logout` without asserting the outcome.
    pub async fn try_logout(&mut self) -> salvo::Response {
        let req = self.client.post("/api/user/logout");
        self.client.send(req).await
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn logout_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.logout().await;
}

#[tokio::test]
async fn access_denied_after_logout() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.logout().await;

    let res = user.try_me().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "protected endpoints must reject requests after logout"
    );
}

#[tokio::test]
async fn logout_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| c.post("/api/user/logout"))
        .await;
}

#[tokio::test]
async fn can_relogin_after_logout() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.logout().await;
    user.login().await;

    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn logout_double_logout_fails() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.logout().await;

    // Second logout should fail — the session is already deauthenticated.
    let res = user.try_logout().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "double logout must fail (session already deauthenticated)"
    );
}
