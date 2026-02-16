//! Notification subsystem.
//!
//! [`NotificationPayload`] defines *what* a notification carries.
//! [`NotificationManager`] owns the delivery logic:
//!
//! * If the target user has an open notification stream, the message is sent
//!   directly over WebTransport (zero DB round-trip).
//! * Otherwise it is persisted to the `notifications` table so it can be
//!   drained when the user reconnects.
//!
//! # Opening a notification stream
//!
//! Call [`NotificationManager::open_stream`] once per WebTransport session.
//! It will:
//!
//! 1. Request a uni-directional stream from [`StreamManager`](crate::stream::StreamManager).
//! 2. Drain every pending row from the DB (oldest first).
//! 3. Register the stream so subsequent [`send`](NotificationManager::send)
//!    calls go straight to the wire.

mod manager;

use chrono::{DateTime, Utc};
#[allow(unused_imports)]
pub use manager::{NotificationError, NotificationManager};

/// Extension trait for convenient [`NotificationManager`] access from a Salvo
/// [`Depot`](salvo::Depot).
///
/// Requires `affix_state::inject(NotificationManager::new())` to be registered
/// upstream in the router.
///
/// # Example
///
/// ```ignore
/// use crate::notifications::NotificationManagerDepotExt as _;
///
/// async fn my_handler(depot: &mut Depot) {
///     let nm = depot.notification_manager();
///     nm.send(depot.db(), user_id, payload).await.unwrap();
/// }
/// ```
pub trait NotificationManagerDepotExt {
    /// Retrieve the injected [`NotificationManager`].
    ///
    /// # Panics
    ///
    /// Panics if the `affix_state` hoop was not registered upstream.
    fn notification_manager(&self) -> &NotificationManager;
}

impl NotificationManagerDepotExt for salvo::Depot {
    fn notification_manager(&self) -> &NotificationManager {
        self.obtain::<NotificationManager>()
            .expect("NotificationManager not found in depot. Make sure to inject it in the router with affix_state::inject")
    }
}

/// Notification wire / storage payload.
///
/// Payload variant contents must be robust enough to still work after long-term storage in the DB.
/// Every variant must be cheaply de/serializable.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum NotificationPayload {
    /// Client successfully connected to the server's streaming infrastructure.
    ServerHello,
    // example:
    // FriendRequest { invitation_id: i32, sender_id: i32 },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WireNotification {
    pub payload: NotificationPayload,
    pub created_at: DateTime<Utc>,
}
