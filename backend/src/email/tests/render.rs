use crate::email::TransactionalEmail;

fn test_user(email_confirmed: bool) -> crate::models::User {
    crate::models::User {
        id: 1,
        email: "alice@example.com".into(),
        nickname: crate::models::nickname::Nickname::from_str("alice"),
        totp_enabled: false,
        totp_secret_enc: None,
        totp_confirmed_at: None,
        password_hash: String::new(),
        created_at: chrono::Utc::now(),
        description: String::new(),
        tos_accepted_at: None,
        email_confirmed_at: if email_confirmed {
            Some(chrono::Utc::now())
        } else {
            None
        },
        email_confirmation_token_hash: None,
        email_confirmation_token_expires_at: None,
        email_confirmation_token_email: None,
    }
}

// ── EmailConfirmation ────────────────────────────────────────────────────

#[test]
fn email_confirmation_subject() {
    let user = test_user(false);
    let (subject, _) = TransactionalEmail::EmailConfirmation {
        confirmation_token: "tok123".into(),
    }
    .render("https://example.com", &user);
    assert_eq!(subject, "Confirm your email");
}

#[test]
fn email_confirmation_body_contains_token_url() {
    let user = test_user(false);
    let (_, body) = TransactionalEmail::EmailConfirmation {
        confirmation_token: "tok123".into(),
    }
    .render("https://example.com", &user);
    assert!(
        body.contains("https://example.com/api/email/confirm?token=tok123"),
        "body must contain the full confirmation URL"
    );
}

#[test]
fn email_confirmation_body_contains_nickname() {
    let user = test_user(false);
    let (_, body) = TransactionalEmail::EmailConfirmation {
        confirmation_token: "tok".into(),
    }
    .render("https://example.com", &user);
    assert!(
        body.contains("alice"),
        "body must address the user by nickname"
    );
}

// ── AccountDeletionConfirmation ──────────────────────────────────────────

#[test]
fn account_deletion_confirmation_subject() {
    let user = test_user(true);
    let (subject, _) = TransactionalEmail::AccountDeletionConfirmation {
        confirm_url: "https://example.com/confirm-delete".into(),
        remaining_minutes: 30,
    }
    .render("https://example.com", &user);
    assert_eq!(subject, "Confirm account deletion");
}

#[test]
fn account_deletion_confirmation_body_contains_url_and_minutes() {
    let user = test_user(true);
    let (_, body) = TransactionalEmail::AccountDeletionConfirmation {
        confirm_url: "https://example.com/confirm-delete".into(),
        remaining_minutes: 30,
    }
    .render("https://example.com", &user);
    assert!(
        body.contains("https://example.com/confirm-delete"),
        "body must contain the confirmation URL"
    );
    assert!(body.contains("30"), "body must mention remaining minutes");
}

// ── AccountDeleted ───────────────────────────────────────────────────────

#[test]
fn account_deleted_subject() {
    let user = test_user(true);
    let (subject, _) = TransactionalEmail::AccountDeleted.render("https://example.com", &user);
    assert_eq!(subject, "Your account has been deleted");
}

#[test]
fn account_deleted_body_contains_nickname() {
    let user = test_user(true);
    let (_, body) = TransactionalEmail::AccountDeleted.render("https://example.com", &user);
    assert!(
        body.contains("alice"),
        "body must address the user by nickname"
    );
}

// ── DataExportConfirmation ───────────────────────────────────────────────

#[test]
fn data_export_confirmation_subject() {
    let user = test_user(true);
    let (subject, _) = TransactionalEmail::DataExportConfirmation {
        confirm_url: "https://example.com/confirm-export".into(),
        remaining_minutes: 15,
    }
    .render("https://example.com", &user);
    assert_eq!(subject, "Confirm data export");
}

#[test]
fn data_export_confirmation_body_contains_url_and_minutes() {
    let user = test_user(true);
    let (_, body) = TransactionalEmail::DataExportConfirmation {
        confirm_url: "https://example.com/confirm-export".into(),
        remaining_minutes: 15,
    }
    .render("https://example.com", &user);
    assert!(
        body.contains("https://example.com/confirm-export"),
        "body must contain the confirmation URL"
    );
    assert!(body.contains("15"), "body must mention remaining minutes");
}

// ── DataExported ─────────────────────────────────────────────────────────

#[test]
fn data_exported_subject() {
    let user = test_user(true);
    let (subject, _) = TransactionalEmail::DataExported.render("https://example.com", &user);
    assert_eq!(subject, "Your data export is ready");
}

#[test]
fn data_exported_body_contains_nickname() {
    let user = test_user(true);
    let (_, body) = TransactionalEmail::DataExported.render("https://example.com", &user);
    assert!(
        body.contains("alice"),
        "body must address the user by nickname"
    );
}
