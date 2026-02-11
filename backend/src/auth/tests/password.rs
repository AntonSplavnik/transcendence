use crate::auth::user::ChangePasswordInput;
use crate::utils::mock;
use salvo::http::StatusCode;

use super::two_factor::{ensure_totp_key, generate_totp_code};

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `POST /api/user/change-password` — change the user's password,
    /// asserting success. Updates `self.password` to reflect the new value.
    pub async fn change_password(&mut self, new_password: &str) {
        let res = self.try_change_password(new_password, true).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "change_password should succeed: {self}"
        );
        self.password = new_password.into();
    }

    /// Send a change-password request without asserting.
    ///
    /// `keep_other_sessions` controls whether other sessions remain active.
    pub async fn try_change_password(
        &mut self,
        new_password: &str,
        keep_other_sessions: bool,
    ) -> salvo::Response {
        let body = ChangePasswordInput {
            password: self.password.to_string(),
            mfa_code: None,
            new_password: new_password.to_string(),
            keep_other_sessions_logged_in: keep_other_sessions,
        };
        let req = self.client.post("/api/user/change-password").json(&body);
        self.client.send(req).await
    }

    /// Send a change-password request with an explicit MFA code.
    pub async fn try_change_password_with_mfa(
        &mut self,
        new_password: &str,
        keep_other_sessions: bool,
        mfa_code: Option<&str>,
    ) -> salvo::Response {
        let body = ChangePasswordInput {
            password: self.password.to_string(),
            mfa_code: mfa_code.map(String::from),
            new_password: new_password.to_string(),
            keep_other_sessions_logged_in: keep_other_sessions,
        };
        let req = self.client.post("/api/user/change-password").json(&body);
        self.client.send(req).await
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn change_password_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.change_password("brand-new-password").await;
}

#[tokio::test]
async fn login_with_new_password_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let new_pw = "brand-new-password";
    user.change_password(new_pw).await;

    // Clear cookies, then login with the new password.
    user.client.cookies = cookie::CookieJar::new();
    user.login().await;

    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn login_with_old_password_fails_after_change() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let old_pw = user.password.clone();
    user.change_password("brand-new-password").await;

    let res = user
        .try_login_with(&user.email.clone(), &old_pw, None)
        .await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "old password must be rejected after change"
    );
}

#[tokio::test]
async fn change_password_wrong_current_password_fails() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let body = ChangePasswordInput {
        password: "not-the-real-password".to_string(),
        mfa_code: None,
        new_password: "doesnt-matter".to_string(),
        keep_other_sessions_logged_in: false,
    };
    let req = user.client.post("/api/user/change-password").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "change-password with wrong current password must fail"
    );
}

#[tokio::test]
async fn change_password_invalid_new_password_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user.try_change_password("short", true).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "new password shorter than 8 chars must be rejected"
    );
}

#[tokio::test]
async fn change_password_invalidates_other_sessions() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Create a second session from a "different device".
    let mut second = mock::User {
        client: server.client(),
        nickname: user.nickname,
        email: user.email.clone(),
        password: user.password.clone(),
        id: mock::Registered(user.user_id()),
    };
    second.login().await;

    // Verify second session works.
    let info = second.me().await;
    assert_eq!(info.user.id, user.user_id());

    // Change password via first session without keeping others.
    let new_pw = "brand-new-password";
    let res = user.try_change_password(new_pw, false).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));
    user.password = new_pw.into();

    // Second session should now be deauthenticated.
    let res = second.try_me().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "other sessions must be invalidated when keep_other_sessions is false"
    );
}

#[tokio::test]
async fn change_password_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| {
        c.post("/api/user/change-password")
            .json(&ChangePasswordInput {
                password: "irrelevant".to_string(),
                mfa_code: None,
                new_password: "also-irrelevant".to_string(),
                keep_other_sessions_logged_in: false,
            })
    })
    .await;
}

// ── Password boundary tests ──────────────────────────────────────────────

#[tokio::test]
async fn change_password_new_too_long_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user.try_change_password(&"x".repeat(129), true).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::BAD_REQUEST),
        "new password longer than 128 chars must be rejected"
    );
}

#[tokio::test]
async fn change_password_new_exact_min_accepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user.try_change_password(&"x".repeat(8), true).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "new password of exactly 8 chars (min boundary) must be accepted"
    );
}

#[tokio::test]
async fn change_password_new_exact_max_accepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user.try_change_password(&"x".repeat(128), true).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "new password of exactly 128 chars (max boundary) must be accepted"
    );
}

// ── Keep other sessions ──────────────────────────────────────────────────

#[tokio::test]
async fn change_password_keeps_other_sessions_when_flag_true() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Create a second session from a "different device".
    let mut second = mock::User {
        client: server.client(),
        nickname: user.nickname,
        email: user.email.clone(),
        password: user.password.clone(),
        id: mock::Registered(user.user_id()),
    };
    second.login().await;

    // Verify second session works.
    let info = second.me().await;
    assert_eq!(info.user.id, user.user_id());

    // Change password via first session WITH keep_other_sessions = true.
    let new_pw = "brand-new-password";
    let res = user.try_change_password(new_pw, true).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));
    user.password = new_pw.into();

    // Second session should still work.
    let info = second.me().await;
    assert_eq!(
        info.user.id,
        user.user_id(),
        "other sessions must remain active when keep_other_sessions is true"
    );
}

// ── 2FA interaction tests ────────────────────────────────────────────────

#[tokio::test]
async fn change_password_with_2fa_requires_mfa_code() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Try change-password without MFA code.
    let res = user.try_change_password("new-valid-password", true).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "change-password without MFA code must fail when 2FA is enabled"
    );
}

#[tokio::test]
async fn change_password_with_2fa_wrong_mfa_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Try change-password with wrong MFA code.
    let res = user
        .try_change_password_with_mfa("new-valid-password", true, Some("000000"))
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "change-password with wrong MFA code must fail"
    );
}

#[tokio::test]
async fn change_password_with_2fa_valid_mfa_accepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Change password with valid MFA code.
    let mfa = generate_totp_code(&secret);
    let res = user
        .try_change_password_with_mfa("new-valid-password", true, Some(&mfa))
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "change-password with valid MFA code must succeed"
    );
}
