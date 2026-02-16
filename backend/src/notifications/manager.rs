//! [`NotificationManager`] – send-or-store + stream lifecycle.
//!
//! See the [module-level docs](super) for the high-level design.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use diesel::prelude::*;
use thiserror::Error;

use super::NotificationPayload;
use crate::db::{Database as _, Db, DbError};
use crate::models::NewOfflineNotification;
use crate::models::cbor_blob::CborBlob;
use crate::schema::notifications::{self};
use crate::stream::{Sender, SharedSender, StreamManager, StreamManagerError, StreamType};

/// Errors produced by [`NotificationManager`] operations.
#[derive(Debug, Error)]
pub enum NotificationError {
    /// The underlying WebTransport stream is gone.
    #[error(transparent)]
    Stream(#[from] StreamManagerError),

    /// A database operation failed.
    #[error(transparent)]
    Db(#[from] DbError),

    /// Sending over an already-open stream failed (codec / transport error).
    #[error("failed to send notification to user {user_id}: {reason}")]
    Send { user_id: i32, reason: String },
}

/// Notification delivery manager.
///
/// Cheaply cloneable (`Arc`-backed). Injected into the Salvo router via
/// `affix_state::inject` and retrieved from the depot with
/// [`NotificationManagerDepotExt::notification_manager`](super::NotificationManagerDepotExt).
#[derive(Clone)]
pub struct NotificationManager {
    /// Active notification streams keyed by `user_id`.
    streams: Arc<DashMap<i32, SharedSender<NotificationPayload>, ahash::RandomState>>,
}

#[allow(dead_code)]
impl NotificationManager {
    pub fn new() -> Self {
        Self {
            streams: Arc::new(DashMap::default()),
        }
    }

    /// Send a notification to `user_id`.
    ///
    /// * If the user has an open notification stream the payload is written
    ///   directly to the wire.
    /// * Otherwise the notification is stored to the database for later
    ///   delivery.
    ///
    /// A broken stream is automatically cleaned up; in that case the payload
    /// falls back to DB storage.
    pub async fn send(
        &self,
        db: &Db,
        user_id: i32,
        payload: NotificationPayload,
    ) -> Result<(), NotificationError> {
        let created_at = chrono::Utc::now();
        // Fast path: try the open stream first.
        let sender = {
            self.streams
                .get(&user_id)
                .map(|sender_ref| sender_ref.value().clone())
        };

        if let Some(sender) = sender {
            match sender.send(payload.clone()).await {
                Ok(()) => return Ok(()),
                Err(_) => {
                    tracing::warn!(
                        user_id,
                        "notification stream channel closed, falling back to DB"
                    );

                    self.streams.remove_if(&user_id, |_, v| v.eq(&sender));
                }
            }
        }

        // Slow path: persist to the database.
        Self::store_to_db(db, user_id, payload, created_at).await?;
        Ok(())
    }

    /// Open (or replace) a notification stream for `user_id`.
    ///
    /// 1. Requests a uni-directional stream from the given [`StreamManager`].
    /// 2. Drains all pending notifications from the DB (oldest → newest).
    /// 3. Registers the stream so future [`send`](Self::send) calls use
    ///    it directly.
    ///
    /// If the user already had an open stream it is silently replaced (the
    /// old `Sender` is dropped, which closes the WebTransport stream on the
    /// client side).
    pub async fn open_stream(
        &self,
        db: &Db,
        streams: &StreamManager,
        user_id: i32,
    ) -> Result<(), NotificationError> {
        let sender: Sender<NotificationPayload> = streams
            .request_uni_stream(user_id, StreamType::Notifications)
            .await?;

        let sender = SharedSender::new(sender);

        // Register (replaces any previous sender for this user).
        // Inserting before draining the DB ensures that a parallel send() call
        // that comes in while we're draining will write to the new stream
        // instead of falling back to the DB, leaving the DB entry undelivered until the next reconnect.
        // Drawback of this approach: Might deliver new notifications before the backlog, which could be confusing for the user.
        self.streams.insert(user_id, sender.clone());

        // Drain the DB backlog.
        let pending = Self::drain_from_db(db, user_id).await?;
        if !pending.is_empty() {
            tracing::debug!(
                user_id,
                count = pending.len(),
                "draining stored notifications"
            );
            for payload in pending {
                sender
                    .send(payload)
                    .await
                    .map_err(|e| NotificationError::Send {
                        user_id,
                        reason: e.to_string(),
                    })?;
            }
        }
        Ok(())
    }

    /// Remove the notification stream for a user (e.g. on disconnect).
    ///
    /// This is a no-op if no stream was registered.
    pub fn close_stream(&self, user_id: i32) {
        self.streams.remove(&user_id);
    }

    /// Returns `true` if the user has an active notification stream.
    pub fn has_stream(&self, user_id: i32) -> bool {
        self.streams.contains_key(&user_id)
    }

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

    /// Load **and delete** all stored notifications for `user_id`, ordered
    /// oldest-first.
    ///
    /// Runs inside a write transaction so no notification can slip through
    /// between the SELECT and the DELETE.
    async fn drain_from_db(db: &Db, user_id: i32) -> Result<Vec<NotificationPayload>, DbError> {
        Ok(db
            .transaction_write(move |conn| {
                let rows: Vec<CborBlob<NotificationPayload>> = notifications::table
                    .filter(notifications::user_id.eq(user_id))
                    .order(notifications::created_at.asc())
                    .select(notifications::data)
                    .load(conn)?;

                diesel::delete(notifications::table.filter(notifications::user_id.eq(user_id)))
                    .execute(conn)?;

                Ok(rows
                    .into_iter()
                    .map(CborBlob::into_inner)
                    .collect::<Vec<_>>())
            })
            .await?)
    }
}
