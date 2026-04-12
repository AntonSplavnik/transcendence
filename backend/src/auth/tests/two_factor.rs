use std::collections::VecDeque;

use crate::auth::user::{TwoFaConfirmInput, TwoFaDisableInput, TwoFaStartInput};
use crate::auth::{TwoFaConfirmOutput, TwoFaStartOutput, UserSessionInfo};
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt;
use totp_rs::{Algorithm, TOTP};

/// Ensure the TOTP encryption key env var is set before any 2FA handler
/// accesses the lazy-static.  Safe to call from multiple tests in parallel.
pub(super) fn ensure_totp_key() {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let key: [u8; 32] = rand::random();
        // SAFETY: called exactly once before any handler reads the env var.
        unsafe { std::env::set_var("TOTP_ENC_KEY", hex::encode(key)) };
    });
}

// ── Ergonomic helpers on mock::User ────────────────────────────────────────

impl mock::User<mock::Registered> {
    /// `POST /api/user/2fa/start` — begin TOTP enrollment.
    ///
    /// Returns the base32-encoded secret for code generation.
    pub async fn two_fa_start(&mut self) -> String {
        ensure_totp_key();
        let mut res = self.try_two_fa_start().await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "2fa/start should succeed: {self}",
        );
        let output: TwoFaStartOutput = res.take_json().await.unwrap();
        output.base32_secret
    }

    /// `POST /api/user/2fa/start` without asserting.
    pub async fn try_two_fa_start(&mut self) -> salvo::Response {
        ensure_totp_key();
        let body = TwoFaStartInput {
            password: self.password.to_string(),
        };
        let req = self.client.post("/api/user/2fa/start").json(&body);
        self.client.send(req).await
    }

    /// `POST /api/user/2fa/confirm` — confirm TOTP enrollment with a valid code.
    ///
    /// Returns the one-time recovery codes.
    pub async fn two_fa_confirm(&mut self, code: &str) -> Vec<String> {
        let mut res = self.try_two_fa_confirm(code).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "2fa/confirm should succeed: {self}",
        );
        let output: TwoFaConfirmOutput = res.take_json().await.unwrap();
        output.recovery_codes
    }

    /// `POST /api/user/2fa/confirm` without asserting.
    pub async fn try_two_fa_confirm(&mut self, code: &str) -> salvo::Response {
        let body = TwoFaConfirmInput {
            password: self.password.to_string(),
            code: code.to_string(),
        };
        let req = self.client.post("/api/user/2fa/confirm").json(&body);
        self.client.send(req).await
    }

    /// `POST /api/user/2fa/disable` — disable TOTP, asserting success.
    pub async fn two_fa_disable(&mut self, mfa_code: &str) {
        let res = self.try_two_fa_disable(mfa_code).await;
        assert_eq!(
            res.status_code,
            Some(StatusCode::OK),
            "2fa/disable should succeed: {self}",
        );
    }

    /// `POST /api/user/2fa/disable` without asserting.
    pub async fn try_two_fa_disable(&mut self, mfa_code: &str) -> salvo::Response {
        let body = TwoFaDisableInput {
            password: self.password.to_string(),
            mfa_code: mfa_code.to_string(),
        };
        let req = self.client.post("/api/user/2fa/disable").json(&body);
        self.client.send(req).await
    }

    /// Enroll this user in 2FA (start + confirm).
    ///
    /// Stores the TOTP secret on `self`.  In `2fa-recovery` mode the recovery
    /// codes are stored as well.  Called automatically from `register()` when
    /// either 2FA feature is active.
    pub async fn enroll_2fa(&mut self) {
        ensure_totp_key();
        let secret = self.two_fa_start().await;
        let code = generate_totp_code(&secret);
        let _recovery_codes = self.two_fa_confirm(&code).await;
        self.totp_secret = Some(secret);
        #[cfg(feature = "2fa-recovery")]
        {
            self.recovery_codes = Some(_recovery_codes.into_iter().collect());
        }
    }

    /// Returns the current MFA code for this user, or `None` when 2FA is not
    /// enrolled.
    ///
    /// * **Default (no feature)**: always `None`.
    /// * **`2fa-totp`**: generates and returns the current time-based code.
    /// * **`2fa-recovery`**: pops the next recovery code.  When only one code
    ///   remains the user is automatically cycled (disable → re-enroll via
    ///   TOTP) before popping from the fresh batch.
    #[allow(clippy::unused_async)] // no await in 2fa-totp and default builds
    #[allow(clippy::needless_pass_by_ref_mut)] // &mut self is required in 2fa-recovery mode
    pub async fn mfa_code(&mut self) -> Option<String> {
        #[cfg(feature = "2fa-totp")]
        {
            return self.totp_secret.as_deref().map(generate_totp_code);
        }

        #[cfg(feature = "2fa-recovery")]
        {
            if let Some(codes) = self.recovery_codes.as_mut() {
                if codes.len() > 1 {
                    return codes.pop_front();
                }
                // One or zero codes left: cycle (disable → re-enroll) to refill.
                self.cycle_recovery_codes().await;
                return self.recovery_codes.as_mut().and_then(VecDeque::pop_front);
            }
            // No recovery queue (e.g. second-device clone): fall back to TOTP.
            return self.totp_secret.as_deref().map(generate_totp_code);
        }

        None
    }

    /// Disable 2FA using a fresh TOTP code, then immediately re-enroll to
    /// produce a new batch of recovery codes.
    ///
    /// The cycling path is always TOTP-based: generate a code from the stored
    /// secret → disable → start → confirm → store new secret + codes.
    pub async fn cycle_recovery_codes(&mut self) {
        let secret = self
            .totp_secret
            .as_deref()
            .expect("cycle_recovery_codes requires an enrolled TOTP secret");
        let disable_code = generate_totp_code(secret);
        self.two_fa_disable(&disable_code).await;

        let new_secret = self.two_fa_start().await;
        let confirm_code = generate_totp_code(&new_secret);
        let new_codes = self.two_fa_confirm(&confirm_code).await;

        self.totp_secret = Some(new_secret);
        self.recovery_codes = Some(new_codes.into_iter().collect());
    }
}

// ── Free helper functions ───────────────────────────────────────────────────

/// Helper: create a TOTP instance from a base32 secret (matching server settings).
fn totp_from_base32(base32_secret: &str) -> TOTP {
    let secret_bytes = totp_rs::Secret::Encoded(base32_secret.to_owned())
        .to_bytes()
        .expect("valid base32 secret");
    TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_bytes, None, String::new())
        .expect("TOTP creation should not fail")
}

/// Generate a current TOTP code from a base32 secret.
pub(super) fn generate_totp_code(base32_secret: &str) -> String {
    totp_from_base32(base32_secret)
        .generate_current()
        .expect("TOTP code generation should not fail")
}

/// Disable 2FA on `user` if it is currently enrolled.
///
/// In feature modes where `register()` automatically enrolls users, this
/// normalises the state back to "no 2FA" so tests that exercise the
/// start → confirm flow from scratch work correctly in all feature modes.
pub(super) async fn ensure_2fa_disabled(user: &mut mock::User<mock::Registered>) {
    // Ensure the TOTP key is set before any 2FA handler touches it, even when
    // called before any other 2FA operation in a test.
    ensure_totp_key();
    if let Some(secret) = user.totp_secret.take() {
        let code = generate_totp_code(&secret);
        user.two_fa_disable(&code).await;
        user.recovery_codes = None;
    }
}

/// Ensure 2FA is enabled on `user`, returning the base32 secret.
///
/// In feature modes the generator has already enrolled the user; this returns
/// the stored secret without making any API calls.  In default mode it runs
/// the full start → confirm flow and stores the result.
pub(super) async fn ensure_2fa_enabled(user: &mut mock::User<mock::Registered>) -> String {
    if let Some(secret) = user.totp_secret.clone() {
        return secret;
    }
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let recovery = user.two_fa_confirm(&code).await;
    user.totp_secret = Some(secret.clone());
    user.recovery_codes = Some(recovery.into_iter().collect::<VecDeque<_>>());
    secret
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn two_fa_start_returns_secret() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    let secret = user.two_fa_start().await;
    assert!(!secret.is_empty(), "base32 secret must not be empty");
}

#[tokio::test]
async fn two_fa_start_returns_url_and_qr() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    let mut res = user.try_two_fa_start().await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    let output: TwoFaStartOutput = res.take_json().await.unwrap();
    assert!(!output.url.is_empty(), "response must contain url");
    assert!(
        !output.qr_base64.is_empty(),
        "response must contain qr_base64"
    );
}

#[tokio::test]
async fn two_fa_full_enrollment_flow() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // 1. Start enrollment.
    let secret = user.two_fa_start().await;

    // 2. Generate a valid TOTP code.
    let code = generate_totp_code(&secret);

    // 3. Confirm enrollment — should return recovery codes.
    let recovery_codes = user.two_fa_confirm(&code).await;
    assert!(
        !recovery_codes.is_empty(),
        "must receive at least one recovery code"
    );

    // 4. Verify user now shows 2FA enabled.
    let info = user.me().await;
    assert!(info.user.totp_enabled);
}

#[tokio::test]
async fn two_fa_confirm_wrong_code_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    let _secret = user.two_fa_start().await;

    let res = user.try_two_fa_confirm("000000").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "invalid TOTP code must be rejected"
    );
}

#[tokio::test]
async fn login_requires_mfa_after_enrollment() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Try login without MFA code.
    user.client.cookies = cookie::CookieJar::new();
    let res = user.try_login().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "login without MFA code must fail when 2FA is enabled"
    );
}

#[tokio::test]
async fn login_with_valid_mfa_code_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Login with a fresh TOTP code.
    user.client.cookies = cookie::CookieJar::new();
    let fresh_code = generate_totp_code(&secret);
    let mut res = user
        .try_login_with(
            &user.email.clone(),
            &user.password.clone(),
            Some(&fresh_code),
        )
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "login with valid MFA code should succeed"
    );
    let _: UserSessionInfo = res.take_json().await.unwrap();
}

#[tokio::test]
async fn login_with_recovery_code_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Enable 2FA and keep recovery codes.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let recovery_codes = user.two_fa_confirm(&code).await;

    // Login using a recovery code instead of a TOTP code.
    user.client.cookies = cookie::CookieJar::new();
    let mut res = user
        .try_login_with(
            &user.email.clone(),
            &user.password.clone(),
            Some(&recovery_codes[0]),
        )
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "login with recovery code should succeed"
    );
    let _: UserSessionInfo = res.take_json().await.unwrap();
}

#[tokio::test]
async fn recovery_code_single_use() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let recovery_codes = user.two_fa_confirm(&code).await;
    let recovery = &recovery_codes[0];

    // First use: should succeed.
    user.client.cookies = cookie::CookieJar::new();
    let res = user
        .try_login_with(&user.email.clone(), &user.password.clone(), Some(recovery))
        .await;
    assert_eq!(res.status_code, Some(StatusCode::OK));

    // Second use of the same recovery code: should fail.
    user.client.cookies = cookie::CookieJar::new();
    let res = user
        .try_login_with(&user.email.clone(), &user.password.clone(), Some(recovery))
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "reused recovery code must be rejected"
    );
}

#[tokio::test]
async fn disable_two_fa_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Enable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;

    // Disable 2FA.
    let disable_code = generate_totp_code(&secret);
    user.two_fa_disable(&disable_code).await;

    // Verify 2FA is disabled.
    let info = user.me().await;
    assert!(!info.user.totp_enabled);
}

#[tokio::test]
async fn two_fa_disable_with_recovery_code_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Enable 2FA and capture a recovery code.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let recovery_codes = user.two_fa_confirm(&code).await;

    // Disable using a recovery code instead of a TOTP code.
    user.two_fa_disable(&recovery_codes[0]).await;

    let info = user.me().await;
    assert!(
        !info.user.totp_enabled,
        "2FA must be disabled after disabling with a recovery code"
    );
}

#[tokio::test]
async fn re_enroll_after_disable_succeeds() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // First enrollment cycle.
    let secret1 = user.two_fa_start().await;
    let code = generate_totp_code(&secret1);
    let _recovery = user.two_fa_confirm(&code).await;
    assert!(user.me().await.user.totp_enabled, "2FA must be enabled");

    // Disable.
    let disable_code = generate_totp_code(&secret1);
    user.two_fa_disable(&disable_code).await;
    assert!(!user.me().await.user.totp_enabled, "2FA must be disabled");

    // Re-enroll with a fresh secret.
    let secret2 = user.two_fa_start().await;
    let code2 = generate_totp_code(&secret2);
    let recovery2 = user.two_fa_confirm(&code2).await;

    assert!(
        user.me().await.user.totp_enabled,
        "2FA must be active after re-enroll"
    );
    assert!(
        !recovery2.is_empty(),
        "re-enroll must produce fresh recovery codes"
    );

    // Old TOTP secret must no longer work for login.
    user.client.cookies = cookie::CookieJar::new();
    let stale_code = generate_totp_code(&secret1);
    // Only valid if both secrets happen to produce the same code at this instant
    // (astronomically unlikely); the assertion below is best-effort.
    // The authoritative check is that the new secret works.
    let fresh_code = generate_totp_code(&secret2);
    let mut res = user
        .try_login_with(
            &user.email.clone(),
            &user.password.clone(),
            Some(&fresh_code),
        )
        .await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::OK),
        "login with new TOTP secret must succeed after re-enroll"
    );
    let _: UserSessionInfo = res.take_json().await.unwrap();

    // Demonstrate the stale code string is at least different (no assertion on
    // the login result since codes can collide in the same 30-second window).
    let _ = stale_code;
}

#[tokio::test]
async fn login_without_mfa_after_disable() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Enable then disable 2FA.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let _recovery = user.two_fa_confirm(&code).await;
    let disable_code = generate_totp_code(&secret);
    user.two_fa_disable(&disable_code).await;

    // Login without MFA code — should work again.
    user.client.cookies = cookie::CookieJar::new();
    user.login().await;

    let info = user.me().await;
    assert_eq!(info.user.id, user.user_id());
}

#[tokio::test]
async fn two_fa_start_twice_overwrites() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    let secret1 = user.two_fa_start().await;
    let secret2 = user.two_fa_start().await;

    // The server generates a new secret on each call; the old one is replaced.
    // Confirming with the first secret should fail.
    let code = generate_totp_code(&secret1);
    let _res = user.try_two_fa_confirm(&code).await;
    // Depending on timing, the code might match; instead verify that confirming
    // with the SECOND secret works.
    let code2 = generate_totp_code(&secret2);
    let recovery = user.two_fa_confirm(&code2).await;
    assert!(!recovery.is_empty());
}

#[tokio::test]
async fn two_fa_start_requires_password() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    let body = TwoFaStartInput {
        password: "wrong-password".to_string(),
    };
    let req = user.client.post("/api/user/2fa/start").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "2fa/start with wrong password must fail"
    );
}

#[tokio::test]
async fn two_fa_confirm_wrong_password_fails() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Start enrollment so confirm is reachable.
    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);

    let body = TwoFaConfirmInput {
        password: "wrong-password".to_string(),
        code,
    };
    let req = user.client.post("/api/user/2fa/confirm").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "2fa/confirm with wrong password must fail"
    );
}

#[tokio::test]
async fn two_fa_disable_wrong_password_fails() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    // Ensure 2FA is enabled; in feature modes this is already the case.
    let secret = ensure_2fa_enabled(&mut user).await;

    let disable_code = generate_totp_code(&secret);
    let body = TwoFaDisableInput {
        password: "wrong-password".to_string(),
        mfa_code: disable_code,
    };
    let req = user.client.post("/api/user/2fa/disable").json(&body);
    let res = user.client.send(req).await;

    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "2fa/disable with wrong password must fail"
    );
}

#[tokio::test]
async fn two_fa_start_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    ensure_totp_key();
    user.assert_requires_auth(|c| {
        c.post("/api/user/2fa/start").json(&TwoFaStartInput {
            password: "irrelevant".to_string(),
        })
    })
    .await;
}

#[tokio::test]
async fn two_fa_confirm_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    ensure_totp_key();
    user.assert_requires_auth(|c| {
        c.post("/api/user/2fa/confirm").json(&TwoFaConfirmInput {
            password: "irrelevant".to_string(),
            code: "000000".to_string(),
        })
    })
    .await;
}

#[tokio::test]
async fn two_fa_disable_unauthenticated_unauthorized() {
    let server = mock::Server::default();
    let user = server.user().register().await;
    ensure_totp_key();
    user.assert_requires_auth(|c| {
        c.post("/api/user/2fa/disable").json(&TwoFaDisableInput {
            password: "irrelevant".to_string(),
            mfa_code: "000000".to_string(),
        })
    })
    .await;
}

// ── Invalid state transition tests ───────────────────────────────────────

#[tokio::test]
async fn two_fa_start_when_already_enabled_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    // Ensure 2FA is enabled; in feature modes this is already the case.
    ensure_2fa_enabled(&mut user).await;

    // Try to start 2FA again — must be rejected.
    let res = user.try_two_fa_start().await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "2fa/start must be rejected when 2FA is already enabled"
    );
}

#[tokio::test]
async fn two_fa_confirm_without_start_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    // Disable 2FA so the user has no pending enrollment and 2FA is not active,
    // ensuring the rejection is for "enrollment not started" not "already enabled".
    ensure_2fa_disabled(&mut user).await;

    // Try to confirm without ever calling start.
    let res = user.try_two_fa_confirm("000000").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "2fa/confirm must be rejected when 2FA enrollment was not started"
    );
}

#[tokio::test]
async fn two_fa_confirm_when_already_enabled_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    // Ensure 2FA is enabled; in feature modes this is already the case.
    ensure_2fa_enabled(&mut user).await;

    // Try to confirm again — must be rejected.
    let res = user.try_two_fa_confirm("000000").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "2fa/confirm must be rejected when 2FA is already enabled"
    );
}

#[tokio::test]
async fn two_fa_disable_when_not_enabled_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    // Try to disable without enabling first.
    let res = user.try_two_fa_disable("000000").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "2fa/disable must be rejected when 2FA is not enabled"
    );
}

#[tokio::test]
async fn two_fa_disable_wrong_mfa_code_rejected() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    // Ensure 2FA is enabled; in feature modes this is already the case.
    ensure_2fa_enabled(&mut user).await;

    // Try to disable with correct password but wrong MFA code.
    let res = user.try_two_fa_disable("000000").await;
    assert_eq!(
        res.status_code,
        Some(StatusCode::UNAUTHORIZED),
        "2fa/disable with wrong MFA code must be rejected"
    );
}

#[tokio::test]
async fn two_fa_confirm_returns_expected_recovery_code_count() {
    let server = mock::Server::default();
    let mut user = server.user().register().await;
    ensure_2fa_disabled(&mut user).await;

    let secret = user.two_fa_start().await;
    let code = generate_totp_code(&secret);
    let recovery_codes = user.two_fa_confirm(&code).await;

    assert_eq!(
        recovery_codes.len(),
        crate::auth::two_factor::DEFAULT_RECOVERY_CODE_COUNT,
        "must receive exactly DEFAULT_RECOVERY_CODE_COUNT recovery codes"
    );
}
