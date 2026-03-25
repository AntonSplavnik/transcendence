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
