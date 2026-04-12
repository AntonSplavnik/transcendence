use crate::auth::SessionInfo;
use crate::auth::router::PasswordInput;
use crate::auth::user::SessionsInput;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

use super::two_factor::{ensure_totp_key, generate_totp_code};

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `POST /api/user/sessions` (`all_sessions`) — list all sessions, asserting success.
    pub async fn all_sessions(&mut self) -> Vec<SessionInfo> {
        let mut res = self.try_all_sessions().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "all_sessions should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }

    /// `POST /api/user/sessions` without asserting.
    pub async fn try_all_sessions(&mut self) -> salvo::Response {
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code: None,
        };
        let req = self.client.post("/api/user/sessions").json(&body);
        self.client.send(req).await
    }

    /// `POST /api/user/sessions` with explicit MFA code.
    pub async fn try_all_sessions_with_mfa(&mut self, mfa_code: Option<&str>) -> salvo::Response {
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code: mfa_code.map(String::from),
        };
        let req = self.client.post("/api/user/sessions").json(&body);
        self.client.send(req).await
    }

    /// `POST /api/user/logout-sessions` without asserting.
    pub async fn try_logout_sessions(
        &mut self,
        session_ids: &[i32],
        mfa_code: Option<&str>,
    ) -> salvo::Response {
        let body = SessionsInput {
            password: self.password.to_string(),
            mfa_code: mfa_code.map(String::from),
            session_ids: session_ids.iter().copied().collect(),
        };
        let req = self.client.post("/api/user/logout-sessions").json(&body);
        self.client.send(req).await
    }

    /// `POST /api/user/logout-other-sessions` without asserting.
    pub async fn try_logout_other_sessions(&mut self, mfa_code: Option<&str>) -> salvo::Response {
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code: mfa_code.map(String::from),
        };
        let req = self
            .client
            .post("/api/user/logout-other-sessions")
            .json(&body);
        self.client.send(req).await
    }

    /// `DELETE /api/user/sessions` without asserting.
    pub async fn try_delete_sessions(
        &mut self,
        session_ids: &[i32],
        mfa_code: Option<&str>,
    ) -> salvo::Response {
        let body = SessionsInput {
            password: self.password.to_string(),
            mfa_code: mfa_code.map(String::from),
            session_ids: session_ids.iter().copied().collect(),
        };
        let req = self.client.delete("/api/user/sessions").json(&body);
        self.client.send(req).await
    }
}

// ── Helper ─────────────────────────────────────────────────────────────────

/// Create a second session for the same user from a fresh client.
fn clone_as_second_device(
    server: &mock::Server,
    user: &mock::User<mock::Registered>,
) -> mock::User<mock::Registered> {
    mock::User {
        client: server.client(),
        nickname: user.nickname,
        email: user.email.clone(),
        password: user.password.clone(),
        id: mock::Registered(user.user_id()),
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  POST /api/user/sessions  (all_sessions)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn all_sessions_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let sessions = user.all_sessions().await;
    assert_eq!(
        sessions.len(),
        1,
        "newly registered user must have 1 session"
    );
    assert_eq!(sessions[0].user_id, user.user_id());
}

#[tokio::test]
async fn all_sessions_lists_multiple_sessions() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Create a second session.
    let mut second = clone_as_second_device(&server, &user);
    second.login().await;

    let sessions = user.all_sessions().await;
    assert_eq!(sessions.len(), 2, "should list both sessions");
}

#[tokio::test]
async fn all_sessions_wrong_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let body = PasswordInput {
        password: "wrong-password".to_string(),
        mfa_code: None,
    };
    let req = user.client.post("/api/user/sessions").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "all_sessions with wrong password must fail"
    );
}

#[tokio::test]
async fn all_sessions_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| {
        c.post("/api/user/sessions").json(&PasswordInput {
            password: "irrelevant".to_string(),
            mfa_code: None,
        })
    })
    .await;
}

#[tokio::test]
async fn all_sessions_with_2fa_requires_mfa() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // all_sessions without MFA code.
    let res = user.try_all_sessions().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "all_sessions without MFA code must fail when 2FA is enabled"
    );

    // all_sessions with valid MFA code.
    let mfa = generate_totp_code(&secret);
    let mut res = user.try_all_sessions_with_mfa(Some(&mfa)).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));
    let sessions: Vec<SessionInfo> = res.take_json().await.unwrap();
    assert!(!sessions.is_empty());
}

// ═══════════════════════════════════════════════════════════════════════════
//  POST /api/user/logout-sessions
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn logout_sessions_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Create second session and get its ID.
    let mut second = clone_as_second_device(&server, &user);
    second.login().await;
    let second_session = second.current_session().await;

    // Logout the second session from the first.
    let res = user
        .try_logout_sessions(&[second_session.session_id], None)
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "logout-sessions should succeed"
    );

    // Second session should now be deauthenticated.
    let res = second.try_me().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "logged-out session must be deauthenticated"
    );
}

#[tokio::test]
async fn logout_sessions_including_self_returns_did_logout() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let own_session = user.current_session().await;

    let res = user
        .try_logout_sessions(&[own_session.session_id], None)
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "logout-sessions including own session must return DidLogout (401)"
    );

    // Access should be denied afterwards.
    let res = user.try_me().await;
    assert_eq!(res.status_code, Some(StatusCode::UNAUTHORIZED));
}

#[tokio::test]
async fn logout_sessions_wrong_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let body = SessionsInput {
        password: "wrong-password".to_string(),
        mfa_code: None,
        session_ids: std::iter::once(1).collect(),
    };
    let req = user.client.post("/api/user/logout-sessions").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "logout-sessions with wrong password must fail"
    );
}

#[tokio::test]
async fn logout_sessions_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| {
        c.post("/api/user/logout-sessions").json(&SessionsInput {
            password: "irrelevant".to_string(),
            mfa_code: None,
            session_ids: std::iter::once(1).collect(),
        })
    })
    .await;
}

#[tokio::test]
async fn logout_sessions_with_2fa_requires_mfa() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Create second session and get its ID.
    let mfa = generate_totp_code(&secret);
    let mut second = clone_as_second_device(&server, &user);
    second
        .try_login_with(&user.email.clone(), &user.password.clone(), Some(&mfa))
        .await;
    let second_session = second.current_session().await;

    // Try logout-sessions without MFA code.
    let res = user
        .try_logout_sessions(&[second_session.session_id], None)
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "logout-sessions without MFA must fail when 2FA is enabled"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
//  POST /api/user/logout-other-sessions
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn logout_other_sessions_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Create second session.
    let mut second = clone_as_second_device(&server, &user);
    second.login().await;

    // Logout other sessions.
    let res = user.try_logout_other_sessions(None).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "logout-other-sessions should succeed"
    );

    // Second session should be deauthenticated.
    let res = second.try_me().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "other sessions must be deauthenticated"
    );

    // Current (first) session should still work.
    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn logout_other_sessions_wrong_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let body = PasswordInput {
        password: "wrong-password".to_string(),
        mfa_code: None,
    };
    let req = user
        .client
        .post("/api/user/logout-other-sessions")
        .json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "logout-other-sessions with wrong password must fail"
    );
}

#[tokio::test]
async fn logout_other_sessions_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| {
        c.post("/api/user/logout-other-sessions")
            .json(&PasswordInput {
                password: "irrelevant".to_string(),
                mfa_code: None,
            })
    })
    .await;
}

#[tokio::test]
async fn logout_other_sessions_with_2fa_requires_mfa() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Try logout-other-sessions without MFA code.
    let res = user.try_logout_other_sessions(None).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "logout-other-sessions without MFA must fail when 2FA is enabled"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
//  DELETE /api/user/sessions  (delete_sessions)
// ═══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn delete_sessions_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Create second session and get its ID.
    let mut second = clone_as_second_device(&server, &user);
    second.login().await;
    let second_session = second.current_session().await;

    // Delete the second session.
    let res = user
        .try_delete_sessions(&[second_session.session_id], None)
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "delete-sessions should succeed"
    );

    // Second session should be gone (not just deauthed but deleted).
    let res = second.try_me().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "deleted session must be rejected"
    );
}

#[tokio::test]
async fn delete_sessions_including_self_returns_did_logout() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    let own_session = user.current_session().await;

    let res = user
        .try_delete_sessions(&[own_session.session_id], None)
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "delete-sessions including own session must return DidLogout (401)"
    );

    // Access should be denied.
    let res = user.try_me().await;
    assert_eq!(res.status_code, Some(StatusCode::UNAUTHORIZED));
}

#[tokio::test]
async fn delete_sessions_wrong_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let body = SessionsInput {
        password: "wrong-password".to_string(),
        mfa_code: None,
        session_ids: std::iter::once(1).collect(),
    };
    let req = user.client.delete("/api/user/sessions").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "delete-sessions with wrong password must fail"
    );
}

#[tokio::test]
async fn delete_sessions_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    user.assert_requires_auth(|c| {
        c.delete("/api/user/sessions").json(&SessionsInput {
            password: "irrelevant".to_string(),
            mfa_code: None,
            session_ids: std::iter::once(1).collect(),
        })
    })
    .await;
}

#[tokio::test]
async fn delete_sessions_with_2fa_requires_mfa() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Try delete-sessions without MFA code.
    let res = user.try_delete_sessions(&[1], None).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "delete-sessions without MFA must fail when 2FA is enabled"
    );
}

#[tokio::test]
async fn delete_sessions_removes_from_all_sessions_list() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Create second session and get its ID.
    let mut second = clone_as_second_device(&server, &user);
    second.login().await;
    let second_session = second.current_session().await;

    // Verify there are 2 sessions.
    let sessions = user.all_sessions().await;
    assert_eq!(sessions.len(), 2);

    // Delete the second session.
    let res = user
        .try_delete_sessions(&[second_session.session_id], None)
        .await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    // Should now only have 1 session.
    let sessions = user.all_sessions().await;
    assert_eq!(
        sessions.len(),
        1,
        "deleted session must disappear from all_sessions"
    );
}
