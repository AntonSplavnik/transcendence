use std::sync::LazyLock;

use base64::Engine;
use base64::engine::general_purpose::{STANDARD as base64std, URL_SAFE_NO_PAD as base64url};
use chacha20poly1305::aead::{Aead, OsRng, Payload};
use chacha20poly1305::{AeadCore as _, KeyInit, XChaCha20Poly1305, XNonce};
use thiserror::Error;
use totp_rs::{Algorithm, Secret, TOTP};

use crate::auth::AuthError;
use crate::models::{NewTwoFaRecoveryCode, User};
use crate::prelude::*;

const TOTP_ISSUER: &str = "Transcendence";
const ENV_TOTP_ENC_KEY: &str = "TOTP_ENC_KEY";

const RECOVERY_CODE_BYTES: usize = 16; // 128-bit
const DEFAULT_RECOVERY_CODE_COUNT: usize = 10;

#[derive(Error, Debug, strum::IntoStaticStr)]
pub enum TwoFactorError {
    #[error("Two-factor authentication is not enabled for this user")]
    NotEnabled,
    #[error("Two-factor authentication is already enabled for this user")]
    AlreadyEnabled,
    #[error("Two-factor authentication enrollment has not been started")]
    NotStarted,
    #[error(
        "Another request to make changes to two-factor authentication occurred \
		while this one was in progress, thus rendering this request invalid"
    )]
    ConcurrentRequestRaced,
    #[error("Internal 2fa error: {0}")]
    Internal(String),
}

fn parse_32_byte_key(s: &str) -> Option<[u8; 32]> {
    let trimmed = s.trim();

    // Hex (64 chars)
    if trimmed.len() == 64 {
        if let Ok(bytes) = hex::decode(trimmed) {
            if bytes.len() == 32 {
                return Some(bytes.try_into().ok()?);
            }
        }
    }

    // Base64url no pad or standard base64
    for engine in [base64url, base64std] {
        if let Ok(bytes) = engine.decode(trimmed.as_bytes()) {
            if bytes.len() == 32 {
                return Some(bytes.try_into().ok()?);
            }
        }
    }

    None
}

static TOTP_ENC_KEY: LazyLock<Option<[u8; 32]>> = LazyLock::new(|| {
    let raw = std::env::var(ENV_TOTP_ENC_KEY).ok()?;
    parse_32_byte_key(&raw)
});

fn totp_enc_key() -> AppResult<[u8; 32]> {
    TOTP_ENC_KEY.as_ref().copied().ok_or_else(|| {
        ApiError::TwoFa(TwoFactorError::Internal(format!(
            "Bad server configuration: Missing/invalid TOTP encryption key in env var {}",
            ENV_TOTP_ENC_KEY
        )))
    })
}

fn cipher() -> AppResult<XChaCha20Poly1305> {
    let key = totp_enc_key()?;
    Ok(XChaCha20Poly1305::new((&key).into()))
}

pub fn encrypt_totp_secret(user_id: i32, secret: &[u8]) -> AppResult<String> {
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);

    let ciphertext = cipher()?
        .encrypt(
            &nonce,
            Payload {
                msg: secret,
                aad: &user_id.to_le_bytes(),
            },
        )
        .map_err(|err| {
            ApiError::TwoFa(TwoFactorError::Internal(format!(
                "Failed to encrypt TOTP secret: {}",
                err
            )))
        })?;

    let mut blob = Vec::with_capacity(nonce.len() + ciphertext.len());
    blob.extend_from_slice(&nonce);
    blob.extend_from_slice(&ciphertext);

    Ok(base64std.encode(blob))
}

pub fn decrypt_totp_secret(user_id: i32, secret_enc: &str) -> AppResult<Vec<u8>> {
    let bytes = base64std.decode(secret_enc.as_bytes()).map_err(|err| {
        ApiError::TwoFa(TwoFactorError::Internal(format!(
            "Invalid base64 for encrypted TOTP secret: {}",
            err
        )))
    })?;

    if bytes.len() < 24 {
        return Err(ApiError::TwoFa(TwoFactorError::Internal(
            "Encrypted TOTP secret too short".into(),
        )));
    }

    let (nonce, ciphertext) = bytes.split_at(24);

    cipher()?
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &user_id.to_le_bytes(),
            },
        )
        .map_err(|err| {
            ApiError::TwoFa(TwoFactorError::Internal(format!(
                "Failed to decrypt TOTP secret: {}",
                err
            )))
        })
}

pub fn totp_for_user(user: &User, secret_raw: Vec<u8>) -> TOTP {
    // Use SHA1 for broad authenticator compatibility.
    let issuer = Some(TOTP_ISSUER.to_string());
    let account_name = user.email.clone();

    TOTP::new(Algorithm::SHA1, 6, 1, 30, secret_raw, issuer, account_name)
        .expect("no colons (:) inside email and issuer name")
}

pub fn require_mfa_if_enabled(
    conn: &mut DbConn,
    user: &User,
    mfa_code: Option<&str>,
) -> AppResult<()> {
    if !user.totp_enabled {
        return Ok(());
    }

    let Some(code) = mfa_code.map(str::trim).filter(|s| !s.is_empty()) else {
        return Err(AuthError::TwoFactorRequired.into());
    };

    // Prefer the most likely path first (digits -> TOTP), but allow either.
    if looks_like_totp_code(code) {
        if check_totp_code(user, code)? {
            return Ok(());
        }
        if consume_recovery_code(conn, user.id, code)? {
            return Ok(());
        }
    } else {
        if consume_recovery_code(conn, user.id, code)? {
            return Ok(());
        }
        if check_totp_code(user, code)? {
            return Ok(());
        }
    }

    Err(AuthError::TwoFactorInvalid.into())
}

fn looks_like_totp_code(code: &str) -> bool {
    let len = code.len();
    (6..=8).contains(&len) && code.bytes().all(|b| b.is_ascii_digit())
}

fn check_totp_code(user: &User, code: &str) -> AppResult<bool> {
    let secret_enc = user.totp_secret_enc.as_deref().ok_or_else(|| {
        ApiError::TwoFa(TwoFactorError::Internal(
            "2FA enabled but no stored secret".into(),
        ))
    })?;

    let secret_raw = decrypt_totp_secret(user.id, secret_enc)?;
    let totp = totp_for_user(user, secret_raw);

    totp.check_current(code).map_err(|err| {
        ApiError::TwoFa(TwoFactorError::Internal(format!(
            "Failed to validate TOTP code (Time went backwards): {err}",
        )))
    })
}

pub fn generate_totp_secret() -> Secret {
    Secret::generate_secret()
}

pub fn generate_recovery_codes() -> Vec<String> {
    (0..DEFAULT_RECOVERY_CODE_COUNT)
        .map(|_| {
            let raw: [u8; RECOVERY_CODE_BYTES] = rand::random();
            base64url.encode(raw)
        })
        .collect()
}

fn hash_recovery_code(code: &str) -> Vec<u8> {
    blake3::hash(code.as_bytes()).as_bytes().to_vec()
}

pub fn replace_recovery_codes(
    conn: &mut DbConn,
    user_id_val: i32,
    codes_plain: &[String],
) -> AppResult<()> {
    use crate::schema::two_fa_recovery_codes::dsl::*;
    conn.transaction::<_, ApiError, _>(|conn| {
        diesel::delete(two_fa_recovery_codes.filter(user_id.eq(user_id_val))).execute(conn)?;

        if codes_plain.is_empty() {
            return Ok(());
        }

        let to_insert: Vec<NewTwoFaRecoveryCode> = codes_plain
            .iter()
            .map(|code| NewTwoFaRecoveryCode::new(user_id_val, hash_recovery_code(code)))
            .collect();

        diesel::insert_into(two_fa_recovery_codes)
            .values(&to_insert)
            .execute(conn)?;

        Ok(())
    })
}

pub fn consume_recovery_code(
    conn: &mut DbConn,
    user_id_val: i32,
    code_plain: &str,
) -> AppResult<bool> {
    use crate::schema::two_fa_recovery_codes::dsl::*;

    let now = chrono::Utc::now().naive_utc();
    let hash = hash_recovery_code(code_plain);

    let updated = diesel::update(
        two_fa_recovery_codes
            .filter(user_id.eq(user_id_val))
            .filter(code_hash.eq(hash))
            .filter(used_at.is_null()),
    )
    .set(used_at.eq(now))
    .execute(conn)?;

    Ok(updated == 1)
}
