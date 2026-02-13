#![allow(unused_imports)]

mod compress_cbor_codec;
mod stream_manager;

pub use futures::SinkExt;
pub use futures::StreamExt;
use salvo::Depot;
pub use stream_manager::{
    Receiver, Sender, StreamApiError, StreamManager, StreamManagerDepotExt, StreamManagerError,
    connect_stream, router, webtransport_router,
};

use crate::db::Db;
use crate::notifications::NotificationManagerDepotExt;

#[derive(Debug, Clone, serde::Serialize)]
pub enum StreamType {
    Ctrl(stream_manager::PendingConnectionKey),
    Notifications,
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
    Ok(())
}
