//! Stream module — transport and real-time typed message passing over WebTransport.
//!
//! # Architecture
//!
//! ```text
//! Need shared state + broadcast?  → StreamRoom
//! Need just a sender?             → StreamSink
//! Need to know why cancelled?     → cancel_handle.reason()
//! ```
//!
//! All types are re-exported from this module. For room-based broadcast,
//! see [`stream_room`]. For standalone streams, use [`StreamSink`] directly
//! via [`StreamManager`] or [`spawn_receive_loop`].
//!
//! # Module Index
//!
//! | Module | Purpose |
//! |--------|---------|
//! | `cancel` | [`CancelHandle`], [`CancelReason`] — cancellation with structured reasons |
//! | `sink` | [`StreamSink<S>`], buffer constants |
//! | `stream_room` | [`StreamRoom<P>`], [`RoomProtocol`] — room lifecycle callbacks |
//! | `stream_manager` | [`StreamManager`] — WebTransport connections |

mod cancel;
mod compress_cbor_codec;
mod sink;
mod stream_manager;
mod stream_room;
mod user_stream;

pub use cancel::{CancelHandle, CancelReason};
use salvo::Depot;
// MAX_INIT_MESSAGES and Receiver are public API consumed by callers of
// StreamRoom / request_stream. Plan B (chat module) will also use
// JoinError, RoomProtocol, and StreamRoom via this re-export.
#[allow(unused_imports)]
pub use sink::{
    ConfirmedBatchError, ConfirmedSendError, DEFAULT_SINK_BUFFER, MAX_INIT_MESSAGES, StreamSink,
};
#[allow(unused_imports)]
pub use stream_manager::{
    Receiver, StreamApiError, StreamManager, StreamManagerDepotExt, StreamManagerError,
    connect_stream, router, webtransport_router,
};
#[allow(unused_imports)]
pub use stream_room::{JoinError, RoomProtocol, StreamRoom};
#[allow(unused_imports)]
pub use user_stream::{
    OpenError, SendError as UserStreamSendError, UserStream, UserStreamProtocol,
};

use crate::db::Db;
use crate::notifications::NotificationManagerDepotExt;

/// Stream-type header sent as the first CBOR frame on every server-opened stream.
///
/// The client reads this to decide which handler to dispatch.
///
/// # Extensibility
///
/// `#[non_exhaustive]` — future modules (chat, game) add variants.
/// Match arms must include a wildcard.
#[derive(Debug, Clone, serde::Serialize)]
#[non_exhaustive]
pub enum StreamType {
    Notifications,
    /// Test-only variant. Not serialized over the wire.
    #[cfg(test)]
    Test,
    /// Persistent control stream for connection-lifecycle signaling.
    ///
    /// Opened immediately when the WebTransport session is established.
    /// The [`PendingConnectionKey`](stream_manager::PendingConnectionKey)
    /// is sent as part of this header so the client can complete the
    /// two-step auth handshake.  Subsequent messages on this stream are
    /// [`CtrlMessage`] values.
    Ctrl(stream_manager::PendingConnectionKey),
}

/// Messages sent on the [`StreamType::Ctrl`] uni stream after the header.
///
/// The control stream stays open for the lifetime of the WebTransport
/// connection and carries lifecycle signals.
#[derive(Debug, Clone, serde::Serialize)]
pub enum CtrlMessage {
    /// Signals that this session is being replaced by a newer connection
    /// from the same user (another tab, device, etc.).
    Displaced,
}

/// Typed protocol binding for standalone `StreamSink` usage.
///
/// Binds Send/Recv types without room lifecycle. Use with
/// `StreamManager::open_protocol()` for typed stream creation.
///
/// `RoomProtocol` adds lifecycle callbacks and is used with `StreamRoom`.
/// A type may implement both.
pub trait StreamProtocol {
    /// Server → client message type.
    type Send: serde::Serialize + Send + 'static;
    /// Client → server message type.
    type Recv: serde::de::DeserializeOwned + Send + 'static;
    /// Stream type identifier for the transport layer.
    fn stream_type(&self) -> StreamType;
}

/// Spawn a task that reads messages from a stream receiver.
///
/// # Spawned Task Contract
///
/// - **Owns**: `rx`, `handler` closure, `CancelHandle` clone
/// - **Terminates**: stream end, decode error, or cancellation
/// - **Cancelled via**: `cancel` handle
/// - **On decode error**: logs error, calls `cancel.cancel(CancelReason::DecodeError)`,
///   exits loop (triggers cleanup task for automatic disconnect)
/// - **On stream end** (rx returns `None`): calls `cancel.cancel(CancelReason::StreamEnded)`.
///   Distinct from `None` reason (external/parent cancellation).
///
/// **Handler Closure Kind: `Fn` not `FnMut`**
///
/// The handler uses `Fn` (not `FnMut`) because typical handlers create a new
/// `async move` block per call (capturing `Arc<StreamRoom>` etc.), which is `Fn`.
/// Using `Fn` matches the common pattern and avoids implying mutable handler
/// state is expected. Handlers needing per-connection state (e.g., sequence
/// numbers) can use interior mutability (`Cell`, `AtomicU64`).
///
/// # Cancel Safety
///
/// Cancel-safe. Dropping the `JoinHandle` detaches the task but the
/// `CancelHandle` still controls shutdown.
pub fn spawn_receive_loop<R, F, Fut>(
    rx: impl futures::Stream<Item = Result<R, anyhow::Error>> + Send + Unpin + 'static,
    cancel: CancelHandle,
    handler: F,
) -> tokio::task::JoinHandle<()>
where
    R: Send + 'static,
    F: Fn(R) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = ()> + Send,
{
    use futures::StreamExt;

    // Spawned task: owns rx, handler, cancel clone.
    // Terminates on: cancel, stream end, or decode error.
    // JoinHandle: returned to caller (typically dropped — task is
    // CancelHandle-governed and self-terminating).
    tokio::spawn(async move {
        let mut rx = std::pin::pin!(rx);
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break,
                item = rx.next() => {
                    match item {
                        Some(Ok(msg)) => handler(msg).await,
                        Some(Err(err)) => {
                            tracing::debug!(
                                error = %err,
                                "receive loop: decode error, cancelling stream"
                            );
                            cancel.cancel(CancelReason::DecodeError);
                            break;
                        }
                        None => {
                            // Stream ended normally — client closed their send direction.
                            cancel.cancel(CancelReason::StreamEnded);
                            break;
                        }
                    }
                }
            }
        }
    })
}

/// Actions to take when a user successfully connects to our streaming infrastructure.
///
/// When this function returns an error, it is logged and the connection is closed.
async fn on_connect(
    user_id: i32,
    _db: &Db,
    streams: &StreamManager,
    depot: &mut Depot,
) -> anyhow::Result<()> {
    depot
        .notification_manager()
        .open_stream(streams, user_id)
        .await?;

    // When everything else succeeds, send a welcome notification to the user
    depot
        .notification_manager()
        .send(
            user_id,
            crate::notifications::NotificationPayload::ServerHello,
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests;
