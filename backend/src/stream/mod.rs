mod compress_cbor_codec;
mod echo_example;
mod stream_manager;

pub use futures::SinkExt;
pub use futures::StreamExt;
pub use stream_manager::{
    Receiver, Sender, StreamApiError, StreamManager, StreamManagerError,
    connect_stream, router, webtransport_router,
};

#[derive(Debug, Clone, serde::Serialize)]
pub enum StreamType {
    Ctrl(stream_manager::PendingConnectionKey),
    /// EchoExample stream that is requested via a REST API call
    /// and simply echoes back whatever the client sends.
    /// The contained String is an echo of the parameter
    /// the client sent during the REST API call.
    EchoExample(String),
    Chat,
    Game,
}

// TODO need AUTH (while the connection is open: session could expire, get deleted, logged out, user deleted, etc.)
// maybe enforce regular access verification by requiring the client to continuously
// use a rest endpoint where the access for a user is verified.
// And if that doesnt happen for a while, the stream is closed.
