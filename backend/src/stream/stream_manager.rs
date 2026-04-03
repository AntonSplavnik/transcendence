//! WebTransport Stream Manager
//!
//! This module manages WebTransport (HTTP/3) connections and exposes a small API
//! for *server-side* components to open bidirectional or uni-directional streams
//! to a connected user.
//!
//! # What the current implementation does
//!
//! ## Two-step authentication (CONNECT + REST bind)
//!
//! The CONNECT request used to establish WebTransport does not include cookies in
//! our setup, so we cannot authenticate that request directly.
//!
//! Instead, the connection is authenticated in two steps:
//!
//! 1. The client opens a WebTransport session via [`connect_stream`]. The server
//!    opens a [`StreamType::Ctrl`] uni stream whose header carries the
//!    [`PendingConnectionKey`].
//! 2. The client performs an authenticated REST call to [`bind_pending_stream`]
//!    (behind `Router::requires_user_login()`) and posts that `PendingConnectionKey`.
//!    The server looks up the key and forwards the authenticated [`Session`] to the
//!    waiting `connect_stream` task.
//!
//! If the bind call never arrives, `connect_stream` times out
//! (`PENDING_CONNECTION_TIMEOUT`) and the pending entry is cleaned up.
//!
//! ## One active connection per user
//!
//! Connected users are stored in a `DashMap(user_id -> ConnectionEntry)`.
//! Registering a new connection for the same user sends a
//! [`ConnectionCommand::Displace`] to the old handler (which sends a
//! [`CtrlMessage::Displaced`] on the Ctrl stream) before replacing the entry.
//! Dropping the old entry drops its command sender, which causes the old handler's
//! `cmd_rx.recv()` to return `None` and exit.
//!
//! ## Connection IDs and safe cleanup
//!
//! Every connection gets a monotonically increasing `connection_id`. Cleanup paths
//! (timeouts, session expiry tasks, handler shutdown) unregister with
//! `Some(connection_id)` to avoid removing a newer connection that replaced it.
//!
//! ## Session expiry auto-disconnect (and refresh)
//!
//! Each registered connection spawns an unregister task scheduled for
//! `session.access_expiry()`. Calling [`StreamManager::refresh_auth`] with the same
//! `session.id` aborts and re-schedules that task, effectively extending the
//! connection lifetime when the session is refreshed.
//!
//! ## Stream requests and framing
//!
//! Server-side components call [`StreamManager::request_stream`] to open a fresh
//! bidirectional stream on the user's WebTransport session, or
//! [`StreamManager::request_uni_stream`] for a server → client send-only stream.
//! Both return a [`StreamSink`](super::StreamSink) for the send side.
//!
//! The server always sends a first CBOR message describing the [`StreamType`] of
//! that stream. The returned `StreamSink`/`Receiver` then carry typed CBOR messages
//! (optionally compressed by the codec).
//!
//! ## Liveness detection (current state)
//!
//! The handler polls `accept_bi()` on the WebTransport session inside the main
//! `select!` loop.  This drives the underlying h3 `Connection`, which discovers
//! QUIC errors surfaced by quinn and breaks the loop on connection closure.
//!
//! # Errors
//!
//! - [`StreamManagerError::UserNotConnected`]: the user has no active entry.
//! - [`StreamManagerError::ConnectionClosed`]: a stream open/framing failed or the
//!   handler became unresponsive; the entry is removed.
//!
//! # Thread safety
//!
//! The [`StreamManager`] uses [`DashMap`] for concurrent access and is safe to call
//! from multiple tasks. Instances are provided via dependency injection and accessed
//! through the [`StreamManagerDepotExt`] trait rather than a global singleton.

use std::ops::Deref;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

use anyhow::Context;
use bytes::Bytes;
use dashmap::DashMap;
use futures::SinkExt as _;
use salvo::http::Method;
use salvo::proto::quic::BidiStream;
use salvo::routing::MethodFilter;
use std::num::NonZeroUsize;

use serde::Serialize;
use serde::de::DeserializeOwned;
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio::task::AbortHandle;
use tokio_util::codec::{FramedRead, FramedWrite};
use tokio_util::sync::CancellationToken;

use super::CtrlMessage;
use super::StreamType;
use super::compress_cbor_codec::{CodecBufferParams, CompressedCborDecoder, CompressedCborEncoder};
use crate::models::Session;
use crate::models::blob::FixedBlob;
use crate::prelude::*;
use crate::utils::adaptive_buffer::BufferParams;

pub fn router(path: impl Into<String>) -> Router {
    Router::with_path(path)
        .requires_user_login()
        .requires_tos_accepted()
        .oapi_tag("stream")
        .push(
            Router::with_path("bind")
                .user_rate_limit(&RateLimit::per_minute(10))
                .post(bind_pending_stream),
        )
}

/// Because the connect request doesnt have cookies attached,
/// auth using Router.requires_user_login() is not possible here.
pub fn webtransport_router(path: impl Into<String>) -> Router {
    Router::with_path(path)
        .hoop(crate::utils::logger::Logger)
        .ip_rate_limit(&RateLimit::per_5_minutes(30))
        .filter(MethodFilter::new(Method::CONNECT))
        .goal(crate::stream::connect_stream)
}

const PENDING_CONNECTION_TIMEOUT: Duration = Duration::from_secs(30);
/// Timeout for stream operations.
///
/// If a stream request doesn't receive a response within this duration,
/// the connection is considered dead and will be cleaned up.
const STREAM_TIMEOUT: Duration = Duration::from_secs(10);
/// 8 MiB packet limit for stream frames.
const MAX_STREAM_FRAME_SIZE: usize = 8 * 1024 * 1024;

/// Send half of a WebTransport bidirectional stream (raw, unframed).
type WtSend = salvo::webtransport::stream::SendStream<h3_quinn::SendStream<Bytes>, Bytes>;

/// Receive half of a WebTransport bidirectional stream (raw, unframed).
type WtRecv = salvo::webtransport::stream::RecvStream<h3_quinn::RecvStream, Bytes>;

/// Internal framed sender type. Used by `frame_stream`, `frame_uni_stream`,
/// and `open_ctrl_stream`. Public callers receive [`StreamSink`](super::StreamSink)
/// from [`StreamManager::request_stream`] / [`StreamManager::request_uni_stream`].
pub(crate) type Sender<S, BP = CodecBufferParams> =
    FramedWrite<WtSend, CompressedCborEncoder<S, BP>>;

/// A stream for receiving typed messages from a client.
///
/// Use with [`futures::StreamExt`] to receive messages:
/// ```ignore
/// use futures::StreamExt;
/// while let Some(msg) = receiver.next().await {
///     handle(msg?);
/// }
/// ```
pub type Receiver<R, const MAX_FRAME: usize = { 8 * 1024 * 1024 }> =
    FramedRead<WtRecv, CompressedCborDecoder<R, MAX_FRAME>>;

#[derive(Error, Debug)]
pub enum StreamApiError {
    #[error("invalid or expired pending connection key")]
    InvalidPendingStreamKey,
}

/// Errors returned by [`StreamManager`] operations.
#[derive(Error, Debug)]
pub enum StreamManagerError {
    /// The user has no active WebTransport connection.
    ///
    /// This can occur when:
    /// - The user never established a WebTransport session
    /// - The user's connection was already closed
    /// - The user was force-disconnected (e.g., logout, ban)
    #[error("user {user_id} is not connected")]
    UserNotConnected { user_id: i32 },

    /// The user's connection was lost during the operation.
    ///
    /// The connection has been automatically removed from the manager.
    /// This can occur when:
    /// - The client disconnected (network issue, browser closed, etc.)
    /// - The connection was replaced by a new one from the same user
    /// - The QUIC session failed (timeout, protocol error, etc.)
    /// - The handler crashed unexpectedly
    #[error("connection closed for user {user_id}: {reason}")]
    ConnectionClosed { user_id: i32, reason: String },
}

/// Result type for [`StreamManager`] operations.
pub type Result<T> = std::result::Result<T, StreamManagerError>;

/// Commands that can be sent to a user's WebTransport connection handler.
enum ConnectionCommand {
    /// Request to open a new bidirectional stream.
    OpenBidiStream {
        response: oneshot::Sender<Result<(WtSend, WtRecv)>>,
    },
    /// Request to open a new uni-directional (server → client) stream.
    OpenUniStream {
        response: oneshot::Sender<Result<WtSend>>,
    },
    /// Signal that this connection is being displaced by a newer one.
    /// The handler should send [`CtrlMessage::Displaced`] and shut down.
    Displace,
}

/// Entry in the connection registry, containing the channel and a unique connection ID.
struct ConnectionEntry {
    /// Task that resolves on auth expiry and unregisters the connection.
    /// This is aborted and replaced on auth refresh.
    unregister_task: AbortHandle,
    /// Channel for sending commands to the connection handler (e.g., open stream, displace).
    tx: mpsc::Sender<ConnectionCommand>,
    connection_id: u64,
    session_id: i32,
    /// Cancellation token used to signal connection closure
    disconnect_token: CancellationToken,
}

impl ConnectionEntry {
    fn new(
        streams: Weak<StreamManager>,
        session: &Session,
        connection_id: u64,
        tx: mpsc::Sender<ConnectionCommand>,
    ) -> Self {
        Self {
            tx,
            connection_id,
            session_id: session.id,
            unregister_task: Self::new_unregister_task(streams, session, connection_id),
            disconnect_token: CancellationToken::new(),
        }
    }

    fn refresh_auth(&mut self, streams: Weak<StreamManager>, session: &Session) {
        if session.id != self.session_id {
            return;
        }
        self.unregister_task.abort();
        self.unregister_task = Self::new_unregister_task(streams, session, self.connection_id);
    }

    fn new_unregister_task(
        streams: Weak<StreamManager>,
        session: &Session,
        connection_id: u64,
    ) -> AbortHandle {
        let unregister_at = session.access_expiry();
        let user_id = session.user_id;
        tokio::spawn(async move {
            let until_unregister = unregister_at
                .signed_duration_since(chrono::Utc::now())
                .to_std()
                .unwrap_or_default();
            tokio::time::sleep(until_unregister).await;
            if let Some(streams) = streams.upgrade() {
                streams.unregister(user_id, Some(connection_id), None);
            }
        })
        .abort_handle()
    }
}

impl Drop for ConnectionEntry {
    fn drop(&mut self) {
        self.disconnect_token.cancel();
        self.unregister_task.abort();
    }
}

pub type RandomNonce = FixedBlob<32>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
pub struct PendingConnectionKey {
    connection_id: u64,
    challenge: RandomNonce,
}

impl PendingConnectionKey {
    pub fn new(connection_id: u64) -> Self {
        Self {
            connection_id,
            challenge: rand::random(),
        }
    }
}

struct PendingConnectionGuard<'a>(
    PendingConnectionKey,
    &'a DashMap<PendingConnectionKey, oneshot::Sender<Session>, ahash::RandomState>,
);

impl Deref for PendingConnectionGuard<'_> {
    type Target = PendingConnectionKey;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for PendingConnectionGuard<'_> {
    fn drop(&mut self) {
        self.1.remove(&self.0);
    }
}

/// Global manager for WebTransport client connections.
///
/// Maintains a registry of connected users and their command channels,
/// allowing external components to request new streams.
pub struct StreamManager {
    /// Registry mapping pending connection keys to their session senders.
    pending_connections:
        DashMap<PendingConnectionKey, oneshot::Sender<Session>, ahash::RandomState>,
    /// Registry mapping user IDs to their connection entries.
    connections: DashMap<i32, ConnectionEntry, ahash::RandomState>,
    /// Counter for generating unique connection IDs.
    connection_id_counter: AtomicU64,
}

impl StreamManager {
    pub fn new() -> Self {
        Self {
            pending_connections: Default::default(),
            connections: Default::default(),
            connection_id_counter: Default::default(),
        }
    }

    /// Returns whether the given user is connected
    pub fn is_connected(&self, user_id: i32) -> bool {
        self.connections
            .get(&user_id)
            .map(|conn| !conn.tx.is_closed())
            .unwrap_or(false)
    }

    pub fn shutdown(&self) {
        self.pending_connections.clear();
        self.connections.clear();
    }

    /// This reauthenticates the stream associated to this session (if any)
    pub fn refresh_auth(self: &Arc<Self>, session: &Session) {
        self.connections
            .entry(session.user_id)
            .and_modify(|c| c.refresh_auth(Arc::downgrade(self), session));
    }

    fn register_pending<'a>(&'a self) -> (oneshot::Receiver<Session>, PendingConnectionGuard<'a>) {
        let connection_id = self.connection_id_counter.fetch_add(1, Ordering::Relaxed);
        let key = PendingConnectionKey::new(connection_id);
        let (tx, rx) = oneshot::channel();
        self.pending_connections.insert(key, tx);
        (rx, PendingConnectionGuard(key, &self.pending_connections))
    }

    /// Register a user's WebTransport connection command channel.
    ///
    /// Returns a unique connection ID that must be passed to `unregister` later.
    /// If the user already has a connection, the old handler is told to send
    /// [`CtrlMessage::Displaced`] before exiting.
    fn register(
        self: &Arc<Self>,
        session: &Session,
        tx: mpsc::Sender<ConnectionCommand>,
        connection_id: u64,
    ) -> u64 {
        // Tell the old connection it's being displaced before we replace it.
        // try_send is used because register() is not async; the command is
        // buffered and the old handler will process it before seeing the
        // channel close (None).
        if let Some(old) = self.connections.insert(
            session.user_id,
            ConnectionEntry::new(Arc::downgrade(self), session, connection_id, tx),
        ) && let Err(e) = old.tx.try_send(ConnectionCommand::Displace)
        {
            tracing::debug!(error = %e, "failed to send command");
        }
        tracing::debug!(
            session.user_id,
            connection_id,
            "Registered WebTransport connection"
        );
        connection_id
    }

    /// Disconnect a user's WebTransport connection.
    ///
    /// This is an internal method. External callers should use
    /// [`close_stream`](Self::close_stream) instead.
    ///
    /// # Parameters
    ///
    /// - `user_id`: The user to disconnect
    /// - `connection_id`: If `Some(id)`, only disconnects if the current connection
    ///   matches that ID. If `None`, forcefully disconnects regardless of ID.
    ///
    /// # When to use `Some(connection_id)`
    ///
    /// The connection handler should always pass its own `connection_id` when cleaning
    /// up. This prevents a race condition where an old connection's cleanup removes a
    /// newer connection that replaced it.
    ///
    /// # When to use `None`
    ///
    /// External components (e.g., auth system on logout, admin ban) should use `None`
    /// to force-disconnect the user regardless of which connection is active.
    fn unregister(
        &self,
        user_id: i32,
        connection_id: Option<u64>,
        session_id: Option<i32>,
    ) -> bool {
        let opt_removed = self.connections.remove_if(&user_id, |_, entry| {
            let matches = match connection_id {
                Some(id) => entry.connection_id == id,
                None => true,
            } && match session_id {
                Some(sid) => entry.session_id == sid,
                None => true,
            };
            if matches {
                tracing::debug!(
                    user_id,
                    connection_id = entry.connection_id,
                    "Unregistered connection"
                );
            }
            matches
        });
        match opt_removed {
            Some(conn) => {
                conn.1.unregister_task.abort();
                true
            }
            None => false,
        }
    }

    /// Request a new raw bidirectional stream for a connected user.
    ///
    /// Returns unframed WebTransport stream halves. This is a low-level API;
    /// prefer [`request_stream`](Self::request_stream) for typed message passing.
    ///
    /// # Errors
    ///
    /// - [`StreamManagerError::UserNotConnected`]: No active session for this user
    /// - [`StreamManagerError::ConnectionClosed`]: Connection died (auto-cleaned up)
    async fn request_unframed_stream(
        &self,
        user_id: i32,
    ) -> Result<((WtSend, WtRecv), u64, CancellationToken)> {
        let entry = self
            .connections
            .get(&user_id)
            .ok_or(StreamManagerError::UserNotConnected { user_id })?;
        let tx = entry.tx.clone();
        let connection_id = entry.connection_id;
        let token = entry.disconnect_token.clone();
        drop(entry);

        let (response_tx, response_rx) = oneshot::channel();

        // Send command to handler
        if tx
            .send(ConnectionCommand::OpenBidiStream {
                response: response_tx,
            })
            .await
            .is_err()
        {
            self.unregister(user_id, Some(connection_id), None);
            return Err(StreamManagerError::ConnectionClosed {
                user_id,
                reason: "handler exited".into(),
            });
        }

        // Wait for response with timeout - if timeout or error, connection is dead
        match tokio::time::timeout(STREAM_TIMEOUT, response_rx).await {
            Ok(Ok(result)) => result.map(|stream| (stream, connection_id, token)),
            Ok(Err(_)) | Err(_) => {
                self.unregister(user_id, Some(connection_id), None);
                Err(StreamManagerError::ConnectionClosed {
                    user_id,
                    reason: "handler unresponsive or crashed".into(),
                })
            }
        }
    }

    /// Request a new raw uni-directional (server → client) stream for a connected user.
    ///
    /// Returns an unframed WebTransport send stream. This is a low-level API;
    /// prefer [`request_uni_stream`](Self::request_uni_stream) for typed message passing.
    ///
    /// # Errors
    ///
    /// - [`StreamManagerError::UserNotConnected`]: No active session for this user
    /// - [`StreamManagerError::ConnectionClosed`]: Connection died (auto-cleaned up)
    async fn request_unframed_uni_stream(
        &self,
        user_id: i32,
    ) -> Result<(WtSend, u64, CancellationToken)> {
        let entry = self
            .connections
            .get(&user_id)
            .ok_or(StreamManagerError::UserNotConnected { user_id })?;
        let tx = entry.tx.clone();
        let connection_id = entry.connection_id;
        let token = entry.disconnect_token.clone();
        drop(entry);

        let (response_tx, response_rx) = oneshot::channel();

        // Send command to handler
        if tx
            .send(ConnectionCommand::OpenUniStream {
                response: response_tx,
            })
            .await
            .is_err()
        {
            self.unregister(user_id, Some(connection_id), None);
            return Err(StreamManagerError::ConnectionClosed {
                user_id,
                reason: "handler exited".into(),
            });
        }

        // Wait for response with timeout - if timeout or error, connection is dead
        match tokio::time::timeout(STREAM_TIMEOUT, response_rx).await {
            Ok(Ok(result)) => result.map(|stream| (stream, connection_id, token)),
            Ok(Err(_)) | Err(_) => {
                self.unregister(user_id, Some(connection_id), None);
                Err(StreamManagerError::ConnectionClosed {
                    user_id,
                    reason: "handler unresponsive or crashed".into(),
                })
            }
        }
    }

    /// Request a new bidirectional stream, returning a [`StreamSink`] + [`Receiver`].
    ///
    /// The send side is wrapped in a [`StreamSink`] with a bounded mpsc buffer and
    /// structured cancellation via [`CancelHandle`](super::CancelHandle).
    ///
    /// Standalone callers (not using `StreamRoom`) should use
    /// [`spawn_receive_loop`](super::spawn_receive_loop) rather than consuming the
    /// `Receiver` manually — it handles decode errors and cancellation correctly.
    ///
    /// # Arguments
    ///
    /// - `buffer`: mpsc channel capacity in **messages** (not bytes). Determines how
    ///   many messages can be queued before backpressure. Use
    ///   [`DEFAULT_SINK_BUFFER`](super::DEFAULT_SINK_BUFFER) (32) for most cases.
    ///
    /// # Errors
    ///
    /// - [`StreamManagerError::UserNotConnected`]: No active session for this user
    /// - [`StreamManagerError::ConnectionClosed`]: Connection died (auto-cleaned up)
    pub async fn request_stream<S, R>(
        &self,
        user_id: i32,
        r#type: StreamType,
        buffer: NonZeroUsize,
    ) -> Result<(super::StreamSink<S>, Receiver<R>)>
    where
        S: Serialize + Send + 'static,
        R: DeserializeOwned + Send + 'static,
    {
        let ((send, recv), connection_id, token) = self.request_unframed_stream(user_id).await?;

        let (sender, receiver) =
            frame_stream::<S, R, CodecBufferParams, MAX_STREAM_FRAME_SIZE>(send, recv, r#type)
                .await
                .map_err(|e| {
                    self.unregister(user_id, Some(connection_id), None);
                    StreamManagerError::ConnectionClosed {
                        user_id,
                        reason: format!("failed to frame stream: {e}"),
                    }
                })?;

        let child_token = token.child_token();
        let sink = super::StreamSink::new(sender, child_token, buffer);

        Ok((sink, receiver))
    }

    /// Request a new uni-directional (server → client) stream, returning a [`StreamSink`].
    ///
    /// The sender is wrapped in a [`StreamSink`] with a bounded mpsc buffer and
    /// structured cancellation. Use this for server-initiated push scenarios such
    /// as notifications or state updates.
    ///
    /// # Arguments
    ///
    /// - `buffer`: mpsc channel capacity in **messages** (not bytes). Determines how
    ///   many messages can be queued before backpressure. Use
    ///   [`DEFAULT_SINK_BUFFER`](super::DEFAULT_SINK_BUFFER) (32) for most cases.
    ///   `NonZeroUsize` enforces at the type level that zero-capacity channels
    ///   (rendezvous) cannot be created — they would cause immediate backpressure
    ///   cancellation on every broadcast.
    ///
    /// # Errors
    ///
    /// - [`StreamManagerError::UserNotConnected`]: No active session for this user
    /// - [`StreamManagerError::ConnectionClosed`]: Connection died (auto-cleaned up)
    pub async fn request_uni_stream<S>(
        &self,
        user_id: i32,
        r#type: StreamType,
        buffer: NonZeroUsize,
    ) -> Result<super::StreamSink<S>>
    where
        S: Serialize + Send + 'static,
    {
        let (send, connection_id, token) = self.request_unframed_uni_stream(user_id).await?;

        let sender = frame_uni_stream::<S, CodecBufferParams>(send, r#type)
            .await
            .map_err(|e| {
                self.unregister(user_id, Some(connection_id), None);
                StreamManagerError::ConnectionClosed {
                    user_id,
                    reason: format!("failed to frame uni stream: {e}"),
                }
            })?;

        let child_token = token.child_token();
        let sink = super::StreamSink::new(sender, child_token, buffer);

        Ok(sink)
    }

    /// Open a typed protocol stream via [`StreamProtocol`](super::StreamProtocol).
    ///
    /// Convenience method that uses the protocol's `stream_type()` and type
    /// parameters to open a correctly-typed bidirectional stream.
    ///
    /// # Arguments
    ///
    /// - `buffer`: mpsc channel capacity in **messages** (not bytes). Determines how
    ///   many messages can be queued before backpressure. Use
    ///   [`DEFAULT_SINK_BUFFER`](super::DEFAULT_SINK_BUFFER) (32) for most cases.
    ///   `NonZeroUsize` enforces at the type level that zero-capacity channels
    ///   (rendezvous) cannot be created — they would cause immediate backpressure
    ///   cancellation on every broadcast.
    ///
    /// # Errors
    ///
    /// - [`StreamManagerError::UserNotConnected`]: No active session for this user
    /// - [`StreamManagerError::ConnectionClosed`]: Connection died (auto-cleaned up)
    pub async fn open_protocol<P: super::StreamProtocol>(
        &self,
        user_id: i32,
        protocol: P,
        buffer: NonZeroUsize,
    ) -> Result<(super::StreamSink<P::Send>, Receiver<P::Recv>)>
    where
        P::Send: Send + 'static,
        P::Recv: Send + 'static,
    {
        self.request_stream(user_id, protocol.stream_type(), buffer)
            .await
    }

    /// Force-disconnect a user's WebTransport connection.
    ///
    /// This is useful for logout, ban, or other administrative actions that
    /// require immediately terminating a user's session.
    ///
    /// Note: This is a no-op if the user has no active connection.
    pub fn close_stream(&self, user_id: i32, session_id: Option<i32>) -> bool {
        self.unregister(user_id, None, session_id)
    }
}

async fn frame_stream<S, R, BP, const MAX_FRAME: usize>(
    tx: WtSend,
    rx: WtRecv,
    r#type: StreamType,
) -> anyhow::Result<(Sender<S, BP>, Receiver<R, MAX_FRAME>)>
where
    S: Serialize,
    R: DeserializeOwned,
    BP: BufferParams,
{
    let mut sender = FramedWrite::new(tx, CompressedCborEncoder::<&StreamType, BP>::new());
    sender
        .send(&r#type)
        .await
        .with_context(|| format!("failed to send stream type: {:?}", r#type))?;
    let sender = sender.map_encoder(|_| CompressedCborEncoder::new());
    let receiver = FramedRead::new(rx, CompressedCborDecoder::new());

    Ok((sender, receiver))
}

/// Frame a uni-directional (server → client) WebTransport stream.
///
/// Sends the [`StreamType`] header as the first CBOR message, then returns a
/// typed [`Sender`] for subsequent messages.
async fn frame_uni_stream<S, BP>(tx: WtSend, r#type: StreamType) -> anyhow::Result<Sender<S, BP>>
where
    S: Serialize,
    BP: BufferParams,
{
    let mut sender = FramedWrite::new(tx, CompressedCborEncoder::<&StreamType, BP>::new());
    sender
        .send(&r#type)
        .await
        .with_context(|| format!("failed to send stream type: {:?}", r#type))?;
    Ok(sender.map_encoder(|_| CompressedCborEncoder::new()))
}

/// Open the server → client Ctrl uni stream.
///
/// Sends `StreamType::Ctrl(key)` as the header frame so the client can
/// extract the [`PendingConnectionKey`] and authenticate via REST.
/// Returns a typed [`Sender`] for subsequent [`CtrlMessage`]s.
async fn open_ctrl_stream(
    tx: WtSend,
    key: PendingConnectionKey,
) -> anyhow::Result<Sender<CtrlMessage>> {
    frame_uni_stream(tx, StreamType::Ctrl(key)).await
}

/// WebTransport connection endpoint.
///
/// Establishes a WebTransport/QUIC session for real-time bidirectional communication.
/// This endpoint upgrades the HTTP/3 connection to a WebTransport session and maintains
/// it until the client disconnects or is force-disconnected.
///
/// # Protocol
///
/// 1. Client initiates WebTransport connection via HTTP/3 CONNECT
/// 2. Server opens a [`StreamType::Ctrl`] uni stream whose header carries the
///    [`PendingConnectionKey`] for the auth handshake
/// 3. Client authenticates via REST, server registers the connection in [`StreamManager`]
/// 4. Server-side components can request streams via [`StreamManager::request_stream`]
/// 5. On displacement, server sends [`CtrlMessage::Displaced`] on the Ctrl stream
/// 6. Connection closure is detected by polling `accept_bi()` which drives the h3 layer
///
/// # Single Connection Policy
///
/// Each user can have only one active WebTransport connection. Connecting from a new
/// device or tab will automatically disconnect the previous connection.
#[endpoint]
pub async fn connect_stream(
    req: &mut Request,
    depot: &mut Depot,
) -> std::result::Result<StatusCode, salvo::Error> {
    let wt_session = req.web_transport_mut().await.unwrap();
    let session_id = wt_session.session_id();

    let streams = depot.stream_manager().clone();
    let (session_rx, pending_key_guard) = streams.register_pending();
    let connection_id = pending_key_guard.connection_id;

    // Open the Ctrl uni stream and send the PendingConnectionKey.
    let tx = wt_session
        .open_uni(session_id)
        .await
        .context("failed to open ctrl uni stream")?;
    let mut ctrl = open_ctrl_stream(tx, *pending_key_guard)
        .await
        .context("failed to frame ctrl stream")?;

    let user_session = match tokio::time::timeout(PENDING_CONNECTION_TIMEOUT, session_rx).await {
        Ok(user_session) => user_session.context("waiting for pending connection bind")?,
        Err(_) => return Ok(StatusCode::REQUEST_TIMEOUT),
    };

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<ConnectionCommand>(16);
    let connection_id = streams.register(&user_session, cmd_tx, connection_id);

    let db = depot.db().clone();

    // Run on_connect concurrently with the command loop.  on_connect requests
    // streams (uni / bidi) via the StreamManager, which sends commands through
    // cmd_tx.  Those commands can only be fulfilled by the cmd_rx loop below.
    // Running both in the same select! avoids the deadlock that would occur if
    // on_connect were awaited *before* entering the loop.
    let on_connect_fut = super::on_connect(user_session.user_id, &db, &streams, depot);
    tokio::pin!(on_connect_fut);
    let mut on_connect_done = false;

    loop {
        tokio::select! {
            result = &mut on_connect_fut, if !on_connect_done => {
                on_connect_done = true;
                match result {
                    Ok(()) => {
                        tracing::info!(
                            user_session.user_id,
                            user_session.id,
                            connection_id,
                            "User successfully connected via WebTransport"
                        );
                    }
                    Err(err) => {
                        tracing::error!(user_session.user_id, connection_id, error = %err, "on_connect failed");
                        streams.unregister(user_session.user_id, Some(connection_id), None);
                        return Ok(StatusCode::INTERNAL_SERVER_ERROR);
                    }
                }
            }
            // Handle stream requests
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(ConnectionCommand::OpenBidiStream { response }) => {
                        let result = match wt_session.open_bi(session_id).await {
                            Ok(stream) => {
                                let (send, recv): (WtSend, WtRecv) = BidiStream::split(stream);
                                Ok((send, recv))
                            }
                            Err(e) => {
                                tracing::warn!(user_session.user_id, connection_id, error = %e, "Stream open failed");
                                Err(StreamManagerError::ConnectionClosed {
                                    user_id: user_session.user_id,
                                    reason: format!("stream open failed: {}", e),
                                })
                            }
                        };
                        let _ = response.send(result);
                    }
                    Some(ConnectionCommand::OpenUniStream { response }) => {
                        let result = match wt_session.open_uni(session_id).await {
                            Ok(stream) => Ok(stream),
                            Err(e) => {
                                tracing::warn!(user_session.user_id, connection_id, error = %e, "Uni stream open failed");
                                Err(StreamManagerError::ConnectionClosed {
                                    user_id: user_session.user_id,
                                    reason: format!("uni stream open failed: {}", e),
                                })
                            }
                        };
                        let _ = response.send(result);
                    }
                    None => {
                        tracing::debug!(user_session.user_id, connection_id, "Channel closed");
                        break;
                    }
                    Some(ConnectionCommand::Displace) => {
                        if let Err(e) = ctrl.send(CtrlMessage::Displaced).await {
                            tracing::debug!(error = %e, "failed to send Displaced on ctrl stream");
                        }
                        tracing::debug!(
                            user_session.user_id,
                            connection_id,
                            "Connection displaced by newer session"
                        );
                        tokio::time::sleep(Duration::from_millis(50)).await; // Give the message a moment to be processed by the client
                        break;
                    }
                }
            }
            // Drive the h3 connection to detect closure.
            //
            // accept_bi() polls the underlying h3 server::Connection, which in
            // turn calls poll_control → poll_connection_error.  That is the
            // *only* code path that discovers QUIC errors surfaced by quinn and
            // stores them in SharedState.  open_bi/open_uni bypass h3 entirely
            // (they use the raw opener), so without this arm the connection
            // handler would never learn about a peer disconnect.
            accepted = wt_session.accept_bi() => {
                match accepted {
                    Ok(Some(_)) => {
                        // Client-initiated bidi stream – unexpected in our
                        // protocol; just ignore and keep looping.
                        tracing::debug!(
                            user_session.user_id,
                            connection_id,
                            "Ignoring unexpected client-initiated bidi stream"
                        );
                    }
                    Ok(None) => {
                        tracing::debug!(
                            user_session.user_id,
                            connection_id,
                            "WebTransport connection closed gracefully"
                        );
                        break;
                    }
                    Err(err) => {
                        tracing::debug!(
                            user_session.user_id,
                            connection_id,
                            error = %err,
                            "WebTransport connection closed by peer"
                        );
                        break;
                    }
                }
            }
        }
    }

    streams.unregister(user_session.user_id, Some(connection_id), None);
    tracing::debug!(
        user_session.user_id,
        connection_id,
        "WebTransport session ended"
    );
    Ok(StatusCode::OK)
}

#[endpoint]
pub async fn bind_pending_stream(
    depot: &mut Depot,
    json: JsonBody<PendingConnectionKey>,
) -> JsonResult<()> {
    let session = depot.session();
    let streams = depot.stream_manager();

    let key = json.into_inner();
    let sender = streams
        .pending_connections
        .remove(&key)
        .ok_or(StreamApiError::InvalidPendingStreamKey)?
        .1;

    // Send the authenticated session back to the connection handler.
    // Can fail if the handler already dropped the receiver, e.g. timed out.
    sender
        .send(session.to_owned())
        .map_err(|_| StreamApiError::InvalidPendingStreamKey)?;

    json_ok(())
}

pub trait StreamManagerDepotExt {
    fn stream_manager(&self) -> &Arc<StreamManager>;
}

impl StreamManagerDepotExt for Depot {
    fn stream_manager(&self) -> &Arc<StreamManager> {
        self.obtain().expect("StreamManager not found in depot. Make sure to inject it in the router with affix_state::inject")
    }
}
