//! Clonable message sink bridging an mpsc channel to a framed transport.
//!
//! [`StreamSink<S>`] replaces the old `SharedSender` with structured cancellation
//! via [`CancelHandle`]. It spawns a single forwarding task at construction that
//! drains an mpsc channel into a `FramedWrite` transport. All clones share the
//! same channel and cancel handle.
//!
//! # Design
//!
//! The forwarding task owns the `FramedWrite` and `mpsc::Receiver`. Callers
//! interact only through the `mpsc::Sender` (via `send`/`try_send`) and the
//! `CancelHandle` (via `cancel`/`reason`). This separation means:
//! - Multiple holders can send concurrently (mpsc is multi-producer).
//! - Transport errors are detected by the forwarding task and propagated
//!   via `CancelReason::TransportError`.
//! - Backpressure is bounded by the mpsc channel capacity.
//!
//! # Concurrency Model
//!
//! - `mpsc::Sender::send` is cancel-safe and does not hold locks.
//! - `CancelHandle` operations are lock-free (`OnceLock` + `CancellationToken`).
//! - The forwarding task terminates on cancel, channel close, or transport error.

use std::num::NonZeroUsize;

use futures::SinkExt;
use serde::Serialize;
use tokio::io::AsyncWrite;
use tokio::sync::mpsc;
use tokio_util::codec::FramedWrite;
use tokio_util::sync::CancellationToken;

use super::cancel::{CancelHandle, CancelReason};
use super::compress_cbor_codec::CompressedCborEncoder;

/// Default buffer for standalone sinks (notifications, 1:1 streams).
///
/// 32 messages of backpressure — ~100ms at 300 msg/s. Matches the
/// existing `SharedSender` channel capacity. A client that falls
/// 32+ messages behind is degraded and will be cancelled.
///
/// Coupled with [`MAX_INIT_MESSAGES`] (= `DEFAULT_SINK_BUFFER - 1`) to
/// guarantee init messages + join broadcast fit in a fresh buffer
/// (see const assertion below).
pub const DEFAULT_SINK_BUFFER: NonZeroUsize = NonZeroUsize::new(32).expect("32 is nonzero");

/// Maximum init messages allowed from `RoomProtocol::init_messages()`.
///
/// `DEFAULT_SINK_BUFFER - 1` because `on_member_joined` may produce one
/// additional broadcast message that is sent to ALL handles (including
/// the just-joined member). The buffer must have room for init + join.
pub const MAX_INIT_MESSAGES: usize = DEFAULT_SINK_BUFFER.get() - 1; // 31

// Compile-time enforcement: init messages + 1 join broadcast must fit
// in a fresh sink buffer. If this assertion fails, adjust the constants.
const _: () = assert!(
    MAX_INIT_MESSAGES + 1 <= DEFAULT_SINK_BUFFER.get(),
    "init messages + join broadcast must fit in a fresh sink buffer"
);

/// Clonable handle for sending typed messages to a WebTransport stream.
///
/// Bridges a bounded `mpsc` channel to a `FramedWrite` via a spawned
/// forwarding task. Created by [`StreamManager`] (production) or test
/// utilities (tests).
///
/// # Invariants
///
/// - `tx` and `cancel` always refer to the same logical stream.
/// - The forwarding task is spawned exactly once, at construction.
///
/// # Cancel Safety
///
/// All methods are cancel-safe. Dropping a `StreamSink` decrements the
/// mpsc sender refcount; the forwarding task exits when all senders drop
/// or cancel fires.
///
/// # Identity
///
/// `PartialEq` delegates to [`CancelHandle::eq`] — two sinks are equal
/// iff they originated from the same `new()` call (same identity semantics
/// as the old `SharedSender::same_channel`).
#[derive(Clone)]
#[must_use = "a StreamSink does nothing if dropped without sending or observing cancellation"]
pub struct StreamSink<S> {
    tx: mpsc::Sender<S>,
    cancel: CancelHandle,
}

impl<S: Serialize + Send + 'static> StreamSink<S> {
    /// Create a new `StreamSink` backed by a framed transport.
    ///
    /// `pub(crate)` — only `StreamManager` (production) and test utilities
    /// create sinks. The generic `W` allows production use with `WtSend`
    /// and test use with `DuplexStream`.
    ///
    /// Creates an internal `mpsc::channel(buffer)`, wraps `token` in a
    /// [`CancelHandle`], and spawns the forwarding task. The task owns the
    /// `FramedWrite`, `mpsc::Receiver`, and a `CancelHandle` clone.
    ///
    /// # Contract
    ///
    /// - `buffer` determines backpressure capacity.
    /// - The forwarding task terminates when cancel fires, the mpsc channel
    ///   closes (all senders dropped), or a transport write error occurs.
    /// - On transport error, the task calls `cancel(TransportError)`.
    pub(crate) fn new<W: AsyncWrite + Send + Unpin + 'static>(
        transport_tx: FramedWrite<W, CompressedCborEncoder<S>>,
        token: CancellationToken,
        buffer: NonZeroUsize,
    ) -> Self {
        let (tx, rx) = mpsc::channel(buffer.get());
        let cancel = CancelHandle::new(token);

        // Spawn the forwarding task: mpsc::Receiver → FramedWrite.
        //
        // Owns: transport_tx (FramedWrite), rx (mpsc::Receiver), cancel clone.
        // Terminates: on cancel, channel close, or transport write error.
        // JoinHandle: dropped — task is lightweight and self-terminating.
        // Panic would indicate a serialization bug (logged by tokio's
        // default panic handler).
        let task_cancel = cancel.clone();
        // JoinHandle dropped immediately — task is self-terminating (see contract above).
        let _ = tokio::spawn(async move {
            Self::forwarding_task(transport_tx, rx, task_cancel).await;
        });

        Self { tx, cancel }
    }

    /// The forwarding task loop.
    ///
    /// Drains the mpsc receiver into the framed transport writer. Exits on:
    /// - Cancellation (via `CancelHandle` / parent token)
    /// - Channel closed (all `StreamSink` clones dropped)
    /// - Transport write error (sets `CancelReason::TransportError`)
    async fn forwarding_task<W: AsyncWrite + Send + Unpin + 'static>(
        mut transport_tx: FramedWrite<W, CompressedCborEncoder<S>>,
        mut rx: mpsc::Receiver<S>,
        cancel: CancelHandle,
    ) {
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break,
                msg = rx.recv() => {
                    match msg {
                        Some(payload) => {
                            if let Err(err) = transport_tx.send(payload).await {
                                tracing::debug!(
                                    error = %err,
                                    "forwarding task: transport write error, cancelling stream"
                                );
                                cancel.cancel(CancelReason::TransportError);
                                break;
                            }
                        }
                        // All senders dropped — channel closed.
                        None => break,
                    }
                }
            }
        }
    }

    /// Send a message, waiting if the buffer is full.
    ///
    /// # Errors
    ///
    /// Returns `SendError` if the channel is closed (forwarding task exited).
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe. If dropped before completion, the message is not sent
    /// and the channel state is unchanged.
    pub async fn send(&self, msg: S) -> Result<(), mpsc::error::SendError<S>> {
        self.tx.send(msg).await
    }

    /// Try to send a message without waiting.
    ///
    /// # Errors
    ///
    /// - `TrySendError::Full` — buffer is full (client behind on messages).
    /// - `TrySendError::Closed` — channel is closed (forwarding task exited).
    pub fn try_send(&self, msg: S) -> Result<(), mpsc::error::TrySendError<S>> {
        self.tx.try_send(msg)
    }

    /// Cancel the stream with a reason.
    ///
    /// Signals the forwarding task to exit and records the reason.
    /// First caller wins (see [`CancelHandle::cancel`]).
    pub fn cancel(&self, reason: CancelReason) {
        self.cancel.cancel(reason);
    }

    /// Borrow the underlying [`CancelHandle`] for inspection or waiting.
    pub fn cancel_handle(&self) -> &CancelHandle {
        &self.cancel
    }

    /// Whether this sink's stream has been cancelled (by any cause).
    pub fn is_cancelled(&self) -> bool {
        self.cancel.is_cancelled()
    }

    /// Why was this sink's stream cancelled?
    ///
    /// Delegates to [`CancelHandle::reason`]. See its documentation for
    /// the distinction between `Some(reason)` and `None`.
    pub fn reason(&self) -> Option<&CancelReason> {
        self.cancel.reason()
    }
}

impl<S> PartialEq for StreamSink<S> {
    /// Two sinks are equal iff they share the same cancel handle identity.
    ///
    /// Same semantics as the old `SharedSender::same_channel` — used for
    /// identity checks in cleanup tasks (ABA prevention).
    fn eq(&self, other: &Self) -> bool {
        self.cancel == other.cancel
    }
}

impl<S> Eq for StreamSink<S> {}

impl<S> std::fmt::Debug for StreamSink<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamSink")
            .field("capacity", &self.tx.capacity())
            .field("cancelled", &self.cancel.is_cancelled())
            .field("reason", &self.cancel.reason())
            .finish()
    }
}
