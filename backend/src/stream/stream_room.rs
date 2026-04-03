//! Fully managed room with co-located state and broadcast.
//!
//! [`StreamRoom<P>`] is the default abstraction for modules that need shared state
//! plus member broadcast (chat, game lobbies, spectator views). It co-locates
//! application state, member sinks, and pending reservations under a **single
//! `parking_lot::Mutex`**. Every operation — join, leave, broadcast, state
//! mutation — is atomic with respect to the room's state.
//!
//! # Design
//!
//! Members go directly from pending to Active. There is no Initializing state.
//! `join_with()` calls `on_member_joining`, reads `init_messages`, sends them
//! via `try_send`, inserts the member, and broadcasts the join — all in one
//! lock acquisition (step 3). The broadcast-before-init race is eliminated by
//! construction: there is no window between "member visible" and "init sent."
//!
//! # Concurrency Model
//!
//! - Single `parking_lot::Mutex` protects all room state.
//! - `try_send` is lock-free (mpsc channel op) — safe to call under the lock.
//! - `CancelHandle` operations are lock-free (`OnceLock` + `CancellationToken`).
//! - No `.await` inside any lock scope.
//! - Cleanup tasks hold `Weak<StreamRoom>` — no preventing room drop.
//!
//! # Why `parking_lot::Mutex`
//!
//! All lock acquisitions are synchronous blocks with no `.await` inside.
//! `parking_lot` does not poison on panic (unlike `std::sync::Mutex`), which
//! is defense-in-depth — if a callback panics despite the documented contract,
//! the lock is released and subsequent operations can proceed.
//!
//! # Callback Panic Recovery
//!
//! `PendingGuard::drop()` re-acquires the lock on panic. Partial state mutations
//! from `on_member_joining` are NOT rolled back (Rust has no transaction
//! semantics). `on_member_left` is NOT called after a panic. The room is
//! effectively broken after a callback panic — the correct response is to
//! discard the `Arc<StreamRoom>` and not use it further.

use std::convert::Infallible;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use futures::Stream;
use indexmap::{IndexMap, IndexSet};
use parking_lot::Mutex;
use serde::Serialize;
use tokio::task::JoinHandle;

use super::cancel::{CancelHandle, CancelReason};
use super::sink::{DEFAULT_SINK_BUFFER, MAX_INIT_MESSAGES, StreamSink};
#[cfg(not(test))]
use super::stream_manager::StreamManager;
use super::stream_manager::StreamManagerError;
use super::{StreamType, spawn_receive_loop};

/// Type-erased receive stream.
///
/// Production wraps `FramedRead<WtRecv, CompressedCborDecoder<R>>`,
/// tests wrap `FramedRead<DuplexStream, CompressedCborDecoder<R>>`.
/// `Box<dyn Stream>` is always `Unpin` — satisfies `spawn_receive_loop` bounds.
type BoxStream<R> = Pin<Box<dyn Stream<Item = Result<R, anyhow::Error>> + Send>>;

/// Protocol trait defining room lifecycle callbacks.
///
/// Implementors provide the Send/Recv message types and lifecycle callbacks
/// that `StreamRoom` invokes under its lock during join, leave, and broadcast.
///
/// # Callback Contract
///
/// All callbacks are called while the room's `parking_lot::Mutex` is held.
/// They **MUST NOT**:
/// - **Panic** — leaves protocol state inconsistent (partial mutations are
///   NOT rolled back). The room is effectively broken after a callback panic.
/// - **Block or perform I/O** — holds the lock, starving other operations.
/// - **Acquire other locks** — risks deadlock.
///
/// Callbacks should be simple, infallible state transformations.
/// `on_member_joining` may return `Err` to reject a join — this is the
/// only fallible callback.
pub trait RoomProtocol: Send + 'static {
    /// Server → client message type.
    type Send: Clone + Serialize + Send + 'static;

    /// Client → server message type.
    type Recv: serde::de::DeserializeOwned + Send + 'static;

    /// Caller-provided data for join. Flows into `on_member_joining` under
    /// the atomic lock. Use `()` for protocols that need no join-time context.
    type JoinContext: Send;

    /// Protocol-specific rejection reason. Use `Infallible` for protocols
    /// that never reject (makes the `Rejected` `JoinError` variant unreachable).
    type JoinReject: std::error::Error + Send + 'static;

    /// Stream type identifier (e.g., `StreamType::Notifications`).
    ///
    /// Called once during `join_with()` to tell `StreamManager` what type
    /// of stream to open.
    fn stream_type(&self) -> StreamType;

    /// Called under lock BEFORE `init_messages` during join.
    ///
    /// Receives caller-provided context to set up the new member atomically.
    /// Returns `Ok(())` to proceed with join, or `Err(reason)` to reject.
    ///
    /// # Contract
    ///
    /// - On `Ok`: state was modified. If join fails later (e.g., `try_send`
    ///   error), `on_member_left` is called to undo.
    /// - On `Err`: state MUST NOT have been modified. `on_member_left` will
    ///   NOT be called. The rejection reason is returned to the caller via
    ///   `JoinError::Rejected`.
    ///
    /// # WARNING: Validate BEFORE mutating
    ///
    /// ```rust,ignore
    /// // WRONG — state is modified before validation:
    /// fn on_member_joining(&mut self, id: i32, ctx: Info) -> Result<(), Full> {
    ///     self.members.insert(id, ctx); // mutated
    ///     if self.members.len() > MAX { return Err(Full); } // state leaked
    ///     Ok(())
    /// }
    ///
    /// // CORRECT — validate first, then mutate:
    /// fn on_member_joining(&mut self, id: i32, ctx: Info) -> Result<(), Full> {
    ///     if self.members.len() >= MAX { return Err(Full); }
    ///     self.members.insert(id, ctx); // only after validation
    ///     Ok(())
    /// }
    /// ```
    ///
    /// Default: accepts all joins, ignores context.
    fn on_member_joining(
        &mut self,
        _user_id: i32,
        context: Self::JoinContext,
    ) -> Result<(), Self::JoinReject> {
        let _ = context;
        Ok(())
    }

    /// Init messages for a specific member. Called under lock, after
    /// `on_member_joining` returns `Ok`.
    ///
    /// The member is guaranteed to exist in protocol state when this is
    /// called. Different users may receive different data (e.g., player
    /// hand vs spectator view).
    ///
    /// MUST return at most `MAX_INIT_MESSAGES` (31) items. Exceeding this
    /// is a protocol implementation bug — excess messages are dropped and
    /// logged as an error. One slot is reserved for the `on_member_joined`
    /// broadcast message.
    fn init_messages(&self, user_id: i32) -> Vec<Self::Send>;

    /// Called after init is sent and member is Active. Under lock.
    ///
    /// Return a broadcast message or `None`. The broadcast includes the
    /// joining member — they receive this message after their init data.
    ///
    /// Mutations here are NOT reflected in the init messages sent to
    /// the joining member (init was already sent earlier in this same
    /// lock acquisition). They ARE visible to all subsequent operations
    /// and to the broadcast recipients.
    ///
    /// Default: no broadcast.
    fn on_member_joined(&mut self, _user_id: i32) -> Option<Self::Send> {
        None
    }

    /// Called when a member disconnects or is removed. Under lock.
    ///
    /// Return a broadcast message or `None`. Also called to undo
    /// `on_member_joining` if join fails after `Ok` (e.g., `try_send` error).
    /// NOT called if `on_member_joining` returned `Err`.
    ///
    /// Default: no broadcast.
    fn on_member_left(&mut self, _user_id: i32) -> Option<Self::Send> {
        None
    }
}

impl<T> super::StreamProtocol for T
where
    T: RoomProtocol,
{
    type Send = <Self as RoomProtocol>::Send;

    type Recv = <Self as RoomProtocol>::Recv;

    fn stream_type(&self) -> StreamType {
        <Self as RoomProtocol>::stream_type(self)
    }
}

/// Fully managed room with co-located state and broadcast.
///
/// See [module documentation](self) for design, invariants, and concurrency model.
///
/// # Invariants
///
/// - At most one entry per `user_id` across `(pending ∪ handles)`.
/// - `pending ∩ handles.keys() = ∅`.
/// - All members in handles are Active (no Initializing state).
/// - Protocol state is consistent with handle membership: if a `user_id`
///   is in handles, `on_member_joining` has been called for them.
///
/// # Lock Level: 1
///
/// Single `parking_lot::Mutex`. `try_send` is lock-free (mpsc op).
/// No other locks acquired while held.
pub struct StreamRoom<P: RoomProtocol> {
    inner: Mutex<StreamRoomInner<P>>,
    #[cfg(test)]
    test_gate: Option<Arc<tokio::sync::Notify>>,
}

struct StreamRoomInner<P: RoomProtocol> {
    state: P,
    handles: IndexMap<i32, StreamSink<P::Send>, ahash::RandomState>,
    pending: IndexSet<i32, ahash::RandomState>,
}

/// RAII guard that removes a user from the pending set on drop.
///
/// Created at step 1 of `join_with()`, disarmed at step 3 on success.
/// If the `join_with()` future is dropped at any point between steps 1
/// and 3, the guard's `Drop` cleans up the pending entry automatically.
///
/// Uses `Arc<StreamRoom<P>>` (not `&'a StreamRoom<P>`) — keeps the room
/// alive through the guard's lifetime regardless of future cancellation
/// or leaking.
struct PendingGuard<P: RoomProtocol> {
    room: Arc<StreamRoom<P>>,
    user_id: i32,
    armed: bool,
}

impl<P: RoomProtocol> PendingGuard<P> {
    fn new(room: Arc<StreamRoom<P>>, user_id: i32) -> Self {
        Self {
            room,
            user_id,
            armed: true,
        }
    }

    /// Disarm the guard — prevents removal from pending on drop.
    ///
    /// Called when the pending entry has been successfully moved to handles.
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl<P: RoomProtocol> Drop for PendingGuard<P> {
    fn drop(&mut self) {
        if self.armed {
            // SAFETY: PendingGuard is always created outside the lock (between
            // steps 1 and 2 of join_with). Rust async cancellation cannot
            // interrupt the synchronous step 3 block, so this Drop never runs
            // while the lock is held on the same thread. parking_lot::Mutex is
            // non-reentrant — declaring PendingGuard inside a lock scope would
            // deadlock on Drop.
            self.room.inner.lock().pending.swap_remove(&self.user_id);
        }
    }
}

/// `StreamRoom` join failed.
///
/// Generic over `R`: the protocol's rejection reason. For protocols that
/// never reject (`JoinReject = Infallible`), the `Rejected` variant is
/// unreachable at the type level.
#[derive(Debug, thiserror::Error)]
pub enum JoinError<R: std::error::Error + Send + 'static = Infallible> {
    /// The user is already a member or has a pending join in progress.
    #[error("user {user_id} is already a member or pending")]
    AlreadyMember { user_id: i32 },

    /// Failed to open the WebTransport stream.
    #[error("failed to open stream: {0}")]
    StreamOpen(#[from] StreamManagerError),

    /// The stream closed during initialization (channel dead before
    /// init messages could be sent).
    #[error("stream closed during initialization for user {user_id}")]
    StreamDied { user_id: i32 },

    /// The protocol rejected the join via `on_member_joining`.
    #[error("join rejected: {0}")]
    Rejected(R),
}

impl<P: RoomProtocol> StreamRoom<P> {
    /// Create a new room with the given initial state.
    ///
    /// Returns `Arc<Self>` — cleanup tasks hold `Weak<StreamRoom>`, and
    /// `join_with()` requires `self: &Arc<Self>`. Forcing `Arc` at
    /// construction prevents use-before-Arc bugs.
    pub fn new(state: P) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(StreamRoomInner {
                state,
                handles: IndexMap::with_hasher(ahash::RandomState::new()),
                pending: IndexSet::with_hasher(ahash::RandomState::new()),
            }),
            #[cfg(test)]
            test_gate: None,
        })
    }

    /// Step 1 of `join_with`: acquire lock, self-heal cancelled entries, check and
    /// insert pending, return stream type.
    ///
    /// Returns `Err(AlreadyMember)` if the user already has an active or pending entry.
    fn reserve_pending(&self, user_id: i32) -> Result<StreamType, JoinError<P::JoinReject>> {
        let mut inner = self.inner.lock();

        if let Some(existing) = inner.handles.get(&user_id) {
            if existing.is_cancelled() {
                if let Some(msg) = inner.state.on_member_left(user_id) {
                    broadcast_except_inner(&inner.handles, &msg, user_id);
                }
                inner.handles.swap_remove(&user_id);
            } else {
                return Err(JoinError::AlreadyMember { user_id });
            }
        }

        if inner.pending.contains(&user_id) {
            return Err(JoinError::AlreadyMember { user_id });
        }

        inner.pending.insert(user_id);
        Ok(inner.state.stream_type())
    }

    /// Step 3 of `join_with`: acquire lock, call `on_member_joining`, send init
    /// messages, insert handle, remove pending, disarm guard, call `on_member_joined`,
    /// broadcast join. Returns the `CancelHandle` for the new member's sink.
    fn activate_member(
        &self,
        user_id: i32,
        context: P::JoinContext,
        sink: &StreamSink<P::Send>,
        guard: &mut PendingGuard<P>,
    ) -> Result<CancelHandle, JoinError<P::JoinReject>> {
        let mut inner = self.inner.lock();

        if let Err(reason) = inner.state.on_member_joining(user_id, context) {
            sink.cancel(CancelReason::Removed);
            return Err(JoinError::Rejected(reason));
        }

        let init_msgs = inner.state.init_messages(user_id);
        if init_msgs.len() > MAX_INIT_MESSAGES {
            tracing::error!(
                user_id,
                count = init_msgs.len(),
                max = MAX_INIT_MESSAGES,
                "init_messages exceeded MAX_INIT_MESSAGES, truncating — this is a protocol bug"
            );
        }

        for msg in init_msgs.into_iter().take(MAX_INIT_MESSAGES) {
            if let Err(err) = sink.try_send(msg) {
                let _ = inner.state.on_member_left(user_id);
                let reason = match err {
                    tokio::sync::mpsc::error::TrySendError::Full(_) => {
                        CancelReason::BackpressureFull
                    }
                    tokio::sync::mpsc::error::TrySendError::Closed(_) => {
                        CancelReason::ChannelClosed
                    }
                };
                sink.cancel(reason);
                return Err(JoinError::StreamDied { user_id });
            }
        }

        inner.handles.insert(user_id, sink.clone());
        inner.pending.swap_remove(&user_id);
        guard.disarm();

        if let Some(msg) = inner.state.on_member_joined(user_id) {
            broadcast_inner(&inner.handles, &msg);
        }

        Ok(sink.cancel_handle().clone())
    }

    /// Step 4 of `join_with`: spawn the weak-guarded cleanup task that removes the
    /// member from the room when their `CancelHandle` is triggered.
    fn spawn_cleanup_task(
        self: &Arc<Self>,
        user_id: i32,
        sink: &StreamSink<P::Send>,
        cancel_handle: &CancelHandle,
    ) {
        let weak = Arc::downgrade(self);
        let sink_snapshot = sink.clone();
        let cleanup_cancel = cancel_handle.clone();
        let cleanup_user_id = user_id;
        // JoinHandle dropped — cleanup task is self-terminating (CancelHandle-governed).
        drop(tokio::spawn(async move {
            cleanup_cancel.cancelled().await;

            let Some(room) = weak.upgrade() else {
                return;
            };

            let mut inner = room.inner.lock();

            let is_match = inner
                .handles
                .get(&cleanup_user_id)
                .is_some_and(|s| *s == sink_snapshot);

            if is_match {
                if let Some(msg) = inner.state.on_member_left(cleanup_user_id) {
                    broadcast_except_inner(&inner.handles, &msg, cleanup_user_id);
                }
                inner.handles.swap_remove(&cleanup_user_id);
            }
            drop(inner);

            if is_match {
                tracing::debug!(
                    user_id = cleanup_user_id,
                    reason = ?cleanup_cancel.reason(),
                    "member stream cancelled, cleaned up"
                );
            }
        }));
    }

    /// Join a user to the room with caller-provided context.
    ///
    /// This is the core join method. See module docs for the 5-step flow.
    /// The `handler` closure is invoked for each message the client sends.
    ///
    /// **FIFO Guarantee**
    ///
    /// Init messages enter the mpsc via `try_send` BEFORE the join broadcast and any
    /// subsequent broadcasts. mpsc preserves insertion order. The client receives
    /// messages in order: `[init data] → [join broadcast] → [subsequent broadcasts]`.
    ///
    /// **Step 3 Invariant: `try_send` never returns `Full`**
    ///
    /// Init messages are the first items entering a fresh mpsc buffer with
    /// `DEFAULT_SINK_BUFFER` (32) capacity. At most `MAX_INIT_MESSAGES` (31) items
    /// are sent, plus at most 1 `on_member_joined` broadcast = 32 total = exactly
    /// the buffer capacity. `try_send` only returns `Full` on a full buffer.
    /// Fresh buffer + bounded init + 1 join broadcast = cannot exceed capacity.
    ///
    /// **Handler Closure Kind: `Fn` not `FnMut`**
    ///
    /// The handler uses `Fn` (not `FnMut`) because typical handlers create a new
    /// `async move` block per call (capturing `Arc<StreamRoom>` etc.), which is `Fn`.
    /// Using `Fn` matches the common pattern and avoids implying mutable handler
    /// state is expected. Handlers needing per-connection state (e.g., sequence
    /// numbers) can use interior mutability (`Cell`, `AtomicU64`).
    ///
    /// **JoinHandle Drop Policy**
    ///
    /// The returned `JoinHandle<()>` may be safely dropped. The `CancelHandle` (owned
    /// by the `StreamSink`) governs the receive loop's lifetime independently.
    /// Dropping the handle detaches the task but does not leak — the task exits when
    /// the stream closes or is cancelled. Store the handle if you need graceful
    /// shutdown ordering. Expected pattern: `let _ = room.join(user_id, handler).await?;`
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe at every point:
    /// - Before step 1: no state change.
    /// - During step 2 (stream open): `PendingGuard` removes pending on drop.
    /// - Step 3 is synchronous (under lock) — cannot be cancelled mid-execution.
    /// - After step 3: member is fully joined, cleanup task handles disconnect.
    ///
    /// # Errors
    ///
    /// - `AlreadyMember` — user is already in handles or pending.
    /// - `StreamOpen` — `StreamManager` failed to open the transport stream.
    /// - `StreamDied` — channel closed during init message send.
    /// - `Rejected` — protocol's `on_member_joining` returned `Err`.
    #[cfg(not(test))]
    pub async fn join_with<F, Fut>(
        self: &Arc<Self>,
        user_id: i32,
        context: P::JoinContext,
        sm: &StreamManager,
        handler: F,
    ) -> Result<JoinHandle<()>, JoinError<P::JoinReject>>
    where
        F: Fn(P::Recv) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send,
    {
        // ── Step 1: Reserve pending slot ──────────────────────────────
        let stream_type = self.reserve_pending(user_id)?;
        let mut guard = PendingGuard::new(Arc::clone(self), user_id);

        // ── Step 2: Open transport stream (async, no lock held) ──────
        let (sink, rx) = sm
            .request_stream::<P::Send, P::Recv>(user_id, stream_type, DEFAULT_SINK_BUFFER)
            .await?;
        let boxed_rx: BoxStream<P::Recv> = Box::pin(futures::StreamExt::map(rx, |r| {
            r.map_err(|e| anyhow::anyhow!(e))
        }));

        // ── Step 3: Atomic join under lock ───────────────────────────
        let cancel_handle = self.activate_member(user_id, context, &sink, &mut guard)?;

        // ── Step 4: Spawn cleanup task ───────────────────────────────
        self.spawn_cleanup_task(user_id, &sink, &cancel_handle);

        // ── Step 5: Spawn receive loop ───────────────────────────────
        Ok(spawn_receive_loop(boxed_rx, cancel_handle, handler))
    }

    /// Send a message to all Active members.
    ///
    /// Uses `try_send` (non-blocking). Cancels streams on:
    /// - `Full` → `CancelReason::BackpressureFull`
    /// - `Closed` → `CancelReason::ChannelClosed`
    ///
    /// A client 32+ messages behind has a degraded transport — queueing more messages delays the
    /// problem without solving it. The correct recovery is reconnection with a fresh state snapshot
    /// (via `init_messages`). For high-frequency updates where only the latest state matters,
    /// `LatestSink<S>` (future extension) is the appropriate primitive.
    pub fn broadcast(&self, msg: &P::Send) {
        let inner = self.inner.lock();
        broadcast_inner(&inner.handles, msg);
    }

    /// Send a message to all Active members except one.
    ///
    /// Common case: exclude the message originator.
    /// For multi-user exclusion, use [`broadcast_map()`](Self::broadcast_map).
    pub fn broadcast_except(&self, msg: &P::Send, exclude: i32) {
        let inner = self.inner.lock();
        broadcast_except_inner(&inner.handles, msg, exclude);
    }

    /// Send a message to one specific member.
    ///
    /// Returns `false` if the user is not found OR if the send fails
    /// (backpressure/closed — stream is cancelled). Returns `true` only
    /// if the message was accepted into the mpsc channel.
    ///
    /// Same backpressure policy as `broadcast()`: cancels stream on Full
    /// (`BackpressureFull`) or Closed (`ChannelClosed`).
    #[must_use]
    pub fn send(&self, user_id: i32, msg: &P::Send) -> bool {
        let inner = self.inner.lock();
        if let Some(sink) = inner.handles.get(&user_id) {
            try_send_or_cancel(sink, msg)
        } else {
            false
        }
    }

    /// Send a confirmed message to one specific member.
    ///
    /// Looks up the member's sink under the lock, clones it, releases the lock,
    /// then performs the confirmed send (async). Returns `None` if the user is
    /// not an active member.
    ///
    /// Confirmed broadcast is intentionally not provided — confirmed delivery is
    /// a per-user concept. Broadcasting is fire-and-forget with backpressure
    /// cancellation.
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe. See [`StreamSink::send_confirmed`] for details.
    pub async fn send_confirmed(
        &self,
        user_id: i32,
        msg: P::Send,
    ) -> Option<Result<(), super::sink::ConfirmedSendError>> {
        let sink = {
            let inner = self.inner.lock();
            inner.handles.get(&user_id).cloned()
        };
        // Lock released — confirmed send is async and must not hold the room lock.
        let sink = sink?;
        Some(sink.send_confirmed(msg).await)
    }

    /// Send a confirmed batch to one specific member.
    ///
    /// Same lookup-then-release pattern as [`send_confirmed`](Self::send_confirmed).
    /// Returns `None` if the user is not an active member.
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe. See [`StreamSink::send_confirmed_batch`] for details.
    pub async fn send_confirmed_batch(
        &self,
        user_id: i32,
        msgs: Vec<P::Send>,
    ) -> Option<Result<(), super::sink::ConfirmedBatchError<P::Send>>> {
        let sink = {
            let inner = self.inner.lock();
            inner.handles.get(&user_id).cloned()
        };
        let sink = sink?;
        Some(sink.send_confirmed_batch(msgs).await)
    }

    /// Per-member conditional broadcast.
    ///
    /// The closure receives `&P` (protocol state) and `user_id`. Return
    /// `Some(msg)` to send to that member, `None` to skip. Called once
    /// per Active member under the lock.
    ///
    /// Per-member data (role, team, etc.) should live in the protocol
    /// state, not in a parallel map — the closure receives `&P` for this
    /// reason. This avoids separate synchronization for member metadata.
    ///
    /// Same backpressure cancellation policy as [`broadcast()`](Self::broadcast):
    /// cancels streams on `Full` (`BackpressureFull`) or `Closed` (`ChannelClosed`).
    pub fn broadcast_map(&self, f: impl Fn(&P, i32) -> Option<P::Send>) {
        let inner = self.inner.lock();
        for (&user_id, sink) in &inner.handles {
            if let Some(msg) = f(&inner.state, user_id) {
                try_send_or_cancel(sink, &msg);
            }
        }
    }

    /// Atomic: mutate state, then broadcast one message to all members.
    ///
    /// `FnOnce` — called once, produces one message sent to all.
    pub fn mutate_and_broadcast(&self, f: impl FnOnce(&mut P) -> P::Send) {
        let mut inner = self.inner.lock();
        let msg = f(&mut inner.state);
        broadcast_inner(&inner.handles, &msg);
    }

    /// Atomic: mutate state, conditionally broadcast.
    ///
    /// If the closure returns `None`, no broadcast occurs.
    pub fn mutate_and_maybe_broadcast(&self, f: impl FnOnce(&mut P) -> Option<P::Send>) {
        let mut inner = self.inner.lock();
        if let Some(msg) = f(&mut inner.state) {
            broadcast_inner(&inner.handles, &msg);
        }
    }

    /// Atomic: mutate state, broadcast to all except one.
    pub fn mutate_and_broadcast_except(&self, f: impl FnOnce(&mut P) -> P::Send, exclude: i32) {
        let mut inner = self.inner.lock();
        let msg = f(&mut inner.state);
        broadcast_except_inner(&inner.handles, &msg, exclude);
    }

    /// Atomic: mutate state, then per-member conditional broadcast.
    ///
    /// `mutate` is called once (`FnOnce`). `send` is called per Active member (`Fn`).
    /// Iterates Active members only (not pending).
    ///
    /// Same backpressure cancellation policy as [`broadcast()`](Self::broadcast):
    /// cancels streams on `Full` (`BackpressureFull`) or `Closed` (`ChannelClosed`).
    ///
    /// **Contention**: Holds the lock during mutate + iterate N members + `try_send` each.
    /// At typical sizes (< 200), sub-millisecond. For high-frequency ticks, keep closures fast.
    /// Future `LatestSink<S>` (watch-based) is the scaling path.
    pub fn mutate_and_broadcast_map(
        &self,
        mutate: impl FnOnce(&mut P),
        send: impl Fn(&P, i32) -> Option<P::Send>,
    ) {
        let mut inner = self.inner.lock();
        mutate(&mut inner.state);
        for (&user_id, sink) in &inner.handles {
            if let Some(msg) = send(&inner.state, user_id) {
                try_send_or_cancel(sink, &msg);
            }
        }
    }

    /// Read protocol state under the lock.
    pub fn with_state<T>(&self, f: impl FnOnce(&P) -> T) -> T {
        let inner = self.inner.lock();
        f(&inner.state)
    }

    /// Mutate protocol state under the lock, no broadcast.
    ///
    /// # Warning
    ///
    /// For non-member state only (e.g., game config, settings). Do NOT
    /// add/remove members via this method — use `join`/`remove` which
    /// maintain the protocol-state-to-handles invariant. Member setup
    /// belongs in `on_member_joining` via `JoinContext`.
    pub fn with_state_mut<T>(&self, f: impl FnOnce(&mut P) -> T) -> T {
        let mut inner = self.inner.lock();
        f(&mut inner.state)
    }

    /// Remove a user from the room.
    ///
    /// Two paths, all under one lock:
    /// - **In handles**: calls `on_member_left`, conditionally broadcasts
    ///   the departure, removes from handles, cancels with `Removed`.
    /// - **Only in pending**: removes from pending set (no callback, no
    ///   broadcast — user never fully joined).
    ///
    /// Returns `true` if found in either, `false` if in neither.
    #[must_use]
    pub fn remove(&self, user_id: i32) -> bool {
        let mut inner = self.inner.lock();

        if let Some(sink) = inner.handles.get(&user_id) {
            // Clone sink for cancel after removal (cancel is lock-free).
            let sink = sink.clone();
            if let Some(msg) = inner.state.on_member_left(user_id) {
                broadcast_except_inner(&inner.handles, &msg, user_id);
            }
            inner.handles.swap_remove(&user_id);
            sink.cancel(CancelReason::Removed);
            true
        } else if inner.pending.swap_remove(&user_id) {
            // Pending only — no callback, no broadcast.
            true
        } else {
            false
        }
    }

    /// IDs of all Active members.
    #[must_use]
    pub fn member_ids(&self) -> Vec<i32> {
        let inner = self.inner.lock();
        inner.handles.keys().copied().collect()
    }

    /// Number of Active members.
    #[must_use]
    pub fn member_count(&self) -> usize {
        let inner = self.inner.lock();
        inner.handles.len()
    }

    /// Whether the room has no Active members.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        let inner = self.inner.lock();
        inner.handles.is_empty()
    }

    /// Whether a user is an Active member.
    #[must_use]
    pub fn contains(&self, user_id: i32) -> bool {
        let inner = self.inner.lock();
        inner.handles.contains_key(&user_id)
    }
}

/// Convenience: `join()` for protocols with `JoinContext = ()` (production).
#[cfg(not(test))]
impl<P: RoomProtocol<JoinContext = ()>> StreamRoom<P> {
    /// Join a user to the room (no context needed).
    ///
    /// Convenience wrapper around `join_with(user_id, (), sm, handler)`.
    /// Only available when `P::JoinContext = ()`.
    ///
    /// See [`join_with`](Self::join_with) for full documentation.
    pub async fn join<F, Fut>(
        self: &Arc<Self>,
        user_id: i32,
        sm: &StreamManager,
        handler: F,
    ) -> Result<JoinHandle<()>, JoinError<P::JoinReject>>
    where
        F: Fn(P::Recv) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send,
    {
        self.join_with(user_id, (), sm, handler).await
    }
}

/// Uni-directional (server → client only) join methods (production).
#[cfg(not(test))]
impl<P: RoomProtocol> StreamRoom<P> {
    /// Join a user with a uni-directional (server → client) stream.
    ///
    /// Same atomic join protocol as `join_with` (pending → init → activate),
    /// but opens a uni-stream via `StreamManager::request_uni_stream` and
    /// does NOT spawn a receive loop. The client cannot send messages to the
    /// server on this stream.
    ///
    /// Use for broadcast-only members: spectators, live scoreboards,
    /// notification feeds. The cleanup task still fires on cancellation.
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe (same as `join_with`):
    /// - Before step 1: no state change.
    /// - During step 2: `PendingGuard` removes pending on drop.
    /// - Step 3 is synchronous.
    pub async fn join_send_only_with(
        self: &Arc<Self>,
        user_id: i32,
        context: P::JoinContext,
        sm: &StreamManager,
    ) -> Result<(), JoinError<P::JoinReject>> {
        // ── Step 1: Reserve pending slot ──────────────────────────────
        let stream_type = self.reserve_pending(user_id)?;
        let mut guard = PendingGuard::new(Arc::clone(self), user_id);

        // ── Step 2: Open uni-directional stream (server → client only) ─
        let sink = sm
            .request_uni_stream::<P::Send>(user_id, stream_type, DEFAULT_SINK_BUFFER)
            .await?;

        // ── Steps 3-4: Atomic join + cleanup task ────────────────────
        let cancel_handle = self.activate_member(user_id, context, &sink, &mut guard)?;
        self.spawn_cleanup_task(user_id, &sink, &cancel_handle);
        Ok(())
    }
}

/// Convenience: `join_send_only()` for protocols with `JoinContext = ()` (production).
#[cfg(not(test))]
impl<P: RoomProtocol<JoinContext = ()>> StreamRoom<P> {
    pub async fn join_send_only(
        self: &Arc<Self>,
        user_id: i32,
        sm: &StreamManager,
    ) -> Result<(), JoinError<P::JoinReject>> {
        self.join_send_only_with(user_id, (), sm).await
    }
}

#[cfg(test)]
impl<P: RoomProtocol> StreamRoom<P>
where
    P::Send: serde::de::DeserializeOwned,
    P::Recv: serde::Serialize,
{
    /// Test-mode join: creates `DuplexStream`-backed streams instead of
    /// calling `StreamManager`.
    ///
    /// Returns `(JoinHandle, TestClient, TestClientSender)` — the
    /// `TestClient` reads server→client messages, the `TestClientSender`
    /// writes client→server messages. Both must be kept alive for the
    /// duration of the test (dropping `TestClientSender` triggers
    /// `StreamEnded` cancellation).
    ///
    /// If `test_gate` is set (via [`new_gated`]), blocks in step 2 until
    /// the gate is opened — simulates slow stream open for cancellation
    /// tests.
    pub async fn join_with<F, Fut>(
        self: &Arc<Self>,
        user_id: i32,
        context: P::JoinContext,
        handler: F,
    ) -> Result<
        (
            JoinHandle<()>,
            super::tests::test_utils::TestClient<P::Send>,
            super::tests::test_utils::TestClientSender<P::Recv>,
        ),
        JoinError<P::JoinReject>,
    >
    where
        F: Fn(P::Recv) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send,
    {
        use futures::StreamExt as _;
        use tokio_util::codec::{FramedRead, FramedWrite};

        use super::compress_cbor_codec::{CompressedCborDecoder, CompressedCborEncoder};
        use super::tests::test_utils::{DUPLEX_BUFFER, TestClient, TestClientSender};

        // ── Step 1: Reserve pending slot ──────────────────────────────
        let _stream_type = self.reserve_pending(user_id)?;
        let mut guard = PendingGuard::new(Arc::clone(self), user_id);

        // ── Step 2: Gate check + DuplexStream creation ───────────────
        if let Some(gate) = &self.test_gate {
            gate.notified().await;
        }

        let (server_write, client_read) = tokio::io::duplex(DUPLEX_BUFFER);
        let (client_write, server_read) = tokio::io::duplex(DUPLEX_BUFFER);

        let framed_write = FramedWrite::new(server_write, CompressedCborEncoder::<P::Send>::new());
        let token = tokio_util::sync::CancellationToken::new();
        let sink = StreamSink::new(framed_write, token, DEFAULT_SINK_BUFFER);

        let boxed_rx: BoxStream<P::Recv> = Box::pin(
            FramedRead::new(server_read, CompressedCborDecoder::<P::Recv>::new())
                .map(|r| r.map_err(|e| anyhow::anyhow!(e))),
        );

        let client = TestClient::new(client_read);
        let client_sender = TestClientSender::new(client_write);

        // ── Step 3: Atomic join under lock ───────────────────────────
        let cancel_handle = self.activate_member(user_id, context, &sink, &mut guard)?;

        // ── Step 4: Spawn cleanup task ───────────────────────────────
        self.spawn_cleanup_task(user_id, &sink, &cancel_handle);

        // ── Step 5: Spawn receive loop ───────────────────────────────
        let join_handle = spawn_receive_loop(boxed_rx, cancel_handle, handler);

        Ok((join_handle, client, client_sender))
    }
}

/// Convenience: `join()` for protocols with `JoinContext = ()` (test).
#[cfg(test)]
impl<P: RoomProtocol<JoinContext = ()>> StreamRoom<P>
where
    P::Send: serde::de::DeserializeOwned,
    P::Recv: serde::Serialize,
{
    pub async fn join<F, Fut>(
        self: &Arc<Self>,
        user_id: i32,
        handler: F,
    ) -> Result<
        (
            JoinHandle<()>,
            super::tests::test_utils::TestClient<P::Send>,
            super::tests::test_utils::TestClientSender<P::Recv>,
        ),
        JoinError<P::JoinReject>,
    >
    where
        F: Fn(P::Recv) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send,
    {
        self.join_with(user_id, (), handler).await
    }
}

/// Uni-directional (server → client only) join methods (test).
///
/// Separate impl block from the bidi test block because the trait bounds differ:
/// only `P::Send: DeserializeOwned` is needed — no `P::Recv: Serialize`.
#[cfg(test)]
impl<P: RoomProtocol> StreamRoom<P>
where
    P::Send: serde::de::DeserializeOwned,
{
    /// Join a user with a uni-directional (server → client) stream — test version.
    ///
    /// Returns a [`TestClient`] from which the test can read server-sent messages.
    /// There is no `TestClientSender` — uni-streams carry no client→server traffic.
    ///
    /// If `test_gate` is set (via [`new_gated`]), blocks in step 2 until the gate
    /// is opened.
    ///
    /// Cancel-safe: `PendingGuard` removes the pending slot on drop during step 2.
    pub async fn join_send_only_with(
        self: &Arc<Self>,
        user_id: i32,
        context: P::JoinContext,
    ) -> Result<super::tests::test_utils::TestClient<P::Send>, JoinError<P::JoinReject>> {
        use tokio_util::codec::FramedWrite;

        use super::compress_cbor_codec::CompressedCborEncoder;
        use super::tests::test_utils::{DUPLEX_BUFFER, TestClient};

        // ── Step 1: Reserve pending slot ──────────────────────────────
        let _stream_type = self.reserve_pending(user_id)?;
        let mut guard = PendingGuard::new(Arc::clone(self), user_id);

        // ── Step 2: Gate check + write-only DuplexStream creation ─────
        if let Some(gate) = &self.test_gate {
            gate.notified().await;
        }
        let (server_write, client_read) = tokio::io::duplex(DUPLEX_BUFFER);
        let framed_write = FramedWrite::new(server_write, CompressedCborEncoder::<P::Send>::new());
        let token = tokio_util::sync::CancellationToken::new();
        let sink = StreamSink::new(framed_write, token, DEFAULT_SINK_BUFFER);
        let client = TestClient::new(client_read);

        // ── Steps 3-4: Atomic join + cleanup task ────────────────────
        let cancel_handle = self.activate_member(user_id, context, &sink, &mut guard)?;
        self.spawn_cleanup_task(user_id, &sink, &cancel_handle);
        Ok(client)
    }
}

/// Convenience: `join_send_only()` for protocols with `JoinContext = ()` (test).
#[cfg(test)]
impl<P: RoomProtocol<JoinContext = ()>> StreamRoom<P>
where
    P::Send: serde::de::DeserializeOwned,
{
    /// Convenience wrapper around `join_send_only_with(user_id, ())`.
    pub async fn join_send_only(
        self: &Arc<Self>,
        user_id: i32,
    ) -> Result<super::tests::test_utils::TestClient<P::Send>, JoinError<P::JoinReject>> {
        self.join_send_only_with(user_id, ()).await
    }
}

/// Test constructor: `new_gated` blocks join at step 2 until `GateHandle::open()`.
#[cfg(test)]
impl<P: RoomProtocol> StreamRoom<P> {
    pub fn new_gated(state: P) -> (Arc<Self>, GateHandle) {
        let gate = Arc::new(tokio::sync::Notify::new());
        let room = Arc::new(Self {
            inner: Mutex::new(StreamRoomInner {
                state,
                handles: IndexMap::with_hasher(ahash::RandomState::new()),
                pending: IndexSet::with_hasher(ahash::RandomState::new()),
            }),
            test_gate: Some(Arc::clone(&gate)),
        });
        (room, GateHandle { gate })
    }
}

impl<P: RoomProtocol> Drop for StreamRoom<P> {
    /// Cancel all member streams with `CancelReason::RoomDestroyed`.
    ///
    /// Does NOT call `on_member_left` — protocol state is destroyed with
    /// the room. Departure mutations are pointless, and `Drop` cannot do
    /// I/O or send messages. If departure messages are needed when a room
    /// shuts down, explicitly `remove()` each member before dropping.
    fn drop(&mut self) {
        let inner = self.inner.get_mut();
        for (_, sink) in inner.handles.drain(..) {
            sink.cancel(CancelReason::RoomDestroyed);
        }
    }
}

impl<P: RoomProtocol> std::fmt::Debug for StreamRoom<P> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("StreamRoom")
            .field("members", &inner.handles.len())
            .field("pending", &inner.pending.len())
            .finish()
    }
}

// ── Internal helpers ─────────────────────────────────────────────────

/// Try to send a cloned message to a sink, cancelling on failure.
///
/// Returns `true` if sent successfully, `false` if cancelled.
fn try_send_or_cancel<S: Clone + Serialize + Send + 'static>(
    sink: &StreamSink<S>,
    msg: &S,
) -> bool {
    match sink.try_send(msg.clone()) {
        Ok(()) => true,
        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
            sink.cancel(CancelReason::BackpressureFull);
            false
        }
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
            sink.cancel(CancelReason::ChannelClosed);
            false
        }
    }
}

/// Broadcast a message to all handles.
fn broadcast_inner<S: Clone + Serialize + Send + 'static>(
    handles: &IndexMap<i32, StreamSink<S>, ahash::RandomState>,
    msg: &S,
) {
    for (_, sink) in handles {
        try_send_or_cancel(sink, msg);
    }
}

/// Broadcast a message to all handles except one user.
fn broadcast_except_inner<S: Clone + Serialize + Send + 'static>(
    handles: &IndexMap<i32, StreamSink<S>, ahash::RandomState>,
    msg: &S,
    exclude: i32,
) {
    for (&user_id, sink) in handles {
        if user_id != exclude {
            try_send_or_cancel(sink, msg);
        }
    }
}

// ── Test infrastructure ──────────────────────────────────────────────

/// Handle for controlling the gated opener.
#[cfg(test)]
pub struct GateHandle {
    gate: Arc<tokio::sync::Notify>,
}

#[cfg(test)]
impl GateHandle {
    /// Unblock one waiting `open_stream` call.
    pub fn open(&self) {
        self.gate.notify_one();
    }
}

#[cfg(test)]
mod test_support {
    use super::super::cancel::CancelReason;
    use super::*;

    // ── StreamRoom test helpers ──────────────────────────────────────

    impl<P: RoomProtocol> StreamRoom<P> {
        /// Extract the cancel handle for a user.
        ///
        /// Panics if the user is not an active member.
        pub fn cancel_handle_for(&self, user_id: i32) -> CancelHandle {
            let inner = self.inner.lock();
            inner
                .handles
                .get(&user_id)
                .unwrap_or_else(|| panic!("user {user_id} not in room"))
                .cancel_handle()
                .clone()
        }

        /// Check if `user_id` is in the pending set.
        pub fn user_is_pending(&self, user_id: i32) -> bool {
            self.inner.lock().pending.contains(&user_id)
        }

        /// Check if `user_id` is in the active handles map.
        pub fn user_is_active(&self, user_id: i32) -> bool {
            self.inner.lock().handles.contains_key(&user_id)
        }

        /// Check if the pending set is empty.
        pub fn pending_is_empty(&self) -> bool {
            self.inner.lock().pending.is_empty()
        }

        /// Cancel the sink for `user_id` with `reason`.
        ///
        /// Panics if `user_id` is not an active member.
        pub fn cancel_user_sink(&self, user_id: i32, reason: CancelReason) {
            let inner = self.inner.lock();
            inner
                .handles
                .get(&user_id)
                .unwrap_or_else(|| panic!("user {user_id} not in room"))
                .cancel(reason);
        }
    }
}
