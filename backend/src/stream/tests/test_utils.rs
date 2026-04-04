//! Test utilities for the stream module.
//!
//! Provides in-memory `DuplexStream`-backed sinks, clients, and stream openers
//! for testing `StreamSink` and `StreamRoom` without WebTransport.
//!
//! All types here use `DuplexStream` (in-memory pipe) instead of real QUIC
//! connections. The CBOR+Zstd codec is still exercised — only the transport
//! layer is replaced.
//!
//! Gated behind `#[cfg(test)]` — not compiled in production builds.

use std::num::NonZeroUsize;
use std::time::Duration;

use futures::SinkExt;
use futures::stream::StreamExt;
use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::io::DuplexStream;
use tokio_util::codec::{FramedRead, FramedWrite};
use tokio_util::sync::CancellationToken;

use super::super::cancel::CancelHandle;
use super::super::compress_cbor_codec::{CompressedCborDecoder, CompressedCborEncoder};
use super::super::sink::{DEFAULT_SINK_BUFFER, StreamSink};

/// `DuplexStream` buffer size for tests.
///
/// 64 KiB — comfortably fits any test message burst without
/// `poll_write` returning `Pending` and causing timeouts.
pub const DUPLEX_BUFFER: usize = 65536;

/// Timeout for test assertions that wait for async events.
const TEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Create a `StreamSink<S>` backed by an in-memory `DuplexStream`.
///
/// Returns:
/// - `StreamSink<S>` — the server-side sender
/// - `TestClient<S>` — reads what the server sends (simulates WebTransport client)
pub fn test_sink<S: Serialize + DeserializeOwned + Send + 'static>()
-> (StreamSink<S>, TestClient<S>) {
    test_sink_with_buffer(DEFAULT_SINK_BUFFER)
}

/// Like `test_sink` but with a custom buffer size.
pub fn test_sink_with_buffer<S: Serialize + DeserializeOwned + Send + 'static>(
    buffer: NonZeroUsize,
) -> (StreamSink<S>, TestClient<S>) {
    let (server_write, client_read) = tokio::io::duplex(DUPLEX_BUFFER);
    let framed_write = FramedWrite::new(server_write, CompressedCborEncoder::<S>::new());
    let token = CancellationToken::new();
    let sink = StreamSink::new(framed_write, token, buffer);
    let client = TestClient::new(client_read);
    (sink, client)
}

/// Create a matched send + receive pair for testing `StreamRoom`.
///
/// Returns:
/// - `StreamSink<S>` — server send side
/// - `impl Stream<Item = Result<R, anyhow::Error>>` — server receive side
/// - `TestClient<S>` — reads what server sends
/// - `TestClientSender<R>` — sends messages as the "client"
#[allow(clippy::type_complexity)]
pub fn test_stream_pair<
    S: Serialize + DeserializeOwned + Send + 'static,
    R: Serialize + DeserializeOwned + Send + 'static,
>(
    buffer: NonZeroUsize,
) -> (
    StreamSink<S>,
    impl futures::Stream<Item = Result<R, anyhow::Error>> + Send + Unpin,
    TestClient<S>,
    TestClientSender<R>,
    CancelHandle,
) {
    // Server → Client direction
    let (server_write, client_read) = tokio::io::duplex(DUPLEX_BUFFER);
    // Client → Server direction
    let (client_write, server_read) = tokio::io::duplex(DUPLEX_BUFFER);

    let framed_write = FramedWrite::new(server_write, CompressedCborEncoder::<S>::new());
    let token = CancellationToken::new();
    let sink = StreamSink::new(framed_write, token, buffer);
    let cancel = sink.cancel_handle().clone();

    let server_rx = FramedRead::new(server_read, CompressedCborDecoder::<R>::new())
        .map(|r| r.map_err(|e| anyhow::anyhow!(e)));

    let client = TestClient::new(client_read);
    let client_sender = TestClientSender::new(client_write);

    (sink, server_rx, client, client_sender, cancel)
}

/// Test client that reads messages the server sends.
///
/// Wraps a `FramedRead<DuplexStream, CompressedCborDecoder<S>>`.
pub struct TestClient<S> {
    reader: FramedRead<DuplexStream, CompressedCborDecoder<S>>,
}

impl<S> std::fmt::Debug for TestClient<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TestClient").finish_non_exhaustive()
    }
}

impl<S: DeserializeOwned> TestClient<S> {
    pub(crate) fn new(stream: DuplexStream) -> Self {
        Self {
            reader: FramedRead::new(stream, CompressedCborDecoder::new()),
        }
    }

    /// Receive the next message from the server.
    ///
    /// Panics if the stream closes or times out.
    pub async fn recv(&mut self) -> S {
        tokio::time::timeout(TEST_TIMEOUT, self.reader.next())
            .await
            .expect("test client recv timed out")
            .expect("stream closed unexpectedly")
            .expect("decode error in test client")
    }

    /// Receive and discard `n` messages.
    ///
    /// Useful for skipping init + join broadcasts when a test only
    /// cares about messages sent after setup.
    pub async fn drain(&mut self, n: usize) {
        for _ in 0..n {
            self.recv().await;
        }
    }

    /// Assert the next message equals `expected`.
    pub async fn expect(&mut self, expected: &S)
    where
        S: std::fmt::Debug + PartialEq,
    {
        let msg = self.recv().await;
        assert_eq!(msg, *expected, "unexpected message from server");
    }

    /// Assert the stream closes within the timeout.
    pub async fn expect_closed(&mut self) {
        let result = tokio::time::timeout(TEST_TIMEOUT, self.reader.next()).await;
        match result {
            Ok(None | Some(Err(_))) => {} // Stream closed or decode error on close — expected.
            Ok(Some(Ok(_))) => {
                panic!(
                    "expected stream to close, but received a message of type {}",
                    std::any::type_name::<S>()
                );
            }
            Err(e) => panic!("timed out waiting for stream to close: {e}"),
        }
    }
}

/// Test client sender that sends messages as the "client".
///
/// Wraps a `FramedWrite<DuplexStream, CompressedCborEncoder<R>>`.
pub struct TestClientSender<R> {
    writer: FramedWrite<DuplexStream, CompressedCborEncoder<R>>,
}

impl<R> std::fmt::Debug for TestClientSender<R> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TestClientSender").finish_non_exhaustive()
    }
}

impl<R: Serialize> TestClientSender<R> {
    pub(crate) fn new(stream: DuplexStream) -> Self {
        Self {
            writer: FramedWrite::new(stream, CompressedCborEncoder::new()),
        }
    }

    /// Send a message as the client.
    pub async fn send(&mut self, msg: R) {
        self.writer
            .send(msg)
            .await
            .expect("failed to send test client message");
    }
}
