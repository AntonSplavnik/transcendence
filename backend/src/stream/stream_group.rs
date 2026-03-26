use std::sync::Arc;

use ahash::RandomState;
use futures::StreamExt;
use indexmap::{IndexMap, IndexSet};
use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::{Receiver, SharedSender, StreamManager, StreamType};

/// Handle for a group member's stream.
/// Cheap to clone (sender is an mpsc handle, cancellation is a token).
#[derive(Clone)]
pub struct StreamHandle<S: Clone> {
    sender: SharedSender<S>,
    cancellation: CancellationToken,
}

impl<S: Clone> StreamHandle<S> {
    /// The cancellation token governing this stream's lifetime.
    pub fn cancellation(&self) -> &CancellationToken {
        &self.cancellation
    }
}

struct StreamGroupInner<S: Clone> {
    handles: IndexMap<i32, StreamHandle<S>, RandomState>,
    pending: IndexSet<i32, RandomState>,
}

impl<S: Clone> Default for StreamGroupInner<S> {
    fn default() -> Self {
        Self {
            handles: IndexMap::default(),
            pending: IndexSet::default(),
        }
    }
}

/// Atomically manages a set of user streams within a group
/// (game lobby, chat room, etc.).
///
/// Key properties:
/// - **Atomic membership**: prevents duplicate streams per user via a pending set.
/// - **Efficient broadcast**: iterates an [`IndexMap`] (insertion-ordered, cache-friendly).
/// - **Automatic cleanup**: cancelled streams are removed from the map by a background task.
///
/// # API layers
///
/// | Method | Level | Receive loop |
/// |---|---|---|
/// | [`create_stream`](Self::create_stream) | Simple | Spawned internally; sync callback |
/// | [`open_stream`](Self::open_stream) | Advanced | Caller-managed |
pub struct StreamGroup<S: Clone> {
    inner: Mutex<StreamGroupInner<S>>,
}

impl<S: Clone> Default for StreamGroup<S> {
    fn default() -> Self {
        Self {
            inner: Mutex::new(StreamGroupInner::default()),
        }
    }
}

impl<S: Clone> Drop for StreamGroup<S> {
    fn drop(&mut self) {
        // &mut self → exclusive access, no lock needed.
        let inner = self.inner.get_mut();
        let n = inner.handles.len();
        if n > 0 {
            tracing::debug!(
                handles = n,
                "StreamGroup dropped, cancelling all stream handles"
            );
        }
        for handle in inner.handles.values() {
            handle.cancellation.cancel();
        }
    }
}

// -- Messaging & query (no Serialize bound) ---------------------------------

impl<S: Clone + Send + 'static> StreamGroup<S> {
    /// Number of active (non-pending) streams.
    pub fn len(&self) -> usize {
        self.inner.lock().handles.len()
    }

    /// Whether there are no active streams.
    pub fn is_empty(&self) -> bool {
        self.inner.lock().handles.is_empty()
    }

    /// Remove and cancel a user's stream.
    /// Returns `true` if a stream was found and cancelled.
    pub fn destroy_handle(&self, user_id: i32) -> bool {
        if let Some(handle) = self.inner.lock().handles.swap_remove(&user_id) {
            handle.cancellation.cancel();
            true
        } else {
            false
        }
    }

    /// Broadcast a message to every member in the group.
    ///
    /// Streams whose send buffer is full are cancelled
    /// (the client is too slow to keep up).
    pub fn broadcast(&self, msg: &S) {
        let lock = self.inner.lock();
        for (&user_id, handle) in lock.handles.iter() {
            match handle.sender.try_send(msg.clone()) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    tracing::debug!(user_id, "stream buffer full, cancelling");
                    handle.cancellation.cancel();
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    handle.cancellation.cancel();
                }
            }
        }
    }

    /// Send a message to a single user.
    pub fn send(&self, user_id: i32, msg: &S) {
        if let Some(handle) = self.inner.lock().handles.get(&user_id) {
            match handle.sender.try_send(msg.clone()) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    tracing::debug!(user_id, "stream buffer full, cancelling");
                    handle.cancellation.cancel();
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    handle.cancellation.cancel();
                }
            }
        }
    }
}

// -- Internal pending/insert helpers ----------------------------------------

impl<S: Clone + Send + 'static> StreamGroup<S> {
    /// Mark a user as pending. Returns `false` if already active or pending.
    fn set_pending(&self, user_id: i32) -> bool {
        let mut lock = self.inner.lock();
        !lock.handles.contains_key(&user_id) && lock.pending.insert(user_id)
    }

    /// Undo a pending mark (used on stream-creation failure).
    fn unset_pending(&self, user_id: i32) {
        self.inner.lock().pending.swap_remove(&user_id);
    }

    /// Transition from pending → active. Panics if `set_pending` was not called.
    fn insert_handle(self: &Arc<Self>, user_id: i32, handle: StreamHandle<S>) {
        {
            let mut lock = self.inner.lock();
            assert!(
                lock.pending.swap_remove(&user_id)
                    && lock.handles.insert(user_id, handle.clone()).is_none(),
                "set_pending must succeed before insert_handle",
            );
        }

        // Spawn a cleanup task that removes the handle when its token is cancelled.
        let group = Arc::downgrade(self);
        let sender_snapshot = handle.sender.clone();
        tokio::spawn(async move {
            handle.cancellation.cancelled().await;
            if let Some(group) = group.upgrade() {
                let mut lock = group.inner.lock();
                // Only remove if the map still stores *this* handle (not a replacement).
                if let Some((idx, _, existing)) = lock.handles.get_full(&user_id) {
                    if existing.sender == sender_snapshot {
                        lock.handles.swap_remove_index(idx);
                    }
                }
            }
        });
    }
}

// -- Stream creation (requires S: Serialize) --------------------------------

impl<S: Clone + Serialize + Send + 'static> StreamGroup<S> {
    /// Create a stream and spawn a receive loop driven by a **sync** callback.
    ///
    /// `on_message(user_id, msg)` is called for each decoded client message.
    /// Return **`false`** to disconnect the user (e.g. on a `Leave` message).
    ///
    /// The callback runs on a tokio worker thread and must complete quickly
    /// (briefly acquiring a [`parking_lot::Mutex`] is fine).
    ///
    /// Returns the stream's [`CancellationToken`]; cancel it to tear down
    /// the stream externally.
    pub async fn create_stream<R: DeserializeOwned + Send + 'static>(
        self: &Arc<Self>,
        user_id: i32,
        stream_type: StreamType,
        sm: &StreamManager,
        on_message: impl Fn(i32, R) -> bool + Send + Sync + 'static,
    ) -> Result<CancellationToken, anyhow::Error> {
        let (rx, cancel) = self.open_stream::<R>(user_id, stream_type, sm).await?;

        // Type-erase the receiver so Rust Analyzer doesn't need to resolve
        // Stream::Item through the h3/webtransport generic chain.
        let mut rx: std::pin::Pin<
            Box<dyn futures::Stream<Item = Result<R, anyhow::Error>> + Send>,
        > = Box::pin(rx);

        let task_cancel = cancel.clone();
        tokio::spawn(async move {
            task_cancel
                .run_until_cancelled(async move {
                    while let Some(frame) = rx.next().await {
                        match frame {
                            Ok(msg) => {
                                if !on_message(user_id, msg) {
                                    break;
                                }
                            }
                            Err(e) => {
                                tracing::debug!(user_id, error = %e, "stream decode error");
                                break;
                            }
                        }
                    }
                })
                .await;
            // Signal that this stream is done (idempotent if already cancelled).
            task_cancel.cancel();
        });

        Ok(cancel)
    }

    /// Create a stream and return the raw [`Receiver`] for caller-managed
    /// message handling.
    ///
    /// The caller **must** cancel the returned [`CancellationToken`] when
    /// done to ensure cleanup.
    pub async fn open_stream<R: DeserializeOwned>(
        self: &Arc<Self>,
        user_id: i32,
        stream_type: StreamType,
        sm: &StreamManager,
    ) -> Result<(Receiver<R>, CancellationToken), anyhow::Error> {
        if !self.set_pending(user_id) {
            anyhow::bail!("stream already active or pending for user {user_id}");
        }

        let (tx, rx, cancel) = match sm.request_stream::<S, R>(user_id, stream_type).await {
            Ok(v) => v,
            Err(e) => {
                self.unset_pending(user_id);
                return Err(e.into());
            }
        };

        let handle = StreamHandle {
            sender: SharedSender::new(tx),
            cancellation: cancel.clone(),
        };
        self.insert_handle(user_id, handle);

        Ok((rx, cancel))
    }

    /// Create a server → client uni-directional stream (no receive loop).
    pub async fn create_uni_stream(
        self: &Arc<Self>,
        user_id: i32,
        stream_type: StreamType,
        sm: &StreamManager,
    ) -> Result<CancellationToken, anyhow::Error> {
        if !self.set_pending(user_id) {
            anyhow::bail!("stream already active or pending for user {user_id}");
        }

        let (tx, cancel) = match sm.request_uni_stream::<S>(user_id, stream_type).await {
            Ok(v) => v,
            Err(e) => {
                self.unset_pending(user_id);
                return Err(e.into());
            }
        };

        let handle = StreamHandle {
            sender: SharedSender::new(tx),
            cancellation: cancel.clone(),
        };
        self.insert_handle(user_id, handle);

        Ok(cancel)
    }
}
