//! [`NotificationManager`] – send-or-store + stream lifecycle.
//!
//! # Design Overview
//!
//! [`NotificationManager`] is the sole authority for delivering notifications to
//! connected users. It maintains a map of active [`StreamSink`]s keyed by `user_id`
//! and falls back to the database when no live stream is available.
//!
//! ## Delivery strategy
//!
//! ```text
//! send(user_id, payload)
//!   ├── user has a live stream?  → send directly over WebTransport (zero DB round-trip)
//!   │     └── send fails?        → remove stale entry, fall back to DB
//!   └── no stream (or cancelled) → persist to `notifications` table
//! ```
//!
//! ## Stream lifecycle
//!
//! 1. [`open_stream`](NotificationManager::open_stream) requests a uni-directional
//!    stream from [`StreamManager`], registers it in the map, drains the DB backlog,
//!    and spawns a cleanup task that removes the entry when the connection drops.
//! 2. The cleanup task waits on `sink.cancel_handle().cancelled()`, which fires on
//!    transport error OR parent connection cancellation — both indicate the sink is
//!    dead. It uses `remove_if` with identity equality to prevent ABA: only the sink
//!    that spawned the task removes the entry.
//! 3. [`close_stream`](NotificationManager::close_stream) may be called explicitly on
//!    disconnect; it is a no-op if the entry was already cleaned up.
//!
//! ## Concurrency model
//!
//! - `DashMap` shards provide fine-grained locking at the shard level.
//! - **Individual `DashMap` operations are atomic**, but sequences of operations are not.
//!   The only cross-operation invariant that matters here is ABA prevention in cleanup:
//!   `remove_if(&user_id, |_, v| v.eq(&sink))` ensures we only remove the entry for
//!   *this specific sink instance*, not a replacement registered by a concurrent
//!   `open_stream` call.
//! - **`open_stream` called concurrently for the same user**: the last writer wins
//!   (both insert; one overwrites the other). Both spawn cleanup tasks; each task
//!   removes only its own sink via identity check, so neither task removes the other's
//!   entry. The overwritten sink is simply dropped from the map and its cleanup task
//!   will eventually remove a key that is no longer its own — the `remove_if` predicate
//!   prevents it from doing any damage.
//! - **Ordering invariant** (insert-before-drain): the stream is registered in the map
//!   *before* the DB backlog is drained. This ensures that a concurrent `send()` call
//!   during the drain window writes to the live stream rather than the DB, avoiding
//!   an ordering inversion where fresh notifications arrive before the drained backlog.
//!   Payloads carry `created_at` timestamps so the client can sort correctly.
//!
//! ## Stale entry window
//!
//! There is a brief window between a connection dropping and the cleanup task removing
//! the entry. During this window `has_stream()` returns `false` for cancelled sinks
//! (it checks `is_cancelled()`) and `send()` will discover the dead channel, remove
//! the stale entry itself, and fall back to the DB. The cleanup task's subsequent
//! `remove_if` is a no-op if `send()` already removed it.

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
    /// The underlying WebTransport stream is gone or the user is not connected.
    #[error(transparent)]
    Stream(#[from] StreamManagerError),

    /// A database operation failed.
    #[error(transparent)]
    Db(#[from] DbError),

    /// Sending over an already-open stream failed (codec or transport error).
    ///
    /// This variant is returned when the mpsc channel to the forwarding task
    /// is closed, indicating the transport layer has already failed.
    #[error("failed to send notification to user {user_id}: {reason}")]
    Send { user_id: i32, reason: String },
}

/// Notification delivery manager.
///
/// Cheaply cloneable (`Arc`-backed). Injected into the Salvo router via
/// `affix_state::inject` and retrieved from the depot with
/// [`NotificationManagerDepotExt::notification_manager`](super::NotificationManagerDepotExt).
///
/// # Invariants
///
/// - At most one live (non-cancelled) stream per `user_id` is registered at any
///   given time. A second `open_stream` call for the same user overwrites the first.
/// - The cleanup task for each registered sink removes only its own entry (ABA-safe).
/// - Entries may be momentarily stale (cancelled but not yet removed). All public
///   methods handle this gracefully: `has_stream()` filters cancelled entries,
///   `send()` removes stale entries on first use.
#[derive(Clone)]
pub struct NotificationManager {
    /// Active notification streams keyed by `user_id`.
    ///
    /// An entry may briefly outlive the underlying connection while the cleanup
    /// task is waiting to be scheduled. Always check `is_cancelled()` before
    /// treating an entry as live.
    streams: Arc<DashMap<i32, StreamSink<WireNotification>, ahash::RandomState>>,
}

#[allow(dead_code)]
impl NotificationManager {
    /// Create a new, empty `NotificationManager`.
    pub fn new() -> Self {
        Self {
            streams: Arc::new(DashMap::default()),
        }
    }

    /// Send a notification to `user_id`.
    ///
    /// * If the user has an open, non-cancelled notification stream, the payload is
    ///   written directly to the wire (zero DB round-trip).
    /// * If no stream is registered, or the registered stream is cancelled, or the
    ///   send fails, the payload is persisted to the `notifications` table for later
    ///   delivery on reconnect.
    ///
    /// A broken or stale stream entry is automatically cleaned up as a side-effect of
    /// calling this method; the payload falls back to DB storage in that case.
    ///
    /// # Errors
    ///
    /// - [`NotificationError::Db`] — the DB fallback write failed.
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe. The `StreamSink::send` future is cancel-safe; if this future is
    /// dropped before the send completes, no message is written and DB state is
    /// unchanged. The stale-entry removal via `remove_if` is synchronous and cannot
    /// be partially applied.
    pub async fn send(
        &self,
        db: &Db,
        user_id: i32,
        payload: NotificationPayload,
    ) -> Result<(), NotificationError> {
        let created_at = chrono::Utc::now();

        // Fast path: try the open stream first.
        // Clone the sink out of the map so we don't hold a DashMap shard lock across
        // the async `send` call (a sync lock must never be held across `.await`).
        let sink = self
            .streams
            .get(&user_id)
            .filter(|r| !r.value().is_cancelled())
            .map(|r| r.value().clone());

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
                    // Channel closed — forwarding task has already exited (transport
                    // error or cancellation). Remove the stale entry; the cleanup task
                    // may already have done this, so `remove_if` is identity-guarded.
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
    /// Steps:
    /// 1. Requests a uni-directional stream from the given [`StreamManager`].
    /// 2. Registers the stream in the active map (replacing any previous entry).
    /// 3. Drains all pending notifications from the DB (oldest → newest) over the
    ///    new stream.
    /// 4. Spawns a cleanup task that removes the entry when the connection drops.
    ///
    /// **Ordering**: the stream is inserted *before* draining the DB backlog. This
    /// ensures a concurrent [`send`](Self::send) call during the drain window writes
    /// to the live stream rather than falling back to the DB, preventing out-of-order
    /// delivery. Notifications carry `created_at` timestamps so the client can sort.
    ///
    /// If the user already had an open stream it is silently replaced (the old
    /// `StreamSink` is dropped from the map, decrementing the mpsc sender refcount).
    ///
    /// If the DB drain fails after the stream is registered, the entry is removed and
    /// the error is returned. The spawned cleanup task for the failing stream will
    /// execute a no-op `remove_if` once the stream's cancel fires.
    ///
    /// # Errors
    ///
    /// - [`NotificationError::Stream`] — the `StreamManager` could not open a stream
    ///   (user not connected, or connection closed mid-open).
    /// - [`NotificationError::Db`] — reading the pending backlog from the DB failed.
    /// - [`NotificationError::Send`] — sending a backlog item over the new stream
    ///   failed; unsent items are re-persisted to the DB before returning this error.
    ///
    /// # Cancel Safety
    ///
    /// Not fully cancel-safe: if this future is dropped while draining the DB backlog
    /// (between `store_to_db` calls), some backlog items may be lost. In practice this
    /// is called once per WebTransport session establishment and is not used inside a
    /// `select!` branch.
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

        // Register before draining the DB — see ordering invariant in module doc.
        // Replaces any previous (possibly stale) entry for this user.
        self.streams.insert(user_id, sink.clone());

        // Spawn a cleanup task that removes this exact sink entry when the underlying
        // connection drops or the stream is cancelled for any reason.
        //
        // Owns: `streams` Arc clone, `sink_for_cleanup` (one extra sender refcount).
        // Terminates: when `sink_for_cleanup.cancel_handle().cancelled()` fires.
        // Joined: JoinHandle dropped — task is self-terminating and lightweight.
        //         The spawned task holds no locks and performs only a DashMap
        //         `remove_if`, which is fast. There is no need to await it.
        {
            let streams_map = Arc::clone(&self.streams);
            let sink_for_cleanup = sink.clone();
            // JoinHandle dropped intentionally — task is self-terminating. It owns
            // only an Arc clone and a StreamSink clone; no resource leak on drop.
            let _ = tokio::spawn(async move {
                sink_for_cleanup.cancel_handle().cancelled().await;
                // ABA prevention: only remove the entry if it is still our sink.
                // A concurrent `open_stream` may have replaced it with a new one.
                streams_map.remove_if(&user_id, |_, v| v.eq(&sink_for_cleanup));
                tracing::debug!(user_id, "notification stream cleaned up after disconnect");
            });
        }

        // Drain the DB backlog over the newly registered stream.
        let pending = match Self::drain_from_db(db, user_id).await {
            Ok(pending) => pending,
            Err(err) => {
                // Failed to read the backlog — remove the entry we just inserted so
                // subsequent `send` calls fall back to the DB correctly.
                // The cleanup task will fire a no-op `remove_if` later.
                self.streams.remove_if(&user_id, |_, v| v.eq(&sink));
                return Err(err.into());
            }
        };

        if pending.is_empty() {
            return Ok(());
        }

        tracing::debug!(
            user_id,
            count = pending.len(),
            "draining stored notifications"
        );

        let mut first_send_err: Option<NotificationError> = None;
        let mut unsent = SmallVec::<[OfflineNotification; 5]>::new();

        for notification in pending {
            if first_send_err.is_none() {
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
                    Ok(()) => continue,
                    Err(err) => {
                        // First send failure — record the error and remove the stale
                        // entry. Remaining notifications will be stored back to the DB.
                        first_send_err = Some(err);
                        self.streams.remove_if(&user_id, |_, v| v.eq(&sink));
                    }
                }
            }
            // Collect all notifications that could not be delivered (including the one
            // that triggered the error) for DB re-insertion.
            unsent.push(notification);
        }

        if !unsent.is_empty() {
            Self::store_back_to_db(db, unsent).await?;
        }

        // Return the first send error, if any. DB re-insertion errors take priority
        // via `?` above — if store_back_to_db failed, we propagate that instead.
        if let Some(err) = first_send_err {
            return Err(err);
        }

        Ok(())
    }

    /// Remove the notification stream for a user (e.g. on explicit disconnect).
    ///
    /// This is a no-op if no stream was registered or if the entry was already
    /// removed by the cleanup task. Does not cancel the underlying `StreamSink`
    /// — the forwarding task will exit when the parent connection token fires.
    ///
    /// Prefer relying on the automatic cleanup task spawned by [`open_stream`]
    /// rather than calling this directly; call it only when you need *immediate*
    /// removal before the cancellation token fires.
    pub fn close_stream(&self, user_id: i32) {
        self.streams.remove(&user_id);
    }

    /// Returns `true` if the user has an active, non-cancelled notification stream.
    ///
    /// A stream entry that is present in the map but whose sink is already cancelled
    /// (connection dropped but cleanup task not yet scheduled) returns `false`.
    ///
    /// Note: this is a point-in-time snapshot and subject to races — the stream may
    /// become cancelled immediately after this returns `true`. Use it only for
    /// diagnostics or fast-path hints, not as a synchronization primitive.
    pub fn has_stream(&self, user_id: i32) -> bool {
        self.streams
            .get(&user_id)
            .map(|r| !r.value().is_cancelled())
            .unwrap_or(false)
    }

    /// Insert a single notification into the `notifications` table.
    ///
    /// # Errors
    ///
    /// - [`DbError`] — the database write failed.
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

    /// Re-insert notifications that could not be delivered over a failing stream.
    ///
    /// Called during [`open_stream`](Self::open_stream) drain when the stream breaks
    /// mid-delivery. Inserts all `offline` rows back into the `notifications` table
    /// so they are not lost.
    ///
    /// # Errors
    ///
    /// - [`DbError`] — the database write failed.
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

    /// Load **and delete** all stored notifications for `user_id`, ordered oldest-first.
    ///
    /// Runs inside a write transaction so no notification can slip through between the
    /// `SELECT` and the `DELETE`. Any notification inserted concurrently after the
    /// `SELECT` but before the `DELETE` is within the same transaction and is included.
    ///
    /// # Errors
    ///
    /// - [`DbError`] — the transaction failed (SELECT, DELETE, or commit).
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
