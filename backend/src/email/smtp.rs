use std::sync::Arc;
use std::time::Duration;

use lettre::message::Mailbox;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

use super::{EmailError, EmailSender, TransactionalEmail};
use crate::config::EmailConfig;

/// Production / development [`EmailSender`] backed by an SMTP connection
/// (works with both Mailpit locally and AWS SES in production).
///
/// Cloning is cheap (`Arc`).
#[derive(Clone)]
pub struct SmtpEmailSender {
    inner: Arc<SmtpInner>,
}

struct SmtpInner {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
    base_url: String,
}

impl SmtpEmailSender {
    /// Build a new sender from the application [`EmailConfig`].
    ///
    /// # Errors
    /// Returns [`EmailError`] if the SMTP relay cannot be configured or the from-address is invalid.
    pub fn new(config: &EmailConfig) -> Result<Self, EmailError> {
        let builder = if config.smtp_tls {
            AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)?
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.smtp_host)
        }
        .port(config.smtp_port);

        let builder = match (&config.smtp_username, &config.smtp_password) {
            (Some(user), Some(pass)) => {
                builder.credentials(Credentials::new(user.clone(), pass.clone()))
            }
            _ => builder,
        };

        let transport = builder.build();

        let from: Mailbox = config.from_address.parse()?;

        Ok(Self {
            inner: Arc::new(SmtpInner {
                transport,
                from,
                base_url: config.base_url.clone(),
            }),
        })
    }
}

impl EmailSender for SmtpEmailSender {
    async fn send(
        &self,
        user: &crate::models::User,
        email: TransactionalEmail,
    ) -> Result<(), EmailError> {
        // All variants except EmailConfirmation require a confirmed email
        if !matches!(email, TransactionalEmail::EmailConfirmation { .. })
            && user.email_confirmed_at.is_none()
        {
            return Err(EmailError::UnconfirmedEmail);
        }

        let (subject, body) = email.render(&self.inner.base_url, user);

        let message = Message::builder()
            .from(self.inner.from.clone())
            .to(user.email.parse()?)
            .subject(subject)
            .header(ContentType::TEXT_PLAIN)
            .body(body)?;

        tokio::time::timeout(Duration::from_secs(10), async {
            self.inner.transport.send(message).await?;
            Ok::<(), EmailError>(())
        })
        .await
        .map_err(|_| EmailError::Timeout)??;

        Ok(())
    }
}
