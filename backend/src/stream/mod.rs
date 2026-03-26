#![allow(unused_imports)]

mod compress_cbor_codec;
mod stream_manager;

pub use futures::SinkExt;
pub use futures::StreamExt;
use salvo::Depot;
pub use stream_manager::{
    Receiver, Sender, SharedSender, StreamApiError, StreamManager, StreamManagerDepotExt,
    StreamManagerError, connect_stream, router, webtransport_router,
};

use crate::db::Db;
use crate::notifications::NotificationManagerDepotExt;

/// Stream-type header sent as the first CBOR frame on every server-opened stream.
///
/// The client reads this to decide which handler to dispatch.
#[derive(Debug, Clone, serde::Serialize)]
pub enum StreamType {
    Notifications,
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

/// Actions to take when a user successfully connects to our streaming infrastructure.
///
/// When this function returns an error, it is logged and the connection is closed.
async fn on_connect(
    user_id: i32,
    db: &Db,
    streams: &StreamManager,
    depot: &mut Depot,
) -> anyhow::Result<()> {
    depot
        .notification_manager()
        .open_stream(db, streams, user_id)
        .await?;

    // When everything else succeeds, send a welcome notification to the user
    depot
        .notification_manager()
        .send(
            db,
            user_id,
            crate::notifications::NotificationPayload::ServerHello,
        )
        .await?;
    Ok(())
}

// TODO need AUTH (while the connection is open: session could expire, get deleted, logged out, user deleted, etc.)
// maybe enforce regular access verification by requiring the client to continuously
// use a rest endpoint where the access for a user is verified.
// And if that doesnt happen for a while, the stream is closed.
