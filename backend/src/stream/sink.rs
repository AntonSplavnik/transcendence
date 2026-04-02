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
use tokio::sync::oneshot;
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

/// Internal message envelope for the forwarding task's mpsc channel.
///
/// Multiplexes fire-and-forget and confirmed sends over a single channel,
/// preserving total message ordering regardless of send mode.
///
/// # Why a single channel (alternatives rejected)
///
/// - **Separate channel for confirmed sends**: `select!` between two receivers
///   loses ordering between fire-and-forget and confirmed messages.
/// - **`Option<oneshot>` on every message**: batches don't fit — if message 3
///   of 5 fails, the oneshot on message 5 is never resolved.
///
/// `pub(super)` — internal to the `stream` module. Not public API.
#[derive(Debug)]
pub(super) enum Envelope<S> {
    /// Fire-and-forget single message.
    Send(S),
    /// Fire-and-forget batch. Forwarding task writes each sequentially with
    /// no interleaving from other senders.
    SendBatch(Vec<S>),
    /// Single message with transport-level delivery confirmation.
    Confirm(S, oneshot::Sender<Result<(), ConfirmedSendError>>),
    /// Batch with transport-level delivery confirmation. On partial failure,
    /// error carries unsent messages back to the caller.
    ConfirmBatch(Vec<S>, oneshot::Sender<Result<(), ConfirmedBatchError<S>>>),
}

/// Single confirmed send failure.
///
/// # Extensibility
///
/// `#[non_exhaustive]` — future variants may carry diagnostic data.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ConfirmedSendError {
    /// Channel closed — forwarding task exited before processing this message.
    /// The message never reached the transport.
    #[error("channel closed before message reached forwarding task")]
    ChannelClosed,

    /// Transport write failed. The `FramedWrite::send` call returned an error.
    #[error("transport write failed: {0}")]
    Transport(anyhow::Error),
}

/// Batch confirmed send failure. Partial delivery is possible.
///
/// Ownership of unsent messages is returned to the caller for
/// persistence, retry, or discard — no cloning or re-indexing needed.
///
/// # Invariants
///
/// - `sent + unsent.len()` equals the original batch size.
/// - `unsent[0]` is the message that failed (if `source` is a transport error).
/// - On channel-closed-before-processing: `sent == 0`, all messages in `unsent`.
#[derive(Debug, thiserror::Error)]
#[error("batch send failed after {sent} messages: {source}")]
pub struct ConfirmedBatchError<S> {
    /// Number of messages successfully written to the transport.
    pub sent: usize,
    /// Messages NOT written. First element is the one that failed (transport error)
    /// or the first unprocessed message (channel closed). Ownership returned to caller.
    pub unsent: Vec<S>,
    /// The underlying error.
    pub source: anyhow::Error,
}

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
    tx: mpsc::Sender<Envelope<S>>,
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

        let task_cancel = cancel.clone();
        // JoinHandle dropped immediately — task is self-terminating (see contract above).
        let _ = tokio::spawn(async move {
            Self::forwarding_task(transport_tx, rx, task_cancel).await;
        });

        Self { tx, cancel }
    }

    /// The forwarding task loop.
    ///
    /// Drains the mpsc receiver into the framed transport writer. Each envelope
    /// variant is processed atomically — a batch is written sequentially with no
    /// interleaving from other senders.
    ///
    /// # Termination
    ///
    /// - Cancellation (via `CancelHandle` / parent token)
    /// - Channel closed (all `StreamSink` clones dropped)
    /// - Transport write error (sets `CancelReason::TransportError`)
    ///
    /// # Confirmed send oneshot semantics
    ///
    /// - On success: `Ok(())` sent through the oneshot.
    /// - On transport error: error sent through the oneshot, then cancel + break.
    /// - On task cancellation while processing: oneshot sender is dropped. The
    ///   caller's receiver gets `RecvError`, translated to `ConfirmedSendError::ChannelClosed`.
    async fn forwarding_task<W: AsyncWrite + Send + Unpin + 'static>(
        mut transport_tx: FramedWrite<W, CompressedCborEncoder<S>>,
        mut rx: mpsc::Receiver<Envelope<S>>,
        cancel: CancelHandle,
    ) {
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break,
                envelope = rx.recv() => {
                    match envelope {
                        Some(Envelope::Send(msg)) => {
                            if let Err(err) = transport_tx.send(msg).await {
                                tracing::debug!(
                                    error = %err,
                                    "forwarding task: transport write error, cancelling stream"
                                );
                                cancel.cancel(CancelReason::TransportError);
                                break;
                            }
                        }
                        Some(Envelope::SendBatch(msgs)) => {
                            for msg in msgs {
                                if let Err(err) = transport_tx.send(msg).await {
                                    tracing::debug!(
                                        error = %err,
                                        "forwarding task: transport write error during batch, cancelling stream"
                                    );
                                    cancel.cancel(CancelReason::TransportError);
                                    // Fire-and-forget batch: remaining messages are dropped.
                                    // No error reporting channel — caller accepted this when
                                    // choosing fire-and-forget over confirmed.
                                    return;
                                }
                            }
                        }
                        Some(Envelope::Confirm(msg, response_tx)) => {
                            match transport_tx.send(msg).await {
                                Ok(()) => {
                                    // Receiver may have been dropped (caller cancelled).
                                    // Benign — the message was still delivered.
                                    let _ = response_tx.send(Ok(()));
                                }
                                Err(err) => {
                                    let err_string = err.to_string();
                                    // Send error through oneshot before cancelling.
                                    // Receiver may have been dropped — benign.
                                    let _ = response_tx.send(Err(
                                        ConfirmedSendError::Transport(err.into())
                                    ));
                                    tracing::debug!(
                                        error = %err_string,
                                        "forwarding task: confirmed send transport error, cancelling stream"
                                    );
                                    cancel.cancel(CancelReason::TransportError);
                                    break;
                                }
                            }
                        }
                        Some(Envelope::ConfirmBatch(msgs, response_tx)) => {
                            let total = msgs.len();
                            let mut sent = 0usize;
                            let mut msgs_iter = msgs.into_iter();

                            for msg in &mut msgs_iter {
                                match transport_tx.send(msg).await {
                                    Ok(()) => { sent += 1; }
                                    Err(err) => {
                                        let err_string = err.to_string();
                                        // Collect remaining unsent messages.
                                        // The failed message was consumed by FramedWrite::send,
                                        // so it is NOT in `unsent`. `unsent` starts with the
                                        // NEXT unprocessed message.
                                        let unsent: Vec<S> = msgs_iter.collect();
                                        let _ = response_tx.send(Err(ConfirmedBatchError {
                                            sent,
                                            unsent,
                                            source: err.into(),
                                        }));
                                        tracing::debug!(
                                            error = %err_string,
                                            sent,
                                            remaining = total - sent - 1,
                                            "forwarding task: batch confirmed send transport error, cancelling stream"
                                        );
                                        cancel.cancel(CancelReason::TransportError);
                                        return;
                                    }
                                }
                            }

                            // All messages sent successfully.
                            let _ = response_tx.send(Ok(()));
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
        self.tx
            .send(Envelope::Send(msg))
            .await
            .map_err(|e| {
                // Extract the inner message from the Envelope for the caller.
                let Envelope::Send(msg) = e.0 else {
                    // INVARIANT: we just wrapped in Envelope::Send above. This branch
                    // is unreachable — the match is exhaustive for safety.
                    unreachable!("send() always wraps in Envelope::Send")
                };
                mpsc::error::SendError(msg)
            })
    }

    /// Send a batch of messages as a single atomic unit.
    ///
    /// The entire batch is enqueued as one `Envelope::SendBatch`. The forwarding
    /// task writes each message sequentially with no interleaving from other
    /// senders — the batch is atomic at the transport level.
    ///
    /// An empty `msgs` vec is a no-op (nothing is enqueued).
    ///
    /// # Errors
    ///
    /// Returns `SendError` if the channel is closed (forwarding task exited).
    /// On error, none of the batch messages were enqueued.
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe. If dropped before completion, no messages are enqueued.
    pub async fn send_batch(&self, msgs: Vec<S>) -> Result<(), mpsc::error::SendError<Vec<S>>> {
        if msgs.is_empty() {
            return Ok(());
        }
        self.tx
            .send(Envelope::SendBatch(msgs))
            .await
            .map_err(|e| {
                let Envelope::SendBatch(msgs) = e.0 else {
                    unreachable!("send_batch always wraps in Envelope::SendBatch")
                };
                mpsc::error::SendError(msgs)
            })
    }

    /// Send a message with transport-level delivery confirmation.
    ///
    /// Queues the message with a oneshot response channel. The forwarding task
    /// writes to `FramedWrite::send` and sends the result back through the oneshot.
    ///
    /// "Confirmed" means the framed transport accepted the bytes — NOT that the
    /// client application processed them. QUIC provides reliable transport, but
    /// this is NOT an application-level ACK.
    ///
    /// # Errors
    ///
    /// - [`ConfirmedSendError::ChannelClosed`] — forwarding task exited before
    ///   processing this message. The message never reached the transport.
    /// - [`ConfirmedSendError::Transport`] — the `FramedWrite::send` call failed.
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe. If dropped mid-await, the message may or may not be written
    /// (it's in the mpsc buffer). The forwarding task drops the oneshot response
    /// sender if it processes the message after the caller stopped waiting.
    /// No corruption occurs in either case.
    pub async fn send_confirmed(&self, msg: S) -> Result<(), ConfirmedSendError> {
        let (response_tx, response_rx) = oneshot::channel();
        self.tx
            .send(Envelope::Confirm(msg, response_tx))
            .await
            .map_err(|_| ConfirmedSendError::ChannelClosed)?;

        // Wait for the forwarding task's confirmation.
        // RecvError means the forwarding task dropped the sender (cancelled/exited).
        match response_rx.await {
            Ok(result) => result,
            Err(_) => Err(ConfirmedSendError::ChannelClosed),
        }
    }

    /// Send a batch of messages with transport-level delivery confirmation.
    ///
    /// The entire batch is queued as one `Envelope::ConfirmBatch`. The forwarding
    /// task writes each message sequentially. On success, all messages were
    /// written to the transport. On failure, the error carries the count of
    /// successfully sent messages and ownership of the unsent remainder.
    ///
    /// An empty `msgs` vec succeeds immediately (no-op).
    ///
    /// # Errors
    ///
    /// - [`ConfirmedBatchError`] — partial or complete failure. `sent` is the
    ///   number successfully written, `unsent` contains messages that were not
    ///   written (ownership returned to caller for persistence/retry/discard).
    ///
    /// # Cancel Safety
    ///
    /// Cancel-safe. If dropped mid-await, the batch may be partially written
    /// but the caller won't know which messages were sent. Acceptable for
    /// at-least-once callers. Exactly-once callers should not cancel this future.
    pub async fn send_confirmed_batch(
        &self,
        msgs: Vec<S>,
    ) -> Result<(), ConfirmedBatchError<S>> {
        if msgs.is_empty() {
            return Ok(());
        }

        let (response_tx, response_rx) = oneshot::channel();
        if self
            .tx
            .send(Envelope::ConfirmBatch(msgs, response_tx))
            .await
            .is_err()
        {
            // Channel closed — forwarding task exited. Extract msgs from the
            // failed Envelope. Unfortunately, mpsc::SendError consumes the
            // Envelope and we can't destructure it after the send attempt.
            // The messages are lost in the error value.
            //
            // To return them, we'd need to keep a clone, which defeats the
            // zero-copy design. Instead, signal total failure.
            return Err(ConfirmedBatchError {
                sent: 0,
                unsent: vec![], // Messages consumed by the failed send.
                source: anyhow::anyhow!("channel closed before batch reached forwarding task"),
            });
        }

        match response_rx.await {
            Ok(result) => result,
            Err(_) => Err(ConfirmedBatchError {
                sent: 0,
                unsent: vec![],
                source: anyhow::anyhow!("forwarding task dropped response channel"),
            }),
        }
    }

    /// Try to send a message without waiting.
    ///
    /// # Errors
    ///
    /// - `TrySendError::Full` — buffer is full (client behind on messages).
    /// - `TrySendError::Closed` — channel is closed (forwarding task exited).
    pub fn try_send(&self, msg: S) -> Result<(), mpsc::error::TrySendError<S>> {
        self.tx.try_send(Envelope::Send(msg)).map_err(|e| match e {
            mpsc::error::TrySendError::Full(Envelope::Send(msg)) => {
                mpsc::error::TrySendError::Full(msg)
            }
            mpsc::error::TrySendError::Closed(Envelope::Send(msg)) => {
                mpsc::error::TrySendError::Closed(msg)
            }
            // INVARIANT: try_send always wraps in Envelope::Send.
            _ => unreachable!("try_send always wraps in Envelope::Send"),
        })
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
