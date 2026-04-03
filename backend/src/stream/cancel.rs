//! Cancellation with structured reasons.
//!
//! Provides [`CancelHandle`] and [`CancelReason`] — a thin wrapper around
//! [`CancellationToken`] that enforces a reason at every cancel site.
//!
//! # Design
//!
//! Raw `CancellationToken` supports silent cancellation — callers can cancel
//! without stating why, making post-mortem debugging difficult. `CancelHandle`
//! fixes this by requiring a [`CancelReason`] argument on every `cancel()` call.
//! The reason is stored in an `Arc<OnceLock<CancelReason>>` — first writer wins,
//! preserving the root cause even when multiple cancel paths race.
//!
//! External cancellation (parent token cancelled by connection drop or server
//! shutdown) correctly produces `reason() == None` — the cause is above this
//! stream's scope, not a stream-level event.
//!
//! # Concurrency Model
//!
//! - `OnceLock::set` is thread-safe and lock-free (CAS internally).
//! - `CancellationToken::cancel` is idempotent and thread-safe.
//! - `Clone` shares both the token and the reason slot — all clones observe
//!   the same cancellation state.
//!
//! # Type Safety
//!
//! `CancelReason` is `Send + Sync` (all unit variants). `OnceLock<CancelReason>`
//! requires `T: Send + Sync` for its `Sync` impl, which is satisfied. If future
//! variants carry non-`Sync` data, this will be a compile error — by design.
//!
//! # Identity Semantics
//!
//! `PartialEq` and `Hash` use `Arc::ptr_eq` / `Arc::as_ptr` on the reason
//! slot. Two handles are equal iff they originated from the same `new()` call
//! (or are clones of each other). This is the same semantic as the existing
//! `SharedSender::same_channel` and is used for ABA prevention in cleanup tasks.

use std::sync::{Arc, OnceLock};

use tokio_util::sync::CancellationToken;

/// Why a stream was cancelled.
///
/// Every cancel site must provide a reason — this is enforced by
/// [`CancelHandle::cancel`] requiring a `CancelReason` argument.
///
/// `None` from [`CancelHandle::reason`] means external/parent cancellation
/// (connection drop, server shutdown) — no stream-level reason was set.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum CancelReason {
    /// Client fell behind on messages (`try_send` returned `Full`).
    ///
    /// The client's transport is too slow to keep up with broadcasts.
    /// They should reconnect to get a fresh state snapshot via
    /// `init_messages`.
    BackpressureFull,

    /// The underlying mpsc channel was closed (`try_send` returned `Closed`).
    ///
    /// The receiver side (forwarding task) is gone — typically because
    /// the task exited due to a transport error or cancellation.
    ChannelClosed,

    /// The receive loop encountered a frame decode error.
    ///
    /// Indicates a protocol mismatch or corrupted data on the wire.
    /// The stream is no longer usable.
    DecodeError,

    /// Explicitly removed via [`StreamRoom::remove()`], direct
    /// [`StreamSink::cancel()`], or protocol rejection during join.
    Removed,

    /// The room was destroyed ([`StreamRoom`] dropped).
    ///
    /// All member streams are cancelled as part of teardown.
    /// This is the expected reason when a room shuts down normally.
    RoomDestroyed,

    /// The forwarding task encountered a transport write error.
    ///
    /// The WebTransport/QUIC layer reported a failure writing to
    /// the underlying connection.
    TransportError,

    /// The receive stream ended normally (rx returned `None`).
    ///
    /// The client closed their send direction gracefully. Distinct
    /// from `None` reason (external/parent cancellation) — `StreamEnded`
    /// is an explicit stream-level event, while `None` means the cause
    /// is above this stream's scope.
    StreamEnded,
}

/// Cancellation signal with a structured reason.
///
/// Wraps a [`CancellationToken`] with an `Arc<OnceLock<CancelReason>>`.
/// The reason is set exactly once — first writer wins (via [`OnceLock`]).
///
/// # External cancellation
///
/// If the underlying `CancellationToken` is cancelled via a parent token
/// (e.g., connection shutdown), [`reason()`](Self::reason) returns `None`.
/// This is the correct semantic: the stream was cancelled by an external
/// cause, not by a stream-level event.
///
/// # Invariants
///
/// - `token` and `reason` always refer to the same logical stream.
/// - After `cancel(reason)`, `is_cancelled()` is `true` AND `reason()` is `Some`.
/// - After parent cancellation, `is_cancelled()` is `true` AND `reason()` is `None`.
///
/// # Identity
///
/// Two `CancelHandle`s are equal iff they share the same reason slot
/// (i.e., originated from the same [`new()`](Self::new) call or are clones).
/// `Hash` is consistent with `PartialEq` (both pointer-based).
#[derive(Clone)]
#[must_use = "a CancelHandle does nothing if not used to cancel or observe cancellation"]
pub struct CancelHandle {
    token: CancellationToken,
    reason: Arc<OnceLock<CancelReason>>,
}

impl CancelHandle {
    /// Create a new `CancelHandle` wrapping an existing `CancellationToken`.
    ///
    /// `pub(crate)` — only stream infrastructure creates handles. External
    /// code receives them from [`StreamSink`] or [`StreamRoom`] and uses
    /// the `cancel()` / `reason()` / `cancelled()` API.
    pub(crate) fn new(token: CancellationToken) -> Self {
        Self {
            token,
            reason: Arc::new(OnceLock::new()),
        }
    }

    /// Cancel the stream with a reason.
    ///
    /// The reason is set exactly once (first caller wins via `OnceLock`).
    /// Subsequent calls still cancel the token (idempotent) but do not
    /// overwrite the reason — the root cause is preserved.
    ///
    /// Compile-time enforced: you MUST provide a reason. This prevents
    /// "silent cancellations" that are hard to debug in production.
    pub fn cancel(&self, reason: CancelReason) {
        // First writer wins — OnceLock::set returns Err if already set,
        // which we intentionally discard. The first reason IS the root cause.
        let _ = self.reason.set(reason);
        self.token.cancel();
    }

    /// Why was this stream cancelled?
    ///
    /// - `Some(reason)` — cancelled by a stream-level event.
    /// - `None` — either not yet cancelled, or cancelled by a parent
    ///   token (connection drop, server shutdown). Check [`is_cancelled()`](Self::is_cancelled)
    ///   to distinguish.
    #[must_use]
    pub fn reason(&self) -> Option<&CancelReason> {
        self.reason.get()
    }

    /// Wait until cancelled (by any cause — stream-level or parent).
    ///
    /// # Cancel Safety
    ///
    /// This future is cancel-safe. Dropping it before completion has no
    /// side effects — the cancellation state is unchanged.
    pub async fn cancelled(&self) {
        self.token.cancelled().await;
    }

    /// Whether the stream has been cancelled (by any cause).
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    /// Borrow the underlying `CancellationToken`.
    ///
    /// `pub(crate)` — not exposed to consumers. External code should
    /// use [`cancelled()`](Self::cancelled) for waiting or
    /// [`cancel(reason)`](Self::cancel) for triggering. This prevents
    /// bypassing the reason requirement.
    ///
    /// Internal use: interop with APIs expecting raw `CancellationToken`
    /// (e.g., child token creation in `StreamManager`).
    pub(crate) fn token(&self) -> &CancellationToken {
        &self.token
    }
}

impl std::fmt::Debug for CancelHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CancelHandle")
            .field("cancelled", &self.token.is_cancelled())
            .field("reason", &self.reason.get())
            .finish()
    }
}

impl PartialEq for CancelHandle {
    /// Two handles are equal iff they share the same reason slot.
    ///
    /// Since `new()` is `pub(crate)` and `Clone` shares all internals,
    /// equal handles always share the same token too. Used for ABA
    /// prevention in cleanup tasks (same semantics as `same_channel`).
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.reason, &other.reason)
    }
}

impl Eq for CancelHandle {}

impl std::hash::Hash for CancelHandle {
    /// Hash by pointer identity — consistent with `PartialEq` (ptr_eq semantics).
    ///
    /// Allows `CancelHandle` to be stored in `HashSet` or used as a `HashMap` key.
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        Arc::as_ptr(&self.reason).hash(state);
    }
}
