//! [`NotificationManager`] – race-free notification delivery via [`UserStream`].
//!
//! # Design Overview
//!
//! [`NotificationManager`] is the sole authority for delivering notifications to
//! connected users. It wraps a [`UserStream<NotificationProtocol>`] that handles
//! all per-user stream lifecycle, locking, and cleanup.
//!
//! ## Delivery strategy
//!
//! ```text
//! send(user_id, payload)
//!   ├── user has a live stream? → send directly over WebTransport (zero DB round-trip)
//!   │     └── send fails?       → fall back to DB (under per-user lock)
//!   └── no stream               → persist to `notifications` table (under per-user lock)
//! ```
//!
//! ## Race condition elimination
//!
//! The previous implementation had a check-then-act race between `send()` and
//! `open_stream()`. `UserStream` eliminates this by serializing both operations
//! on a per-user `tokio::Mutex`. The DB fallback in `send()` and the DB drain
//! in `open_stream()` both run under the same lock — a notification cannot be
//! written to the DB after `open_stream` has already drained it.
//!
//! ## At-least-once delivery
//!
//! `on_open` drains the DB backlog using `send_confirmed_batch`. Each message
//! is deleted from the DB only after confirmed transport-level delivery. If the
//! future is dropped mid-drain, undelivered messages remain in the DB for the
//! next reconnect.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use diesel::prelude::*;
use thiserror::Error;

use super::NotificationPayload;
use crate::db::{Database as _, Db, DbError};
use crate::models::cbor_blob::CborBlob;
use crate::models::{NewOfflineNotification, OfflineNotification};
use crate::notifications::WireNotification;
use crate::schema::notifications::{self};
use crate::stream::{
    OpenError, StreamManager, StreamManagerError, StreamSink, StreamType,
    UserStream, UserStreamProtocol,
};

/// Errors produced by [`NotificationManager`] operations.
#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum NotificationError {
    /// The underlying WebTransport stream is gone or the user is not connected.
    #[error(transparent)]
    Stream(#[from] StreamManagerError),

    /// A database operation failed.
    #[error(transparent)]
    Db(#[from] DbError),

    /// Sending over an already-open stream failed (codec or transport error).
    #[error("failed to send notification to user {user_id}: {reason}")]
    Send { user_id: i32, reason: String },

    /// The protocol rejected the open.
    #[error("open stream failed: {0}")]
    Open(String),
}

/// Protocol implementation for the notification stream.
///
/// Handles DB drain on open and DB fallback on offline send.
/// The `Db` handle is stored in the protocol because it's needed
/// by the async trait hooks.
pub(super) struct NotificationProtocol {
    db: Db,
}

impl UserStreamProtocol for NotificationProtocol {
    type Send = WireNotification;
    /// Notifications have no per-user state — each stream is independent.
    type State = ();
    /// No context needed to open a notification stream.
    type OpenContext = ();
    /// Notification streams never reject on open (DB errors are propagated
    /// as `NotificationError`, not as protocol rejection).
    type OpenReject = NotificationOpenError;

    fn stream_type(&self) -> StreamType {
        StreamType::Notifications
    }

    fn init_state(&self, _user_id: i32, _context: &()) {}

    /// Drain pending notifications from the DB over the new stream.
    ///
    /// Uses `send_confirmed_batch` for at-least-once delivery. Each message
    /// is deleted from the DB only after confirmed transport-level delivery.
    async fn on_open(
        &self,
        user_id: i32,
        _state: &mut (),
        _context: (),
        sink: &StreamSink<WireNotification>,
    ) -> Result<(), NotificationOpenError> {
        let pending = load_from_db(&self.db, user_id)
            .await
            .map_err(|e| NotificationOpenError(format!("DB load failed: {e}")))?;

        if pending.is_empty() {
            return Ok(());
        }

        tracing::debug!(
            user_id,
            count = pending.len(),
            "draining stored notifications"
        );

        // Convert to wire format for the batch send.
        let wire_msgs: Vec<WireNotification> = pending
            .iter()
            .map(|n| WireNotification {
                payload: n.data.clone().into_inner(),
                created_at: n.created_at,
            })
            .collect();

        match sink.send_confirmed_batch(wire_msgs).await {
            Ok(()) => {
                // All sent — bulk delete from DB.
                let ids: Vec<i32> = pending.iter().map(|n| n.id).collect();
                if let Err(e) = bulk_delete_from_db(&self.db, &ids).await {
                    tracing::warn!(
                        user_id,
                        count = ids.len(),
                        error = %e,
                        "failed to bulk-delete delivered notifications; may be re-delivered on reconnect"
                    );
                }
            }
            Err(e) => {
                // Partial delivery — delete only the sent ones.
                if e.sent > 0 {
                    let sent_ids: Vec<i32> = pending[..e.sent].iter().map(|n| n.id).collect();
                    if let Err(del_err) = bulk_delete_from_db(&self.db, &sent_ids).await {
                        tracing::warn!(
                            user_id,
                            sent = e.sent,
                            error = %del_err,
                            "failed to delete partially-delivered notifications"
                        );
                    }
                }
                return Err(NotificationOpenError(format!(
                    "batch send failed after {} messages: {}",
                    e.sent, e.source
                )));
            }
        }

        Ok(())
    }

    async fn on_close(&self, user_id: i32, _state: ()) {
        tracing::debug!(user_id, "notification stream closed");
    }
}

/// Notification open rejection.
#[derive(Debug, Error)]
#[error("{0}")]
pub struct NotificationOpenError(String);

/// Notification delivery manager.
///
/// Cheaply cloneable (`Arc`-backed `UserStream`). Injected into the Salvo
/// router via `affix_state::inject`.
///
/// # Invariants
///
/// All invariants are enforced by the underlying [`UserStream`]:
/// - At most one live stream per user.
/// - Race-free send/open via per-user `tokio::Mutex`.
/// - No ghost DashMap entries after disconnect.
#[derive(Clone)]
pub struct NotificationManager {
    user_stream: Arc<UserStream<NotificationProtocol>>,
    db: Db,
}

#[allow(dead_code)]
impl NotificationManager {
    /// Create a new `NotificationManager`.
    pub fn new(db: Db) -> Self {
        let protocol = NotificationProtocol { db: db.clone() };
        Self {
            user_stream: UserStream::new(protocol),
            db,
        }
    }

    /// Send a notification to `user_id`.
    ///
    /// If the user has a live stream, the payload is sent directly over
    /// WebTransport (zero DB round-trip). If no stream exists, the payload
    /// is persisted to the `notifications` table.
    ///
    /// Uses [`with_live_or_else`](UserStream::with_live_or_else) for race-safe
    /// coordination: the DB fallback runs under the same per-user lock that
    /// `open_stream` holds during drain. A notification cannot be written to
    /// the DB after `open_stream` has already drained it.
    ///
    /// # Errors
    ///
    /// - [`NotificationError::Db`] — the DB fallback write failed.
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe. See [`StreamSink::send`] for the online path.
    /// The DB write is atomic (single INSERT).
    pub async fn send(
        &self,
        user_id: i32,
        payload: NotificationPayload,
    ) -> Result<(), NotificationError> {
        let created_at = chrono::Utc::now();
        let wire = WireNotification {
            payload: payload.clone(),
            created_at,
        };
        let db = self.db.clone();
        let db_offline = db.clone();
        let payload_offline = payload.clone();

        self.user_stream
            .with_live_or_else(
                user_id,
                move |sink, _state| {
                    let sink = sink.clone();
                    let db = db.clone();
                    async move {
                        match sink.send(wire).await {
                            Ok(()) => Ok(()),
                            Err(_) => {
                                // Channel closed — fall back to DB.
                                tracing::warn!(
                                    user_id,
                                    "notification stream channel closed, falling back to DB"
                                );
                                store_to_db(&db, user_id, payload, created_at).await
                                    .map_err(NotificationError::from)
                            }
                        }
                    }
                },
                || async move {
                    store_to_db(&db_offline, user_id, payload_offline, created_at).await
                        .map_err(NotificationError::from)
                },
            )
            .await
    }

    /// Open (or replace) a notification stream for `user_id`.
    ///
    /// Delegates to [`UserStream::open_stream`]. The protocol's `on_open`
    /// drains the DB backlog using confirmed batch sends.
    ///
    /// # Errors
    ///
    /// - [`NotificationError::Stream`] — could not open the WebTransport stream.
    /// - [`NotificationError::Open`] — DB drain or batch send failed.
    pub async fn open_stream(
        &self,
        streams: &StreamManager,
        user_id: i32,
    ) -> Result<(), NotificationError> {
        self.user_stream
            .open_stream(streams, user_id, ())
            .await
            .map_err(|e| match e {
                OpenError::StreamOpen(e) => NotificationError::Stream(e),
                OpenError::Rejected(e) => NotificationError::Open(e.to_string()),
            })
    }

    /// Remove the notification stream for a user.
    pub fn close_stream(&self, user_id: i32) {
        self.user_stream.close_stream(user_id);
    }

    /// Returns `true` if the user has an active, non-cancelled notification stream.
    pub fn has_stream(&self, user_id: i32) -> bool {
        self.user_stream.has_stream(user_id)
    }
}

// ── DB helpers (module-level functions, not methods) ────────────────────

/// Insert a single notification into the `notifications` table.
async fn store_to_db(
    db: &Db,
    user_id: i32,
    payload: NotificationPayload,
    created_at: DateTime<Utc>,
) -> Result<(), DbError> {
    db.write(move |conn| {
        let row = NewOfflineNotification {
            user_id,
            data: CborBlob::new(payload),
            created_at,
        };
        diesel::insert_into(notifications::table)
            .values(&row)
            .execute(conn)
    })
    .await??;
    Ok(())
}

/// Load all stored notifications for `user_id`, ordered oldest-first.
async fn load_from_db(db: &Db, user_id: i32) -> Result<Vec<OfflineNotification>, DbError> {
    Ok(db
        .read(move |conn| {
            notifications::table
                .filter(notifications::user_id.eq(user_id))
                .order(notifications::created_at.asc())
                .load(conn)
        })
        .await??)
}

/// Bulk delete notifications by primary key.
async fn bulk_delete_from_db(db: &Db, ids: &[i32]) -> Result<(), DbError> {
    let ids = ids.to_vec();
    db.write(move |conn| {
        diesel::delete(notifications::table.filter(notifications::id.eq_any(&ids))).execute(conn)
    })
    .await??;
    Ok(())
}
