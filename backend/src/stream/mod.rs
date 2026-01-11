//! WebTransport Stream Management
//!
//! This module provides infrastructure for real-time bidirectional communication
//! with clients over WebTransport/QUIC. It centers around the [`StreamManager`],
//! a global registry that manages WebTransport connections for authenticated users.
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
//! # Key Concepts
//!
//! 1. **Server-Initiated Streams**: Clients don't open streams directly. Instead,
//!    they use REST APIs to request actions (join chat, start game, etc.), and the
//!    server opens streams as needed via [`StreamManager::request_stream`].
//!
//! 2. **Single Connection Per User**: Each user can have only one active WebTransport
//!    connection. New connections automatically replace old ones.
//!
//! 3. **Typed Message Passing**: Streams use CBOR serialization with optional Zstd
//!    compression for efficient, type-safe communication.
//!
//! # Usage Example
//!
//! ## 1. Define your protocol message types
//!
//! ```ignore
//! use serde::{Serialize, Deserialize};
//!
//! /// Messages sent FROM the server TO the client
//! #[derive(Serialize)]
//! enum ServerMessage {
//!     Welcome { room_id: i32 },
//!     ChatMessage { from: String, content: String },
//!     Error { message: String },
//! }
//!
//! /// Messages sent FROM the client TO the server
//! #[derive(Deserialize)]
//! enum ClientMessage {
//!     SendChat { content: String },
//!     Typing,
//!     Leave,
//! }
//! ```
//!
//! ## 2. Request a stream for a user
//!
//! ```ignore
//! use crate::stream::*;
//!
//! async fn handle_join_room(user_id: i32, room_id: i32) -> Result<(), StreamManagerError> {
//!     let manager = StreamManager::global();
//!
//!     // Request a typed bidirectional stream
//!     let (mut sender, mut receiver) = manager
//!         .request_stream::<ServerMessage, ClientMessage>(user_id)
//!         .await?;
//!
//!     // Send a welcome message
//!     sender.send(ServerMessage::Welcome { room_id }).await?;
//!
//!     // Handle incoming messages
//!     while let Some(msg) = receiver.next().await {
//!         match msg? {
//!             ClientMessage::SendChat { content } => {
//!                 // Broadcast to other users...
//!             }
//!             ClientMessage::Leave => break,
//!             _ => {}
//!         }
//!     }
//!
//!     Ok(())
//! }
//! ```
//!
//! ## 3. Handle disconnections gracefully
//!
//! ```ignore
//! async fn send_notification(user_id: i32, message: &str) {
//!     let manager = StreamManager::global();
//!
//!     match manager.request_stream::<ServerMessage, ClientMessage>(user_id).await {
//!         Ok((mut sender, _)) => {
//!             let _ = sender.send(ServerMessage::ChatMessage {
//!                 from: "System".into(),
//!                 content: message.into(),
//!             }).await;
//!         }
//!         Err(StreamManagerError::UserNotConnected { .. }) => {
//!             // User is offline - queue for later or skip
//!         }
//!         Err(StreamManagerError::ConnectionClosed { .. }) => {
//!             // Connection died mid-request
//!         }
//!     }
//! }
//! ```
//!
//! ## 4. Force-disconnect a user
//!
//! ```ignore
//! fn logout_user(user_id: i32) {
//!     // Closes the WebTransport session, all streams will error
//!     StreamManager::global().close_stream(user_id);
//! }
//! ```
//!
//! # Stream Lifecycle
//!
//! - **Creation**: Each `request_stream()` call creates a NEW bidirectional stream
//! - **Ownership**: The `Sender`/`Receiver` are owned by the caller
//! - **Termination**: Streams end when dropped, session closes, or an error occurs
//! - **Connection Replacement**: Old streams error when a new connection replaces them
//!
//! # Error Handling
//!
//! - [`StreamManagerError::UserNotConnected`]: User has no active WebTransport session
//! - [`StreamManagerError::ConnectionClosed`]: Connection died (auto-cleaned up)

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
}
