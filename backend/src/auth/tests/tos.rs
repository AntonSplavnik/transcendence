use crate::auth::SessionInfo;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `POST /api/auth/session-management/accept-tos` — accept the ToS,
    /// asserting success. Updates cookies.
    pub async fn accept_tos(&mut self) -> SessionInfo {
        let mut res = self.try_accept_tos().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "accept-tos should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// `POST /api/auth/session-management/accept-tos` without asserting.
    pub async fn try_accept_tos(&mut self) -> salvo::Response {
        let req = self.client.post("/api/auth/session-management/accept-tos");
        self.client.send(req).await
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn accept_tos_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let info = user.accept_tos().await;
    assert_eq!(
        info.user_id,
        user.user_id(),
        "accept-tos response should contain the correct user_id"
    );
}

#[tokio::test]
async fn accept_tos_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| c.post("/api/auth/session-management/accept-tos"))
        .await;
}

#[tokio::test]
async fn accept_tos_updates_user_tos() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // After registration with tos:true, the /me endpoint should already show tos:true.
    // Call accept_tos to ensure it also works correctly.
    user.accept_tos().await;

    let info = user.me().await;
    assert!(
        info.user.tos_accepted_at.is_some(),
        "tos should be accepted after calling accept-tos"
    );
}

#[tokio::test]
async fn accept_tos_issues_fresh_jwt() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Capture cookies before accept-tos
    let session_before: Vec<_> = user
        .client
        .cookies
        .iter()
        .filter(|c| c.name() == crate::auth::SESSION_COOKIE_NAME)
        .map(|c| c.value().to_string())
        .collect();
    let jwt_before: Vec<_> = user
        .client
        .cookies
        .iter()
        .filter(|c| c.name() == crate::auth::JWT_COOKIE_NAME)
        .map(|c| c.value().to_string())
        .collect();

    user.accept_tos().await;

    // Verify cookies are present after accept-tos
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

    assert!(
        has_session,
        "session cookie must be present after accept-tos"
    );
    assert!(has_jwt, "JWT cookie must be present after accept-tos");

    // Verify the cookies were rotated (new values)
    let session_after: Vec<_> = user
        .client
        .cookies
        .iter()
        .filter(|c| c.name() == crate::auth::SESSION_COOKIE_NAME)
        .map(|c| c.value().to_string())
        .collect();
    let jwt_after: Vec<_> = user
        .client
        .cookies
        .iter()
        .filter(|c| c.name() == crate::auth::JWT_COOKIE_NAME)
        .map(|c| c.value().to_string())
        .collect();

    assert_ne!(
        session_before, session_after,
        "session cookie should be rotated after accept-tos"
    );
    assert_ne!(
        jwt_before, jwt_after,
        "JWT cookie should be rotated after accept-tos"
    );
}

#[tokio::test]
async fn register_without_tos_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();

    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": user.nickname.to_string(),
        "tos": false,
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "registration with tos:false must be rejected"
    );
}

#[tokio::test]
async fn register_missing_tos_field_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();

    let body = serde_json::json!({
        "email": &*user.email,
        "password": &*user.password,
        "nickname": user.nickname.to_string(),
    });
    let req = user.client.post("/api/auth/register").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "registration without tos field must be rejected"
    );
}

#[tokio::test]
async fn register_with_tos_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let info = user.me().await;
    assert!(
        info.user.tos_accepted_at.is_some(),
        "user registered with tos:true should have tos accepted"
    );
}

#[tokio::test]
async fn me_includes_tos_field() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let mut res = user.try_me().await;
    let body = res.take_string().await.unwrap();

    assert!(
        body.contains("\"tos\""),
        "GET /me response must include a tos field, got: {body}"
    );
}

#[tokio::test]
async fn me_tos_field_is_boolean_true_after_registration() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let mut res = user.try_me().await;
    let body = res.take_string().await.unwrap();

    // The tos field should be serialized as a boolean, not a timestamp
    assert!(
        body.contains("\"tos\":true"),
        "tos field should be boolean true after registration with tos accepted, got: {body}"
    );
}

#[tokio::test]
async fn me_does_not_leak_tos_accepted_at_timestamp() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let mut res = user.try_me().await;
    let body = res.take_string().await.unwrap();

    assert!(
        !body.contains("tos_accepted_at"),
        "response must not leak tos_accepted_at timestamp, got: {body}"
    );
}

#[tokio::test]
async fn tos_gated_endpoint_requires_tos() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // After registration with tos:true, tos-gated endpoints should work.
    // We test by hitting a tos-gated endpoint (description update).
    let body = serde_json::json!({ "description": "hello" });
    let req = user.client.put("/api/user/description").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "tos-gated endpoint should succeed when user has accepted tos"
    );
}
