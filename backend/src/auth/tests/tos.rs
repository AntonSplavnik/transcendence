use crate::auth::SessionInfo;
use crate::tos::TosInfo;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `POST /api/auth/session-management/accept-tos` — accept the `ToS`,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Create a server whose `ToS` timestamp is in the future, so any user
/// registered before this call will fail the `ToS` gate.
///
/// Because the timestamp is in the future, `accept_tos` (which records
/// `now()`) will **not** unblock the user. Use this only for tests that
/// assert the **blocking** path (403) or ToS-exempt endpoints. For tests
/// that need to accept-then-unblock, use a real `sleep`-to-next-second
/// approach so that `now()` >= the `ToS` timestamp at acceptance time.
fn server_with_future_tos(server: &mock::Server) -> mock::Server {
    let future_ts = chrono::Utc::now() + chrono::Duration::seconds(2);
    server.with_tos(crate::tos::CurrentTosTimestamp::from_utc(future_ts))
}

fn cookie_value(user: &mock::User<mock::Registered>, name: &str) -> Option<String> {
    user.client
        .cookies
        .iter()
        .find(|c| c.name() == name)
        .map(|c| c.value().to_string())
}

// ── Tests: accept-tos endpoint ──────────────────────────────────────────────

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
    let user = server.user().register().await;
    user.assert_requires_auth(|c| c.post("/api/auth/session-management/accept-tos"))
        .await;
}

#[tokio::test]
async fn accept_tos_updates_user_tos() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    user.accept_tos().await;

    let info = user.me().await;
    assert!(
        info.user.tos_accepted_at.is_some(),
        "tos_accepted_at should be set after calling accept-tos"
    );
}

#[tokio::test]
async fn accept_tos_issues_fresh_jwt() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let session_before = cookie_value(&user, crate::auth::SESSION_COOKIE_NAME);
    let jwt_before = cookie_value(&user, crate::auth::JWT_COOKIE_NAME);

    user.accept_tos().await;

    let session_after = cookie_value(&user, crate::auth::SESSION_COOKIE_NAME);
    let jwt_after = cookie_value(&user, crate::auth::JWT_COOKIE_NAME);

    assert!(
        session_after.is_some(),
        "session cookie must be present after accept-tos"
    );
    assert!(
        jwt_after.is_some(),
        "JWT cookie must be present after accept-tos"
    );
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
async fn accept_tos_response_contains_session_info() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let info = user.accept_tos().await;

    assert!(
        info.session_id > 0,
        "session_id must be positive in accept-tos response"
    );
    assert_eq!(
        info.user_id,
        user.user_id(),
        "user_id must match in accept-tos response"
    );
}

#[tokio::test]
async fn accept_tos_idempotent() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let first = user.accept_tos().await;
    let second = user.accept_tos().await;

    assert_eq!(
        first.user_id, second.user_id,
        "calling accept-tos twice should succeed and return the same user_id"
    );
}

#[tokio::test]
async fn accept_tos_updates_timestamp_on_second_call() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let before = user.me().await;
    let ts_before = before
        .user
        .tos_accepted_at
        .expect("tos_accepted_at should be set after registration");

    // Accept again - timestamp should be >= the previous one
    user.accept_tos().await;
    let after = user.me().await;
    let ts_after = after
        .user
        .tos_accepted_at
        .expect("tos_accepted_at should be set after accept-tos");

    assert!(
        ts_after >= ts_before,
        "second accept-tos should update timestamp: before={ts_before}, after={ts_after}"
    );
}

// ── Tests: registration ToS field ───────────────────────────────────────────

#[tokio::test]
async fn register_without_tos_rejected() {
    let server = mock::Server::default();
    let mut user = server.user();

    // Must use json! here because RegisterInput with tos:false cannot be
    // constructed to intentionally send invalid input.
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

    // Must use json! here to intentionally omit the required tos field.
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
        "user registered with tos:true should have tos_accepted_at set"
    );
}

// ── Tests: /me tos_accepted_at field ────────────────────────────────────────

#[tokio::test]
async fn me_includes_tos_accepted_at_field() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let mut res = user.try_me().await;
    let body = res.take_string().await.unwrap();

    assert!(
        body.contains("\"tos_accepted_at\""),
        "GET /me response must include a tos_accepted_at field, got: {body}"
    );
}

#[tokio::test]
async fn me_tos_accepted_at_is_timestamp_after_registration() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let info = user.me().await;
    let ts = info
        .user
        .tos_accepted_at
        .expect("tos_accepted_at should be set after registration");

    // The timestamp should be recent (within the last 10 seconds)
    let now = chrono::Utc::now();
    let diff = now - ts;
    assert!(
        diff.num_seconds() < 10,
        "tos_accepted_at should be recent, got {ts}"
    );
}

// ── Tests: ToS gate on endpoints ────────────────────────────────────────────

#[tokio::test]
async fn tos_gated_endpoint_succeeds_when_accepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // After registration with tos:true, tos-gated endpoints should work.
    let res = user.try_update_description("hello").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "tos-gated endpoint should succeed when user has accepted tos"
    );
}

#[tokio::test]
async fn tos_gated_endpoint_blocked_after_tos_bump() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Simulate a new ToS version published in the future.
    let bumped = server_with_future_tos(&server);
    user.client = user.client.rebind(&bumped);

    // The user's old tos_accepted_at < new ToS timestamp -> 403.
    let res = user.try_update_description("hello").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "tos-gated endpoint should be forbidden after tos bump"
    );
}

#[tokio::test]
async fn tos_gated_endpoint_unblocked_after_reaccept() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Wait until the next full second so that CurrentTosTimestamp::now()
    // is strictly after the user's tos_accepted_at set during registration.
    // (CurrentTosTimestamp truncates to seconds, so we need a real second
    // boundary to guarantee the comparison is strict.)
    let now = chrono::Utc::now();
    let next_second = {
        use chrono::Timelike;
        (now + chrono::Duration::seconds(1))
            .with_nanosecond(0)
            .unwrap()
    };
    let wait = (next_second - now).to_std().unwrap();
    tokio::time::sleep(wait).await;

    // Simulate a new ToS version published "now" (strictly after registration).
    let bumped = server.with_tos(crate::tos::CurrentTosTimestamp::now());
    user.client = user.client.rebind(&bumped);

    // Blocked initially
    let res = user.try_update_description("hello").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "should be blocked before re-accepting"
    );

    // Accept the updated ToS — sets tos_accepted_at = now() >= bumped ToS.
    user.accept_tos().await;

    // Now unblocked
    let res = user.try_update_description("hello").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "tos-gated endpoint should succeed after accepting updated tos"
    );
}

// ── Tests: ToS-exempt endpoints survive a ToS bump ──────────────────────────

#[tokio::test]
async fn me_still_works_after_tos_bump() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let bumped = server_with_future_tos(&server);
    user.client = user.client.rebind(&bumped);

    // /me is ToS-exempt: it must still return 200 even though the user
    // hasn't accepted the new ToS.
    let info = user.me().await;
    assert_eq!(
        info.user.id,
        user.user_id(),
        "/me must remain accessible after a ToS bump"
    );
}

#[tokio::test]
async fn logout_still_works_after_tos_bump() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let bumped = server_with_future_tos(&server);
    user.client = user.client.rebind(&bumped);

    // Logout is ToS-exempt.
    let req = user.client.post("/api/user/logout");
    let res = user.client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "logout must remain accessible after a ToS bump"
    );
}

// ── Tests: login preserves tos_accepted_at ──────────────────────────────────

#[tokio::test]
async fn login_preserves_tos_accepted_at() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // tos_accepted_at set during registration
    let before = user.me().await;
    let ts_before = before
        .user
        .tos_accepted_at
        .expect("tos_accepted_at should be set after registration");

    // Login again
    user.login().await;

    let after = user.me().await;
    let ts_after = after
        .user
        .tos_accepted_at
        .expect("tos_accepted_at should persist after login");

    assert_eq!(
        ts_before, ts_after,
        "login should not change tos_accepted_at"
    );
}

// ── Tests: GET /api/tos (unauthenticated) ───────────────────────────────────

#[tokio::test]
async fn current_tos_endpoint_returns_timestamp() {
    let server = mock::Server::default();
    let mut client = server.client();

    let req = client.get("/api/tos");
    let mut res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "GET /api/tos should succeed without authentication"
    );

    let info: TosInfo = res.take_json().await.unwrap();
    let now = chrono::Utc::now();
    let diff = (now - info.current_tos_timestamp).num_seconds().abs();
    assert!(
        diff < 10,
        "current_tos_timestamp should be recent, got {}",
        info.current_tos_timestamp
    );
}

#[tokio::test]
async fn current_tos_endpoint_no_auth_required() {
    let server = mock::Server::default();
    let mut client = server.client();

    // Fresh client with no cookies at all
    let req = client.get("/api/tos");
    let res = client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "GET /api/tos must be accessible without any authentication"
    );
}

// ── Tests: change-password is also ToS-gated ────────────────────────────────

#[tokio::test]
async fn change_password_blocked_after_tos_bump() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let bumped = server_with_future_tos(&server);
    user.client = user.client.rebind(&bumped);

    let body = crate::auth::user::ChangePasswordInput {
        password: user.password.to_string(),
        mfa_code: None,
        new_password: "new_password_123".to_string(),
        keep_other_sessions_logged_in: false,
    };
    let req = user.client.post("/api/user/change-password").json(&body);
    let res = user.client.send(req).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::FORBIDDEN),
        "change-password should be blocked after tos bump"
    );
}
