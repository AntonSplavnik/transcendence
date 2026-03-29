//! [`NotificationManager`] – send-or-store + stream lifecycle.
//!
//! See the [module-level docs](super) for the high-level design.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use diesel::prelude::*;
use smallvec::SmallVec;
use thiserror::Error;

use super::NotificationPayload;
use crate::db::{Database as _, Db, DbError};
use crate::models::cbor_blob::CborBlob;
use crate::models::{NewOfflineNotification, OfflineNotification};
use crate::notifications::WireNotification;
use crate::schema::notifications::{self};
use crate::stream::{
    DEFAULT_SINK_BUFFER, StreamManager, StreamManagerError, StreamSink, StreamType,
};

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
    streams: Arc<DashMap<i32, StreamSink<WireNotification>, ahash::RandomState>>,
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
        let sink = {
            self.streams
                .get(&user_id)
                .map(|sink_ref| sink_ref.value().clone())
        };

        if let Some(sink) = sink {
            match sink
                .send(WireNotification {
                    payload: payload.clone(),
                    created_at,
                })
                .await
            {
                Ok(_) => return Ok(()),
                Err(_) => {
                    tracing::warn!(
                        user_id,
                        "notification stream channel closed, falling back to DB"
                    );

                    self.streams.remove_if(&user_id, |_, v| v.eq(&sink));
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
        let sink = streams
            .request_uni_stream::<WireNotification>(
                user_id,
                StreamType::Notifications,
                DEFAULT_SINK_BUFFER,
            )
            .await?;

        // Register (replaces any previous sink for this user).
        // Inserting before draining the DB ensures that a parallel send() call
        // that comes in while we're draining will write to the new stream
        // instead of falling back to the DB, leaving the DB entry undelivered until the next reconnect.
        // This might deliver new notifications before the backlog, but because every payload
        // is tagged with the send timestamp, the client can sort them correctly.
        self.streams.insert(user_id, sink.clone());

        // Spawn a cleanup task: when the WebTransport connection drops (or the
        // sink is cancelled for any reason), remove the stale entry.
        // `cancel_handle().cancelled()` fires when the parent connection token
        // is cancelled (disconnect) OR when the forwarding task cancels due to
        // a transport error — both mean the sink is no longer usable.
        {
            let streams = self.streams.clone();
            let sink_for_cleanup = sink.clone();
            tokio::spawn(async move {
                sink_for_cleanup.cancel_handle().cancelled().await;
                streams.remove_if(&user_id, |_, v| v.eq(&sink_for_cleanup));
                tracing::debug!(user_id, "notification stream cleaned up after disconnect");
            });
        }

        // Drain the DB backlog.
        let pending = match Self::drain_from_db(db, user_id).await {
            Ok(pending) => pending,
            Err(err) => {
                // Clean up the sink we just registered if draining fails,
                // to avoid leaving a stale entry in the manager.
                self.streams.remove_if(&user_id, |_, v| v.eq(&sink));
                return Err(err.into());
            }
        };
        if !pending.is_empty() {
            tracing::debug!(
                user_id,
                count = pending.len(),
                "draining stored notifications"
            );
            let mut res = None;
            let mut unsent = SmallVec::<[OfflineNotification; 5]>::new();
            for notification in pending {
                if res.is_none() {
                    match sink
                        .send(WireNotification {
                            payload: notification.data.clone().into_inner(),
                            created_at: notification.created_at,
                        })
                        .await
                        .map_err(|e| NotificationError::Send {
                            user_id,
                            reason: e.to_string(),
                        }) {
                        Ok(_) => continue,
                        Err(err) => {
                            res = Some(err);
                            self.streams.remove_if(&user_id, |_, v| v.eq(&sink));
                        }
                    }
                }
                unsent.push(notification);
            }
            if !unsent.is_empty() {
                Self::store_back_to_db(db, unsent).await?;
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

    async fn store_back_to_db(
        db: &Db,
        offline: SmallVec<[OfflineNotification; 5]>,
    ) -> Result<(), DbError> {
        db.write(move |conn| {
            diesel::insert_into(notifications::table)
                .values(&*offline)
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
    async fn drain_from_db(db: &Db, user_id: i32) -> Result<Vec<OfflineNotification>, DbError> {
        Ok(db
            .transaction_write(move |conn| {
                let rows: Vec<OfflineNotification> = notifications::table
                    .filter(notifications::user_id.eq(user_id))
                    .order(notifications::created_at.asc())
                    .load(conn)?;

                let to_delete = rows.iter().map(|row| row.id);
                diesel::delete(notifications::table.filter(notifications::id.eq_any(to_delete)))
                    .execute(conn)?;

                Ok(rows)
            })
            .await?)
    }
}
