use std::sync::Arc;

use parking_lot::Mutex;

use super::{EmailError, EmailSender, TransactionalEmail};

/// Test-only [`EmailSender`] that records every email in memory.
///
/// Cloning is cheap (`Arc`).
#[derive(Clone)]
pub struct MockEmailSender {
    sent: Arc<Mutex<Vec<SentEmail>>>,
}

/// A captured outbound email.
#[derive(Debug, Clone)]
pub struct SentEmail {
    pub to: String,
    pub email: TransactionalEmail,
}

impl MockEmailSender {
    pub fn new() -> Self {
        Self {
            sent: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Return a snapshot of all emails sent so far.
    pub fn sent_emails(&self) -> Vec<SentEmail> {
        self.sent.lock().clone()
    }

    /// Drain and return all sent emails (useful for assertions).
    pub fn take_emails(&self) -> Vec<SentEmail> {
        std::mem::take(&mut *self.sent.lock())
    }
}

impl EmailSender for MockEmailSender {
    async fn send(
        &self,
        user: &crate::models::User,
        email: TransactionalEmail,
    ) -> Result<(), EmailError> {
        // Mirror the SMTP implementation: reject unconfirmed email for non-confirmation variants
        if !matches!(email, TransactionalEmail::EmailConfirmation { .. })
            && user.email_confirmed_at.is_none()
        {
            return Err(EmailError::UnconfirmedEmail);
        }

        self.sent.lock().push(SentEmail {
            to: user.email.clone(),
            email,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::email::EmailSender as _;

    fn unconfirmed_user() -> crate::models::User {
        crate::models::User {
            id: 1,
            email: "user@example.com".into(),
            nickname: crate::models::nickname::Nickname::from_str("testuser"),
            totp_enabled: false,
            totp_secret_enc: None,
            totp_confirmed_at: None,
            password_hash: String::new(),
            created_at: chrono::Utc::now(),
            description: String::new(),
            tos_accepted_at: None,
            email_confirmed_at: None,
            email_confirmation_token_hash: None,
            email_confirmation_token_expires_at: None,
            email_confirmation_token_email: None,
        }
    }

    fn confirmed_user() -> crate::models::User {
        crate::models::User {
            email_confirmed_at: Some(chrono::Utc::now()),
            ..unconfirmed_user()
        }
    }

    #[tokio::test]
    async fn send_email_confirmation_to_unconfirmed_user_succeeds() {
        let mailer = MockEmailSender::new();
        let user = unconfirmed_user();
        let result = mailer
            .send(
                &user,
                TransactionalEmail::EmailConfirmation {
                    confirmation_token: "tok".into(),
                },
            )
            .await;
        assert!(
            result.is_ok(),
            "EmailConfirmation must be sendable to unconfirmed users"
        );
        assert_eq!(mailer.sent_emails().len(), 1);
    }

    #[tokio::test]
    async fn send_non_confirmation_to_unconfirmed_user_returns_unconfirmed_error() {
        let mailer = MockEmailSender::new();
        let user = unconfirmed_user();
        let result = mailer.send(&user, TransactionalEmail::AccountDeleted).await;
        assert!(
            matches!(result, Err(EmailError::UnconfirmedEmail)),
            "non-confirmation variants must be rejected for unconfirmed users"
        );
        assert_eq!(
            mailer.sent_emails().len(),
            0,
            "failed send must not record an email"
        );
    }

    #[tokio::test]
    async fn send_non_confirmation_to_confirmed_user_succeeds() {
        let mailer = MockEmailSender::new();
        let user = confirmed_user();
        let result = mailer.send(&user, TransactionalEmail::AccountDeleted).await;
        assert!(
            result.is_ok(),
            "non-confirmation variants must be allowed for confirmed users"
        );
        assert_eq!(mailer.sent_emails().len(), 1);
    }

    #[tokio::test]
    async fn take_emails_drains_sent_list() {
        let mailer = MockEmailSender::new();
        let user = unconfirmed_user();
        mailer
            .send(
                &user,
                TransactionalEmail::EmailConfirmation {
                    confirmation_token: "t1".into(),
                },
            )
            .await
            .unwrap();

        let first_drain = mailer.take_emails();
        assert_eq!(first_drain.len(), 1, "take_emails must return the sent email");
        let second_drain = mailer.take_emails();
        assert_eq!(
            second_drain.len(),
            0,
            "take_emails must drain the list — second call must return empty"
        );
    }

    #[tokio::test]
    async fn sent_emails_does_not_drain() {
        let mailer = MockEmailSender::new();
        let user = unconfirmed_user();
        mailer
            .send(
                &user,
                TransactionalEmail::EmailConfirmation {
                    confirmation_token: "tok".into(),
                },
            )
            .await
            .unwrap();

        let snapshot1 = mailer.sent_emails();
        let snapshot2 = mailer.sent_emails();
        assert_eq!(snapshot1.len(), 1, "sent_emails must return all emails");
        assert_eq!(
            snapshot2.len(),
            1,
            "sent_emails must not drain — second call must still return 1 email"
        );
    }

    #[tokio::test]
    async fn multiple_emails_recorded_in_order() {
        let mailer = MockEmailSender::new();
        let user = confirmed_user();

        mailer.send(&user, TransactionalEmail::AccountDeleted).await.unwrap();
        mailer.send(&user, TransactionalEmail::DataExported).await.unwrap();

        let emails = mailer.take_emails();
        assert_eq!(emails.len(), 2, "both emails must be recorded");
        assert!(
            matches!(emails[0].email, TransactionalEmail::AccountDeleted),
            "first email must be AccountDeleted"
        );
        assert!(
            matches!(emails[1].email, TransactionalEmail::DataExported),
            "second email must be DataExported"
        );
    }
}
