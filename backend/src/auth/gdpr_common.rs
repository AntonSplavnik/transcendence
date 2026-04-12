use chrono::{DateTime, Utc};
use salvo::oapi::ToSchema;
use serde::{Deserialize, Serialize};

/// Shared response for GDPR operation initiation endpoints.
#[derive(Serialize, Deserialize, ToSchema)]
pub struct InitiateResponse {
    /// Base64url-encoded 32-byte token. Pass back as a query param to execute.
    pub token: String,
    /// When `true`, the user must click the email confirmation link before the
    /// token can be used to execute the operation. `false` if the user's email
    /// is unconfirmed or the confirmation email could not be sent.
    pub email_confirmation_required: bool,
    pub expires_at: DateTime<Utc>,
}

/// Compute remaining minutes until `expires_at`, clamped to zero.
pub fn remaining_minutes_until(expires_at: DateTime<Utc>) -> u32 {
    u32::try_from((expires_at - Utc::now()).num_minutes().max(0)).unwrap_or(u32::MAX)
}
