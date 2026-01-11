//! WebTransport Stream Manager
//!
//! This module manages WebTransport connections for authenticated users, providing
//! a centralized registry that allows server-side components to open streams on
//! client connections.
//!
//! # Architecture Overview
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                              Server                                         │
//! │  ┌─────────────┐    ┌─────────────────────────┐    ┌──────────────────────┐ │
//! │  │ ChatManager │───▶│      StreamManager      │◀───│    GameManager       │ │
//! │  └─────────────┘    │    (Global Singleton)   │    └──────────────────────┘ │
//! │                     │                         │                             │
//! │                     │  ┌───────────────────┐  │                             │
//! │                     │  │ user_id -> Entry  │  │                             │
//! │                     │  │  • Command Sender │  │                             │
//! │                     │  │  • Connection ID  │  │                             │
//! │                     │  └───────────────────┘  │                             │
//! │                     └───────────┬─────────────┘                             │
//! │                                 │ mpsc channel                              │
//! │                                 ▼                                           │
//! │                     ┌─────────────────────────┐                             │
//! │                     │   Connection Handler    │                             │
//! │                     │   (per-user task)       │                             │
//! │                     │                         │                             │
//! │                     │  • Heartbeat stream     │                             │
//! │                     │  • Command receiver     │                             │
//! │                     └───────────┬─────────────┘                             │
//! │                                 │                                           │
//! └─────────────────────────────────┼───────────────────────────────────────────┘
//!                                   │ WebTransport/QUIC
//!                                   ▼
//!                           ┌───────────────┐
//!                           │    Client     │
//!                           └───────────────┘
//! ```
//!
//! # Design Principles
//!
//! ## Server-Initiated Streams Only
//!
//! Clients cannot initiate streams directly on their WebTransport connection.
//! Instead, they use the REST API to request actions (join chat, start game, etc.),
//! and the corresponding server-side manager opens streams as needed. This design:
//!
//! - Simplifies protocol handling (no need to identify stream purposes from client)
//! - Provides natural rate limiting through REST API
//! - Ensures proper authentication before any stream is opened
//! - Allows the server to control resource allocation
//!
//! ## Single Connection Per User
//!
//! Each user can have only one active WebTransport connection at a time. When a
//! user connects from a new device or browser tab:
//!
//! 1. The new connection registers with the manager
//! 2. The old connection's command channel sender is dropped
//! 3. The old handler's `cmd_rx.recv()` returns `None`, causing it to exit cleanly
//! 4. The new connection takes over
//!
//! This prevents resource exhaustion and simplifies state management.
//!
//! ## Connection ID for Safe Cleanup
//!
//! Each connection is assigned a unique, monotonically increasing `connection_id`.
//! This solves a race condition:
//!
//! ```text
//! Time ──────────────────────────────────────────────────────────▶
//!
//! Connection A (id=1):  [register]─────────[exit]─[unregister(id=1)]
//!                                              │
//! Connection B (id=2):              [register]─┼───────────────────▶
//!                                              │
//!                                     Would remove B without ID check!
//! ```
//!
//! Without the ID check, connection A's cleanup would remove connection B from
//! the registry. With the ID check, `unregister(user_id, Some(1))` sees that the
//! current entry has `id=2` and does nothing.
//!
//! External components can use `unregister(user_id, None)` to force-disconnect
//! a user regardless of connection ID (e.g., on logout or ban).
//!
//! ## Heartbeat Stream for Connection Detection
//!
//! The handler opens a bidirectional stream immediately upon connection that serves
//! as a "heartbeat". Neither side sends data on it. The handler reads from it, and
//! when the read returns (EOF or error), it knows the connection has closed.
//!
//! This is necessary because the command channel alone cannot detect when the
//! underlying QUIC connection dies - we need an active read on a stream to get
//! that notification.
//!
//! ## Stream Lifetime and Ownership
//!
//! **Important architectural note:** Streams returned by [`StreamManager::request_stream`]
//! are owned by the caller, but their underlying transport is tied to the QUIC session
//! held by the connection handler.
//!
//! When the handler exits (and thus drops the WebTransport session):
//! - All streams opened on that session will error on subsequent read/write operations
//! - The stream handles (`WtSend`, `WtRecv`) remain valid Rust objects but are unusable
//! - Callers should handle stream errors gracefully and treat them as disconnection
//!
//! This means that components holding streams (e.g., chat rooms with member streams)
//! will receive errors when the user disconnects, even if the component doesn't
//! explicitly know about the disconnection. This is the desired behavior - it allows
//! clean error propagation without requiring explicit cleanup coordination.
//!
//! # Error Handling
//!
//! The API uses only two error variants for simplicity:
//!
//! - [`StreamManagerError::UserNotConnected`]: The user has no active connection.
//!   The caller should handle this gracefully (e.g., return an HTTP error to the
//!   REST request that triggered the stream request).
//!
//! - [`StreamManagerError::ConnectionClosed`]: The connection existed but is now
//!   dead. The manager automatically cleans up the connection entry. The caller
//!   should treat this the same as `UserNotConnected` for retry purposes.
//!
//! # Usage Example
//!
//! ```ignore
//! // In a chat manager, when a user joins a room:
//! async fn handle_join_room(user_id: i32, room_id: i32) -> Result<()> {
//!     let manager = StreamManager::global();
//!
//!     // Request a typed stream for this user
//!     let (send, recv) = manager.request_stream::<ServerMsg, ClientMsg>(user_id).await?;
//!
//!     // Use futures::SinkExt and StreamExt to send/receive
//!     send.send(ServerMsg::Welcome).await?;
//!
//!     // ... handle chat messages ...
//!     Ok(())
//! }
//! ```
//!
//! # Thread Safety
//!
//! The [`StreamManager`] uses [`DashMap`] for concurrent access and is
//! safe to use from multiple tasks simultaneously. The global singleton is
//! initialized lazily on first access.

use std::ops::Deref;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::Context;
use bytes::Bytes;
use dashmap::DashMap;
use futures::SinkExt as _;
use salvo::http::Method;
use salvo::proto::quic::BidiStream;
use salvo::routing::MethodFilter;
use serde::de::DeserializeOwned;
use thiserror::Error;
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, oneshot};
use tokio::task::AbortHandle;
use tokio_util::codec::{FramedRead, FramedWrite};

use super::StreamType;
use super::compress_cbor_codec::{
    CodecBufferParams, CompressedCborDecoder, CompressedCborEncoder,
};
use crate::models::Session;
use crate::prelude::*;
use crate::utils::adaptive_buffer::{BufferParams, DefaultBufferParams};

pub fn router(path: impl Into<String>) -> Router {
    Router::with_path(path)
        .requires_user_login()
        .oapi_tag("stream")
        .push(
            Router::with_path("bind")
                .user_rate_limit(&RateLimit::per_15_minutes(30))
                .post(bind_pending_stream),
        )
}

pub fn webtransport_router(path: impl Into<String>) -> Router {
    Router::with_path(path)
        .hoop(crate::utils::logger::Logger)
        .ip_rate_limit(&RateLimit::per_5_minutes(20))
        .filter(MethodFilter::new(Method::CONNECT))
        .goal(crate::stream::connect_stream)
}

/// Timeout for stream operations.
///
/// If a stream request doesn't receive a response within this duration,
/// the connection is considered dead and will be cleaned up.
const STREAM_TIMEOUT: Duration = Duration::from_secs(10);
/// 8 MiB packet limit for stream frames.
const MAX_STREAM_FRAME_SIZE: usize = 8 * 1024 * 1024;

/// Send half of a WebTransport bidirectional stream (raw, unframed).
type WtSend =
    salvo::webtransport::stream::SendStream<h3_quinn::SendStream<Bytes>, Bytes>;

/// Receive half of a WebTransport bidirectional stream (raw, unframed).
type WtRecv =
    salvo::webtransport::stream::RecvStream<h3_quinn::RecvStream, Bytes>;

/// A sink for sending typed messages to a client.
///
/// Use with [`futures::SinkExt`] to send messages:
/// ```ignore
/// use futures::SinkExt;
/// sender.send(MyMessage { ... }).await?;
/// ```
pub type Sender<S, BP = CodecBufferParams> =
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
}

/// Entry in the connection registry, containing the channel and a unique connection ID.
struct ConnectionEntry {
    unregister_task: AbortHandle,
    tx: mpsc::Sender<ConnectionCommand>,
    connection_id: u64,
    session_id: i32,
}

impl ConnectionEntry {
    fn new(
        session: &Session,
        connection_id: u64,
        tx: mpsc::Sender<ConnectionCommand>,
    ) -> Self {
        Self {
            tx,
            connection_id,
            session_id: session.id,
            unregister_task: Self::new_unregister_task(session, connection_id),
        }
    }

    fn refresh_auth(&mut self, session: &Session) {
        if session.id != self.session_id {
            return;
        }
        self.unregister_task.abort();
        self.unregister_task =
            Self::new_unregister_task(session, self.connection_id);
    }

    fn new_unregister_task(
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
            StreamManager::global().unregister(
                user_id,
                Some(connection_id),
                None,
            );
        })
        .abort_handle()
    }
}

impl Drop for ConnectionEntry {
    fn drop(&mut self) {
        self.unregister_task.abort();
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema,
)]
pub struct RandomNonce([u8; 32]);

impl RandomNonce {
    pub fn new() -> Self {
        RandomNonce(rand::random())
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema,
)]
pub struct PendingConnectionKey {
    connection_id: u64,
    challenge: RandomNonce,
}

impl PendingConnectionKey {
    pub fn new(connection_id: u64) -> Self {
        Self {
            connection_id,
            challenge: RandomNonce::new(),
        }
    }
}

struct PendingConnectionGuard(PendingConnectionKey);

impl Deref for PendingConnectionGuard {
    type Target = PendingConnectionKey;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for PendingConnectionGuard {
    fn drop(&mut self) {
        StreamManager::global().pending_connections.remove(&self.0);
    }
}

/// Global manager for WebTransport client connections.
///
/// Maintains a registry of connected users and their command channels,
/// allowing external components to request new streams.
pub struct StreamManager {
    /// Registry mapping pending connection keys to their session senders.
    pending_connections: DashMap<
        PendingConnectionKey,
        oneshot::Sender<Session>,
        ahash::RandomState,
    >,
    /// Registry mapping user IDs to their connection entries.
    connections: DashMap<i32, ConnectionEntry, ahash::RandomState>,
    /// Counter for generating unique connection IDs.
    connection_id_counter: AtomicU64,
}

impl StreamManager {
    /// DO NOT USE THIS
    /// INSTEAD USE StreamManager::global()
    fn new() -> Self {
        Self {
            pending_connections: DashMap::default(),
            connections: DashMap::default(),
            connection_id_counter: AtomicU64::new(0),
        }
    }

    /// Get the global StreamManager instance.
    pub fn global() -> &'static Self {
        static INSTANCE: LazyLock<StreamManager> =
            LazyLock::new(StreamManager::new);
        &INSTANCE
    }

    /// Returns whether the given user is connected
    pub fn is_connected(&self, user_id: i32) -> bool {
        self.connections.contains_key(&user_id)
    }

    /// This reauthenticates the stream associated to this session (if any)
    pub fn refresh_auth(&self, session: &Session) {
        self.connections
            .entry(session.user_id)
            .and_modify(|c| c.refresh_auth(session));
    }

    fn register_pending(
        &self,
    ) -> (oneshot::Receiver<Session>, PendingConnectionGuard) {
        let connection_id =
            self.connection_id_counter.fetch_add(1, Ordering::Relaxed);
        let key = PendingConnectionKey::new(connection_id);
        let (tx, rx) = oneshot::channel();
        self.pending_connections.insert(key, tx);
        (rx, PendingConnectionGuard(key))
    }

    /// Register a user's WebTransport connection command channel.
    ///
    /// Returns a unique connection ID that must be passed to `unregister` later.
    /// If the user already has a connection, the old sender is dropped,
    /// causing the old handler's `rx.recv()` to return `None` and exit.
    fn register(
        &self,
        session: &Session,
        tx: mpsc::Sender<ConnectionCommand>,
    ) -> u64 {
        let connection_id =
            self.connection_id_counter.fetch_add(1, Ordering::Relaxed);
        let unregister_at = session.access_expiry();
        let user_id = session.user_id;
        let unregister_task = tokio::spawn(async move {
            let until_unregister = unregister_at
                .signed_duration_since(chrono::Utc::now())
                .to_std()
                .unwrap_or_default();
            tokio::time::sleep(until_unregister).await;
            StreamManager::global().unregister(
                user_id,
                Some(connection_id),
                None,
            );
        })
        .abort_handle();
        self.connections.insert(
            user_id,
            ConnectionEntry {
                tx,
                session_id: session.id,
                connection_id,
                unregister_task,
            },
        );
        tracing::info!(
            user_id,
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
        self.connections
            .remove_if(&user_id, |_, entry| {
                let matches = match connection_id {
                    Some(id) => entry.connection_id == id,
                    None => true,
                } && match session_id {
                    Some(sid) => entry.session_id == sid,
                    None => true,
                };
                if matches {
                    tracing::info!(
                        user_id,
                        connection_id = entry.connection_id,
                        "Unregistered connection"
                    );
                }
                matches
            })
            .is_some()
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
    ) -> Result<((WtSend, WtRecv), u64)> {
        let entry = self
            .connections
            .get(&user_id)
            .ok_or(StreamManagerError::UserNotConnected { user_id })?;
        let tx = entry.tx.clone();
        let connection_id = entry.connection_id;
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
            Ok(Ok(result)) => result.map(|stream| (stream, connection_id)),
            Ok(Err(_)) | Err(_) => {
                self.unregister(user_id, Some(connection_id), None);
                Err(StreamManagerError::ConnectionClosed {
                    user_id,
                    reason: "handler unresponsive or crashed".into(),
                })
            }
        }
    }

    /// Request a new bidirectional stream for typed message passing.
    ///
    /// This is the primary API for server-side components to communicate with clients.
    /// The returned stream halves use CBOR serialization with optional Zstd compression,
    /// using default codec parameters.
    ///
    /// # Type Parameters
    ///
    /// - `S`: The type to send (must implement [`Serialize`])
    /// - `R`: The type to receive (must implement [`DeserializeOwned`])
    ///
    /// # Example
    ///
    /// ```ignore
    /// use futures::{SinkExt, StreamExt};
    ///
    /// let (mut send, mut recv) = manager
    ///     .request_stream::<ServerMsg, ClientMsg>(user_id)
    ///     .await?;
    ///
    /// // Send a message
    /// send.send(ServerMsg::Welcome { user_id }).await?;
    ///
    /// // Receive a message
    /// if let Some(msg) = recv.next().await {
    ///     handle_message(msg?);
    /// }
    /// ```
    ///
    /// # Errors
    ///
    /// - [`StreamManagerError::UserNotConnected`]: No active session for this user
    /// - [`StreamManagerError::ConnectionClosed`]: Connection died (auto-cleaned up)
    pub async fn request_stream<S, R>(
        &self,
        user_id: i32,
        r#type: StreamType,
    ) -> Result<(Sender<S>, Receiver<R>)>
    where
        S: Serialize,
        R: DeserializeOwned,
    {
        self.request_custom_stream::<S, R, CodecBufferParams, MAX_STREAM_FRAME_SIZE>(
            user_id,
            r#type,
        )
        .await
    }

    /// Request a new bidirectional stream with custom codec parameters.
    ///
    /// This is an advanced API for cases where you need to customize the codec
    /// buffer behavior or maximum frame size. For most use cases, prefer
    /// [`request_stream`](Self::request_stream) which uses sensible defaults.
    ///
    /// # Type Parameters
    ///
    /// - `S`: The type to send (must implement [`Serialize`])
    /// - `R`: The type to receive (must implement [`DeserializeOwned`])
    /// - `BP`: Buffer parameters for the encoder (implements [`BufferParams`])
    /// - `MAX_FRAME`: Maximum allowed receive frame size in bytes
    ///
    /// # Errors
    ///
    /// - [`StreamManagerError::UserNotConnected`]: No active session for this user
    /// - [`StreamManagerError::ConnectionClosed`]: Connection died (auto-cleaned up)
    pub async fn request_custom_stream<S, R, BP, const MAX_FRAME: usize>(
        &self,
        user_id: i32,
        r#type: StreamType,
    ) -> Result<(Sender<S, BP>, Receiver<R, MAX_FRAME>)>
    where
        S: Serialize,
        R: DeserializeOwned,
        BP: BufferParams,
    {
        let ((send, recv), connection_id) =
            self.request_unframed_stream(user_id).await?;

        frame_stream::<S, R, BP, MAX_FRAME>(send, recv, r#type)
            .await
            .map_err(|e| {
                self.unregister(user_id, Some(connection_id), None);
                StreamManagerError::ConnectionClosed {
                    user_id,
                    reason: format!("failed to frame stream: {e}"),
                }
            })
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
    let mut sender =
        FramedWrite::new(tx, CompressedCborEncoder::<_, BP>::new());
    sender
        .send(r#type.clone())
        .await
        .with_context(|| format!("failed to send stream type: {:?}", r#type))?;
    sender.flush().await.with_context(|| {
        format!("failed to flush stream type: {:?}", r#type)
    })?;
    let sender = sender.map_encoder(|_| CompressedCborEncoder::new());
    let receiver = FramedRead::new(rx, CompressedCborDecoder::new());

    Ok((sender, receiver))
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
/// 2. Server opens a heartbeat stream for connection liveness detection
/// 3. Server registers the connection in [`StreamManager`]
/// 4. Server-side components can request streams via [`StreamManager::request_stream`]
/// 5. Connection ends when client disconnects or heartbeat fails
///
/// # Single Connection Policy
///
/// Each user can have only one active WebTransport connection. Connecting from a new
/// device or tab will automatically disconnect the previous connection.
#[endpoint]
pub async fn connect_stream(
    req: &mut Request,
) -> std::result::Result<(), salvo::Error> {
    let wt_session = req.web_transport_mut().await.unwrap();
    let session_id = wt_session.session_id();

    // Register this connection (replaces any existing connection for this user)
    let manager = StreamManager::global();
    let (session_rx, pending_key) = manager.register_pending();

    // Open control stream with initial message
    let (control_tx, control_rx) = {
        let (tx, rx) = BidiStream::split(wt_session.open_bi(session_id).await?);
        frame_stream::<(), (), DefaultBufferParams, 256>(
            tx,
            rx,
            StreamType::Ctrl(*pending_key),
        )
        .await
        .context("pending connection")?
    };
    // drop control stream, for now we have no use for it other than the initial message
    drop(control_rx);
    drop(control_tx);

    let user_session =
        tokio::time::timeout(Duration::from_secs(10), session_rx)
            .await
            .context("pending connection timeout while waiting for bind/auth")?
            .context(
                "pending connection was dropped while waiting for bind/auth",
            )?;
    // no cleanup necessary anymore ->
    // receiving this session means the pending entry was used
    std::mem::forget(pending_key);

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<ConnectionCommand>(16);
    let connection_id = manager.register(&user_session, cmd_tx);

    tracing::info!(
        user_session.user_id,
        user_session.id,
        connection_id,
        "User successfully connected via WebTransport"
    );
    // TODO check whether connection closure leads to handler panic
    // if not, how do we detect whether the connection is closed? (-> reimpl heartbeat stream idea)
    loop {
        tokio::select! {
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
                    None => {
                        tracing::info!(user_session.user_id, connection_id, "Channel closed");
                        break;
                    }
                }
            }
        }
    }

    manager.unregister(user_session.user_id, Some(connection_id), None);
    tracing::info!(
        user_session.user_id,
        connection_id,
        "WebTransport session ended"
    );
    Ok(())
}

#[endpoint]
pub async fn bind_pending_stream(
    depot: &mut Depot,
    json: JsonBody<PendingConnectionKey>,
) -> JsonResult<()> {
    let session = depot.session();

    let key = json.into_inner();
    let sender = StreamManager::global()
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
