pub mod confirm;
mod smtp;

pub use confirm::EmailConfirmationError;
pub use smtp::SmtpEmailSender;

#[cfg(test)]
mod mock;

#[cfg(test)]
mod tests;

/// The active [`EmailSender`] implementation, selected at compile time.
#[cfg(not(test))]
pub type Mailer = SmtpEmailSender;

/// In test builds the mailer is swapped for an in-memory mock.
#[cfg(test)]
pub type Mailer = mock::MockEmailSender;

// ── Transactional email variants ─────────────────────────────────────────

/// Every email the system can send.  Each variant carries exactly the data
/// its template needs — callers never build raw HTML.
#[derive(Debug, Clone)]
pub enum TransactionalEmail {
    EmailConfirmation {
        nickname: String,
        confirmation_token: String,
    },
    // Future: GdprDataExport { download_url: String },
    // Future: GdprDeletionNotice,
}

// ── Error ────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error(transparent)]
    Smtp(#[from] lettre::transport::smtp::Error),

    #[error(transparent)]
    Address(#[from] lettre::address::AddressError),

    #[error("failed to build email: {0}")]
    Build(#[from] lettre::error::Error),
}

// ── Trait ─────────────────────────────────────────────────────────────────

/// Async email-sending abstraction.
///
/// Implementations must be cheaply cloneable (`Arc`-backed), thread-safe,
/// and `'static` — same contract as [`Database`](crate::db::Database).
#[allow(async_fn_in_trait)]
pub trait EmailSender: Send + Sync + Clone + 'static {
    /// Send a transactional email to the given address.
    async fn send(&self, to: &str, email: TransactionalEmail) -> Result<(), EmailError>;
}

// ── Depot integration ────────────────────────────────────────────────────

pub trait DepotEmailExt {
    /// Retrieve a reference to the injected mailer.
    ///
    /// # Panics
    /// Panics if the [`Mailer`] was not injected into the depot.
    fn mailer(&self) -> &Mailer;
}

impl DepotEmailExt for salvo::Depot {
    fn mailer(&self) -> &Mailer {
        self.obtain::<Mailer>().expect(
            "Mailer not found in depot. \
             Make sure it is injected in the router with affix_state::inject",
        )
    }
}

// ── Template rendering (private) ─────────────────────────────────────────

impl TransactionalEmail {
    /// Returns `(subject, plain-text body)` for this email variant.
    pub(crate) fn render(&self, base_url: &str) -> (&'static str, String) {
        match self {
            Self::EmailConfirmation {
                nickname,
                confirmation_token,
            } => (
                "Confirm your email",
                format!(
                    "Hi {nickname},\n\n\
                     Please confirm your email by visiting the link below:\n\n\
                     {base_url}/api/email/confirm?token={confirmation_token}\n\n\
                     If you did not create an account, you can safely ignore this email.",
                ),
            ),
        }
    }
}
