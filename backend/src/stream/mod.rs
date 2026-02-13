#![allow(unused_imports)]

mod compress_cbor_codec;
mod stream_manager;

pub use futures::SinkExt;
pub use futures::StreamExt;
pub use stream_manager::{
    Receiver, Sender, StreamApiError, StreamManager, StreamManagerDepotExt, StreamManagerError,
    connect_stream, router, webtransport_router,
};

#[derive(Debug, Clone, serde::Serialize)]
pub enum StreamType {
    Ctrl(stream_manager::PendingConnectionKey),
}
