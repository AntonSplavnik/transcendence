pub mod confirm;
mod smtp;

pub use confirm::EmailConfirmationError;
pub use smtp::SmtpEmailSender;

#[cfg(test)]
pub(crate) mod mock;

#[cfg(test)]
mod tests;

/// The active [`EmailSender`] implementation, selected at compile time.
#[cfg(not(test))]
pub type Mailer = SmtpEmailSender;

/// In test builds the mailer is swapped for an in-memory mock.
#[cfg(test)]
pub type Mailer = mock::MockEmailSender;

// ── Transactional email variants ─────────────────────────────────────────

/// Every email the system can send. Each variant carries exactly the data
/// its template needs — callers never build raw HTML.
/// The recipient address and nickname are obtained from the `&User` passed
/// to [`EmailSender::send`].
#[derive(Debug, Clone)]
pub enum TransactionalEmail {
    EmailConfirmation {
        confirmation_token: String,
    },
    /// Confirmation email for account deletion request.
    AccountDeletionConfirmation {
        confirm_url: String,
        remaining_minutes: u32,
    },
    /// Notification after account has been deleted.
    AccountDeleted,
    /// Confirmation email for data export request.
    DataExportConfirmation {
        confirm_url: String,
        remaining_minutes: u32,
    },
    /// Notification after data has been exported.
    DataExported,
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

    #[error("email is not confirmed")]
    UnconfirmedEmail,

    #[error("email send timed out")]
    Timeout,
}

// ── Trait ─────────────────────────────────────────────────────────────────

/// Async email-sending abstraction.
///
/// Implementations must be cheaply cloneable (`Arc`-backed), thread-safe,
/// and `'static` — same contract as [`Database`](crate::db::Database).
///
/// For all variants except `EmailConfirmation`, the user's email must be
/// confirmed (`email_confirmed_at.is_some()`). Returns
/// `Err(EmailError::UnconfirmedEmail)` otherwise.
///
/// Implementations must apply a 10-second timeout to the underlying
/// send operation so that SMTP disruptions do not hang callers.
#[allow(async_fn_in_trait)]
pub trait EmailSender: Send + Sync + Clone + 'static {
    /// Send a transactional email to the given user.
    async fn send(
        &self,
        user: &crate::models::User,
        email: TransactionalEmail,
    ) -> Result<(), EmailError>;
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
    pub(crate) fn render(
        &self,
        base_url: &str,
        user: &crate::models::User,
    ) -> (&'static str, String) {
        let nickname: &str = user.nickname.as_ref();
        match self {
            Self::EmailConfirmation {
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
            Self::AccountDeletionConfirmation {
                confirm_url,
                remaining_minutes,
            } => (
                "Confirm account deletion",
                format!(
                    "Hi {nickname},\n\n\
                     You requested to delete your account. Please confirm by visiting the link below:\n\n\
                     {confirm_url}\n\n\
                     This link expires in {remaining_minutes} minutes.\n\n\
                     If you did not request this, you can safely ignore this email.",
                ),
            ),
            Self::AccountDeleted => (
                "Your account has been deleted",
                format!(
                    "Hi {nickname},\n\n\
                     Your account has been successfully deleted and your personal data has been removed.\n\n\
                     If you did not request this, please contact support immediately.",
                ),
            ),
            Self::DataExportConfirmation {
                confirm_url,
                remaining_minutes,
            } => (
                "Confirm data export",
                format!(
                    "Hi {nickname},\n\n\
                     You requested an export of your personal data. Please confirm by visiting the link below:\n\n\
                     {confirm_url}\n\n\
                     This link expires in {remaining_minutes} minutes.\n\n\
                     If you did not request this, you can safely ignore this email.",
                ),
            ),
            Self::DataExported => (
                "Your data export is ready",
                format!(
                    "Hi {nickname},\n\n\
                     Your personal data has been exported successfully.\n\n\
                     If you did not request this, please change your password immediately.",
                ),
            ),
        }
    }
}
