//! Per-user stream utility with async locking and race-free lifecycle.
//!
//! [`UserStream<P>`] is the default abstraction for modules that need per-user
//! streams with independent state and operations that must be atomic across async
//! boundaries (DB writes, confirmed sends). It owns all lock acquisition — callers
//! implement trait hooks called at the right time, under the right lock.
//!
//! # Design
//!
//! Where [`StreamRoom`](super::StreamRoom) uses a single `parking_lot::Mutex` that
//! covers ALL users (appropriate for shared state + broadcast), `UserStream` uses a
//! per-user `tokio::sync::Mutex` that covers ONE user. This allows I/O under the
//! lock (DB reads/writes, confirmed sends) without blocking other users.
//!
//! | | StreamRoom | UserStream |
//! |---|---|---|
//! | Lock granularity | Entire room (all users) | Per-user |
//! | Lock type | `parking_lot::Mutex` (sync) | `tokio::Mutex` (async) |
//! | Trait methods | Synchronous | Async |
//! | I/O under lock | Forbidden (would block all users) | Allowed (only blocks one user) |
//! | Use case | Multi-user rooms with shared state | Per-user streams with independent state |
//!
//! # Concurrency Model
//!
//! - `DashMap` provides sharded, concurrent access to per-user `Arc<tokio::sync::Mutex<_>>`.
//! - All operations for a given user serialize on the user's `tokio::Mutex`.
//! - The `DashMap` shard lock is held only for the duration of a `get`/`entry` call
//!   (nanoseconds). The `tokio::Mutex` is held across async work (DB I/O, confirmed
//!   sends) — this is safe because it only blocks that one user.
//! - No DashMap shard lock is ever held across an `.await` point.
//!
//! # Ephemeral Slot Lifecycle
//!
//! DashMap entries exist only while a stream is live or an operation is in progress:
//!
//! 1. **`open_stream`**: creates slot (locked), opens stream, initializes state,
//!    calls `on_open`, releases lock. Entry persists with live stream.
//! 2. **`with_live_or_else` for offline user**: creates ephemeral slot (locked),
//!    calls offline fallback, releases lock, immediately removes slot.
//! 3. **Cleanup task**: on stream cancel, acquires lock, calls `on_close`,
//!    clears live connection, removes DashMap entry via `try_lock` + `remove_if`.
//!
//! Ghost entries cannot persist. Every code path that leaves a slot empty also
//! calls `try_remove_empty_slot`. If `try_lock` fails because another operation
//! holds the lock, that operation will either populate the slot (live stream)
//! or remove it when done (ephemeral).
//!
//! # Receive Handler Design (bidi streams)
//!
//! The receive handler runs on its own spawned task, OUTSIDE the per-user lock —
//! same pattern as `StreamRoom`. If it needs per-user state, it calls `UserStream`
//! methods which acquire the lock internally. This avoids holding the lock for the
//! entire duration of receive handling.
//!
//! # Race Condition Elimination
//!
//! The original `NotificationManager` had a check-then-act race between `send()`
//! and `open_stream()`. `UserStream` eliminates this because both operations
//! acquire the same per-user `tokio::Mutex`:
//!
//! ```text
//! send():                              open_stream():
//!   1. get_or_create slot                2. get_or_create slot
//!   3. lock (blocks if 4 holds lock)     4. lock
//!                                        5. open stream, set live
//!                                        6. on_open (drain DB)
//!                                        7. release lock
//!   8. lock acquired
//!   9. live exists → send directly
//! ```
//!
//! The lock ensures `send()` either sees the live stream (sends directly) or
//! runs its offline fallback atomically — there is no window where a notification
//! can be written to the DB after `open_stream` has already drained it.

use std::future::Future;
use std::sync::Arc;

use dashmap::DashMap;
use serde::Serialize;
use thiserror::Error;
use tokio::sync::Mutex as AsyncMutex;

use super::cancel::CancelReason;
use super::sink::StreamSink;
use super::StreamType;
#[cfg(not(test))]
use super::stream_manager::StreamManager;
use super::stream_manager::StreamManagerError;

/// Protocol trait for per-user stream lifecycle.
///
/// Implementors define the message type, per-user state, and lifecycle hooks.
/// All hooks are called under the per-user `tokio::Mutex` — safe for I/O.
///
/// # Differences from [`RoomProtocol`](super::RoomProtocol)
///
/// - `&self` (not `&mut self`) — the protocol is shared across all users via
///   `Arc`. Per-user mutation goes through `State`.
/// - `Send + Sync` — required because the protocol lives behind `Arc`, shared
///   across tasks.
/// - Async methods — the per-user `tokio::Mutex` allows async I/O under lock.
/// - No `Clone` requirement on `Send` type — confirmed send does not require
///   cloning (the message is moved into the oneshot envelope). If a caller
///   needs `Clone` for its own purposes, it can add the bound on its concrete
///   type.
///
/// # Callback Contract
///
/// All callbacks are called while the per-user `tokio::Mutex` is held. They
/// MAY perform I/O (DB reads/writes, confirmed sends). They MUST NOT:
/// - **Panic** — leaves per-user state inconsistent.
/// - **Acquire the DashMap shard lock** — it is not held, but acquiring it
///   could create lock-ordering issues with other operations.
/// - **Call other `UserStream` methods for the same user** — would deadlock
///   (re-entrant lock on the same `tokio::Mutex`).
pub trait UserStreamProtocol: Send + Sync + 'static {
    /// Server → client message type.
    type Send: Serialize + Send + 'static;

    /// Per-user state. Created fresh on each [`open_stream`](UserStream::open_stream)
    /// via [`init_state`](Self::init_state), consumed (moved out) on
    /// [`on_close`](Self::on_close). Not persisted across connections.
    type State: Send + 'static;

    /// Caller-provided context for `open_stream`. Flows into `on_open` under
    /// the per-user lock. Use `()` for protocols that need no open-time context.
    type OpenContext: Send;

    /// Protocol-specific rejection reason. Use `std::convert::Infallible` for
    /// protocols that never reject (makes the `Rejected` variant unreachable).
    type OpenReject: std::error::Error + Send + 'static;

    /// Stream type identifier (e.g., `StreamType::Notifications`).
    fn stream_type(&self) -> StreamType;

    /// Create fresh per-user state for a new connection.
    fn init_state(&self, user_id: i32, context: &Self::OpenContext) -> Self::State;

    /// Called under per-user lock after the stream is opened and state initialized.
    ///
    /// Return `Ok(())` to proceed. Return `Err(reason)` to reject.
    /// On error, `on_close` is NOT called.
    fn on_open(
        &self,
        user_id: i32,
        state: &mut Self::State,
        context: Self::OpenContext,
        sink: &StreamSink<Self::Send>,
    ) -> impl Future<Output = Result<(), Self::OpenReject>> + Send;

    /// Called under per-user lock when a stream is closed.
    /// State is consumed (moved out).
    fn on_close(
        &self,
        user_id: i32,
        state: Self::State,
    ) -> impl Future<Output = ()> + Send;
}

/// Internal per-user slot behind the `tokio::Mutex`.
///
/// # Invariants
///
/// - `live` is `None` ONLY in two transient states, both unobservable to
///   external callers because the per-user `tokio::Mutex` is held:
///   1. During `open_stream`, between slot creation and `live` being set.
///   2. During `with_live_or_else` for an offline user (ephemeral slot).
struct UserSlot<P: UserStreamProtocol> {
    live: Option<LiveConnection<P>>,
}

/// A live stream connection with its per-user state.
struct LiveConnection<P: UserStreamProtocol> {
    sink: StreamSink<P::Send>,
    state: P::State,
}

/// Errors from [`UserStream::open_stream`].
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum OpenError<R: std::error::Error + Send + 'static> {
    /// Failed to open the WebTransport stream.
    #[error("failed to open stream: {0}")]
    StreamOpen(#[from] StreamManagerError),

    /// The protocol rejected the open via `on_open`.
    #[error("open rejected: {0}")]
    Rejected(R),
}

/// Errors from [`UserStream::send`].
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum SendError<S> {
    /// No active stream for this user. Message returned.
    #[error("no active stream for user")]
    NoStream(S),

    /// The stream's mpsc channel is closed. Message returned.
    #[error("stream channel closed")]
    ChannelClosed(S),
}

/// Per-user stream utility with async locking and race-free lifecycle.
///
/// # Invariants
///
/// - At most one live (non-cancelled) stream per `user_id` at any time.
/// - DashMap entries are ephemeral: they exist only while a stream is live
///   or an operation is in progress. No ghost entries in steady state.
/// - Every successful `on_open` is paired with exactly one `on_close`.
/// - Per-user state (`P::State`) is created fresh on each `open_stream`
///   and consumed on `on_close`. It does not persist across connections.
///
/// # Lock Level: 1 (per-user tokio::Mutex)
pub struct UserStream<P: UserStreamProtocol> {
    users: DashMap<i32, Arc<AsyncMutex<UserSlot<P>>>, ahash::RandomState>,
    protocol: Arc<P>,
}

impl<P: UserStreamProtocol> UserStream<P> {
    /// Create a new, empty `UserStream` with the given protocol.
    pub fn new(protocol: P) -> Arc<Self> {
        Arc::new(Self {
            users: DashMap::with_hasher(ahash::RandomState::new()),
            protocol: Arc::new(protocol),
        })
    }

    /// Read-only access to the protocol (for diagnostics, tests).
    pub fn protocol(&self) -> &P {
        &self.protocol
    }

    /// Whether a user has an active, non-cancelled stream.
    #[must_use]
    pub fn has_stream(&self, user_id: i32) -> bool {
        self.users.get(&user_id).is_some_and(|entry| {
            entry
                .value()
                .try_lock()
                .ok()
                .and_then(|guard| guard.live.as_ref().map(|l| !l.sink.is_cancelled()))
                .unwrap_or(false)
        })
    }

    /// Open (or replace) a uni-directional stream for `user_id`.
    /// Production version — uses StreamManager.
    #[cfg(not(test))]
    pub async fn open_stream(
        self: &Arc<Self>,
        sm: &StreamManager,
        user_id: i32,
        context: P::OpenContext,
    ) -> Result<(), OpenError<P::OpenReject>> {
        use super::sink::DEFAULT_SINK_BUFFER;

        let sink = sm
            .request_uni_stream::<P::Send>(user_id, self.protocol.stream_type(), DEFAULT_SINK_BUFFER)
            .await?;

        self.open_stream_inner(user_id, context, sink).await
    }

    /// Shared open logic for production and test paths.
    async fn open_stream_inner(
        self: &Arc<Self>,
        user_id: i32,
        context: P::OpenContext,
        sink: StreamSink<P::Send>,
    ) -> Result<(), OpenError<P::OpenReject>> {
        let slot_arc = self
            .users
            .entry(user_id)
            .or_insert_with(|| Arc::new(AsyncMutex::new(UserSlot { live: None })))
            .value()
            .clone();

        let mut guard = slot_arc.lock().await;

        // If a previous connection exists, close it.
        if let Some(prev) = guard.live.take() {
            prev.sink.cancel(CancelReason::Removed);
            self.protocol.on_close(user_id, prev.state).await;
        }

        // Initialize state, set live.
        let state = self.protocol.init_state(user_id, &context);
        guard.live = Some(LiveConnection {
            sink: sink.clone(),
            state,
        });

        // Call on_open under lock.
        if let Err(reject) = self
            .protocol
            .on_open(
                user_id,
                &mut guard.live.as_mut()
                    .expect("just set live to Some above")
                    .state,
                context,
                &sink,
            )
            .await
        {
            guard.live.take();
            sink.cancel(CancelReason::Removed);
            drop(guard);
            self.try_remove_empty_slot(user_id);
            return Err(OpenError::Rejected(reject));
        }

        // Spawn cleanup task before releasing lock.
        self.spawn_cleanup_task(user_id, &sink);

        Ok(())
    }

    /// Close a user's stream immediately.
    pub fn close_stream(&self, user_id: i32) {
        if let Some(entry) = self.users.get(&user_id) {
            if let Ok(guard) = entry.value().try_lock() {
                if let Some(live) = &guard.live {
                    live.sink.cancel(CancelReason::Removed);
                }
            }
        }
    }

    /// Spawn a cleanup task that fires when the sink is cancelled.
    fn spawn_cleanup_task(self: &Arc<Self>, user_id: i32, sink: &StreamSink<P::Send>) {
        let weak = Arc::downgrade(self);
        let expected_sink = sink.clone();
        let _ = tokio::spawn(async move {
            expected_sink.cancel_handle().cancelled().await;

            let Some(us) = weak.upgrade() else {
                return;
            };

            let slot_arc = match us.users.get(&user_id) {
                Some(entry) => entry.value().clone(),
                None => return,
            };

            let mut guard = slot_arc.lock().await;

            // ABA check: only clean up if this is still our sink.
            let is_match = guard
                .live
                .as_ref()
                .is_some_and(|l| l.sink == expected_sink);

            if is_match {
                let live = guard.live.take()
                    .expect("just checked it's Some via is_match");
                us.protocol.on_close(user_id, live.state).await;
            }

            if guard.live.is_none() {
                drop(guard);
                us.try_remove_empty_slot(user_id);
            }

            if is_match {
                tracing::debug!(
                    user_id,
                    reason = ?expected_sink.reason(),
                    "user stream cleaned up after disconnect"
                );
            }
        });
    }

    /// Remove a DashMap entry if the slot is empty and unlocked.
    fn try_remove_empty_slot(&self, user_id: i32) {
        self.users.remove_if(&user_id, |_, slot_arc| {
            match slot_arc.try_lock() {
                Ok(guard) => guard.live.is_none(),
                Err(_) => false,
            }
        });
    }
}

#[cfg(test)]
impl<P: UserStreamProtocol> UserStream<P>
where
    P::Send: serde::de::DeserializeOwned,
{
    /// Test-mode constructor. Returns `Arc<Self>` (same as `new`).
    pub fn new_test(protocol: P) -> Arc<Self> {
        Self::new(protocol)
    }

    /// Test-mode open: creates a `DuplexStream`-backed sink.
    /// Returns the sink clone for test inspection.
    pub async fn open_stream_test(
        self: &Arc<Self>,
        user_id: i32,
        context: P::OpenContext,
    ) -> Result<StreamSink<P::Send>, OpenError<P::OpenReject>> {
        use tokio_util::codec::FramedWrite;
        use tokio_util::sync::CancellationToken;

        use super::compress_cbor_codec::CompressedCborEncoder;
        use super::sink::DEFAULT_SINK_BUFFER;
        use super::tests::test_utils::DUPLEX_BUFFER;

        let (server_write, _client_read) = tokio::io::duplex(DUPLEX_BUFFER);
        let framed_write = FramedWrite::new(server_write, CompressedCborEncoder::<P::Send>::new());
        let token = CancellationToken::new();
        let sink = StreamSink::new(framed_write, token, DEFAULT_SINK_BUFFER);
        let sink_clone = sink.clone();

        self.open_stream_inner(user_id, context, sink).await?;

        Ok(sink_clone)
    }
}
