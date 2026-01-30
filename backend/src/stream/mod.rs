#![allow(unused_imports)]

mod compress_cbor_codec;
mod echo_example;
mod stream_manager;

pub use futures::SinkExt;
pub use futures::StreamExt;
pub use stream_manager::{
    Receiver, Sender, StreamApiError, StreamManager, StreamManagerError, connect_stream, router,
    webtransport_router,
};

#[derive(Debug, Clone, serde::Serialize)]
pub enum StreamType {
    Ctrl(stream_manager::PendingConnectionKey),
    /// EchoExample stream that is requested via a REST API call
    /// and simply echoes back whatever the client sends.
    /// The contained String is an echo of the parameter
    /// the client sent during the REST API call.
    EchoExample(String),
}
