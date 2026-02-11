use crate::auth::router::PasswordInput;
use crate::auth::{SessionInfo, UserSessionInfo};
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;

use super::two_factor::{ensure_totp_key, generate_totp_code};

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `POST /api/auth/session-management/refresh-jwt` — refresh the JWT,
    /// asserting success. Updates cookies.
    pub async fn refresh_jwt(&mut self) {
        let res = self.try_refresh_jwt().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "refresh-jwt should succeed: {self}"
        );
    }

    /// `POST /api/auth/session-management/refresh-jwt` without asserting.
    pub async fn try_refresh_jwt(&mut self) -> salvo::Response {
        let req = self.client.post("/api/auth/session-management/refresh-jwt");
        self.client.send(req).await
    }

    /// `POST /api/auth/session-management/reauth` — reauthenticate the
    /// current session, asserting success. Updates cookies.
    pub async fn reauth(&mut self) {
        let mut res = self.try_reauth().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "reauth should succeed: {self}"
        );
        let _: UserSessionInfo = res.take_json().await.unwrap();
    }

    /// `POST /api/auth/session-management/reauth` without asserting.
    pub async fn try_reauth(&mut self) -> salvo::Response {
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code: None,
        };
        let req = self
            .client
            .post("/api/auth/session-management/reauth")
            .json(&body);
        self.client.send(req).await
    }

    /// `POST /api/auth/session-management/reauth` with an explicit MFA code.
    pub async fn try_reauth_with_mfa(&mut self, mfa_code: Option<&str>) -> salvo::Response {
        let body = PasswordInput {
            password: self.password.to_string(),
            mfa_code: mfa_code.map(String::from),
        };
        let req = self
            .client
            .post("/api/auth/session-management/reauth")
            .json(&body);
        self.client.send(req).await
    }

    /// `GET /api/user/session` — fetch current session info, asserting success.
    pub async fn current_session(&mut self) -> SessionInfo {
        let req = self.client.get("/api/user/session");
        let mut res = self.client.send(req).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "current_session should succeed: {self}"
        );
        res.take_json().await.unwrap()
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn refresh_jwt_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.refresh_jwt().await;

    // Should still be able to access protected endpoints.
    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn refresh_jwt_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| c.post("/api/auth/session-management/refresh-jwt"))
        .await;
}

#[tokio::test]
async fn reauth_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| {
        c.post("/api/auth/session-management/reauth")
            .json(&PasswordInput {
                password: "irrelevant".to_string(),
                mfa_code: None,
            })
    })
    .await;
}

#[tokio::test]
async fn reauth_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.reauth().await;

    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn reauth_wrong_password_fails() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let body = PasswordInput {
        password: "absolutely-wrong".to_string(),
        mfa_code: None,
    };
    let req = user
        .client
        .post("/api/auth/session-management/reauth")
        .json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "reauth with wrong password must fail"
    );
}

#[tokio::test]
async fn current_session_returns_valid_info() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    let session = user.current_session().await;
    assert!(session.session_id > 0);
    assert_eq!(session.user_id, user.user_id());
}

#[tokio::test]
async fn current_session_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.assert_requires_auth(|c| c.get("/api/user/session"))
        .await;
}

#[tokio::test]
async fn refresh_jwt_then_me_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;

    // Refresh several times sequentially.
    for _ in 0..3 {
        user.refresh_jwt().await;
    }

    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn refresh_jwt_after_logout_fails() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    user.logout().await;

    let res = user.try_refresh_jwt().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "refresh-jwt after logout must fail"
    );
}

// ── Reauth + 2FA interaction tests ───────────────────────────────────────

#[tokio::test]
async fn reauth_with_2fa_requires_mfa_code() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Try reauth without MFA code.
    let res = user.try_reauth().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "reauth without MFA code must fail when 2FA is enabled"
    );
}

#[tokio::test]
async fn reauth_with_2fa_wrong_mfa_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Try reauth with wrong MFA code.
    let res = user.try_reauth_with_mfa(Some("000000")).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "reauth with wrong MFA code must fail"
    );
}

#[tokio::test]
async fn reauth_with_2fa_valid_mfa_accepted() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_totp_key();

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Reauth with valid MFA code.
    let mfa = generate_totp_code(&secret);
    let mut res = user.try_reauth_with_mfa(Some(&mfa)).await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "reauth with valid MFA code must succeed"
    );
    let _: UserSessionInfo = res.take_json().await.unwrap();
}
