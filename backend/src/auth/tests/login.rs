use crate::auth::UserSessionInfo;
use crate::auth::router::LoginInput;
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

use super::two_factor::{ensure_2fa_disabled, generate_totp_code};

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// Login with the stored credentials, asserting success.
    ///
    /// Supplies the current MFA code automatically (no-op when 2FA is not
    /// enrolled).  Overwrites the client's cookies with the fresh session + JWT.
    pub async fn login(&mut self) {
        let mfa_code = self.mfa_code().await;
        let body = LoginInput {
            email: self.email.to_string(),
            password: self.password.to_string(),
            mfa_code,
        };
        let req = self.client.post("/api/auth/login").json(&body);
        let mut res = self.client.send(req).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "login should succeed: {self}"
        );
        // Drain the body so it doesn't leak.
        let _: UserSessionInfo = res.take_json().await.unwrap();
    }

    /// Send a login request *without* an MFA code.
    ///
    /// Useful for testing that login fails when 2FA is enabled but no code is
    /// supplied.  For the normal login path use [`login`].
    pub async fn try_login(&mut self) -> salvo::Response {
        let body = LoginInput {
            email: self.email.to_string(),
            password: self.password.to_string(),
            mfa_code: None,
        };
        let req = self.client.post("/api/auth/login").json(&body);
        self.client.send(req).await
    }

    /// Send a login request with custom credentials.
    ///
    /// Useful for testing wrong password / MFA scenarios.
    pub async fn try_login_with(
        &mut self,
        email: &str,
        password: &str,
        mfa_code: Option<&str>,
    ) -> salvo::Response {
        let body = LoginInput {
            email: email.to_string(),
            password: password.to_string(),
            mfa_code: mfa_code.map(String::from),
        };
        let req = self.client.post("/api/auth/login").json(&body);
        self.client.send(req).await
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn login_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.login().await;
}

#[tokio::test]
async fn login_returns_user_info() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Use login() which automatically supplies an MFA code in 2FA feature modes.
    let mfa_code = user.mfa_code().await;
    let body = LoginInput {
        email: user.email.to_string(),
        password: user.password.to_string(),
        mfa_code,
    };
    let req = user.client.post("/api/auth/login").json(&body);
    let mut res = user.client.send(req).await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    let info: UserSessionInfo = res.take_json().await.unwrap();
    assert_eq!(info.user.id, user.user_id());
    assert_eq!(info.user.email, *user.email);
}

#[tokio::test]
async fn login_wrong_password_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user
        .try_login_with(&user.email.clone(), "totally-wrong-password", None)
        .await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "wrong password must be rejected"
    );
}

#[tokio::test]
async fn login_nonexistent_email_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let res = user
        .try_login_with("ghost@nowhere.test", &user.password.clone(), None)
        .await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "nonexistent email must be rejected (timing-safe)"
    );
}

#[tokio::test]
async fn login_sets_auth_cookies() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    // Clear cookies to simulate a fresh client.
    user.client.cookies = cookie::CookieJar::new();
    user.login().await;

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

    assert!(has_session, "session cookie must be set after login");
    assert!(has_jwt, "JWT cookie must be set after login");
}

#[tokio::test]
async fn login_after_logout_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.logout().await;
    user.login().await;

    // Should be able to access protected endpoints again.
    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn login_with_wrong_mfa_code_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Try login with wrong MFA code.
    user.client.cookies = cookie::CookieJar::new();
    let res = user
        .try_login_with(&user.email.clone(), &user.password.clone(), Some("000000"))
        .await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "login with wrong MFA code must be rejected"
    );
}
