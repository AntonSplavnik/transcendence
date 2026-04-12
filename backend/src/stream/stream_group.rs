use std::sync::Arc;

use ahash::RandomState;
use futures::StreamExt;
use indexmap::{IndexMap, IndexSet};
use parking_lot::Mutex;
use serde::{Serialize, de::DeserializeOwned};
use tokio::sync::mpsc;

use super::cancel::{CancelHandle, CancelReason};
use super::sink::{DEFAULT_SINK_BUFFER, StreamSink};
use super::{Receiver, StreamManager, StreamType};

struct StreamGroupInner<S: Serialize + Send + 'static> {
    handles: IndexMap<i32, StreamSink<S>, RandomState>,
    pending: IndexSet<i32, RandomState>,
}

impl<S: Serialize + Send + 'static> Default for StreamGroupInner<S> {
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
pub struct StreamGroup<S: Serialize + Send + 'static> {
    inner: Mutex<StreamGroupInner<S>>,
}

impl<S: Serialize + Send + 'static> Default for StreamGroup<S> {
    fn default() -> Self {
        Self {
            inner: Mutex::new(StreamGroupInner::default()),
        }
    }
}

impl<S: Serialize + Send + 'static> Drop for StreamGroup<S> {
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
        for sink in inner.handles.values() {
            sink.cancel(CancelReason::RoomDestroyed);
        }
    }
}

// -- Messaging & query ------------------------------------------------------

impl<S: Clone + Serialize + Send + 'static> StreamGroup<S> {
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
        if let Some(sink) = self.inner.lock().handles.swap_remove(&user_id) {
            sink.cancel(CancelReason::Removed);
            true
        } else {
            false
        }
    }

    /// Broadcast a message to every member in the group.
    ///
    /// Streams whose send buffer is full are cancelled
    /// (the client is too slow to keep up).
    //
    // Safety note: we call `sink.cancel(...)` while holding `inner`. This is
    // sound only because (a) `StreamSink::cancel` is lock-free, and (b) the
    // per-sink cleanup task installed by `insert_sink` waits on `cancelled()`
    // via `tokio::spawn`, so its re-acquisition of `inner` is scheduled, never
    // synchronous. If either of those properties changes, collect the sinks to
    // cancel into a local Vec and release the lock before cancelling.
    pub fn broadcast(&self, msg: &S) {
        let lock = self.inner.lock();
        for (&user_id, sink) in &lock.handles {
            match sink.try_send(msg.clone()) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    tracing::debug!(user_id, "stream buffer full, cancelling");
                    sink.cancel(CancelReason::BackpressureFull);
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    sink.cancel(CancelReason::ChannelClosed);
                }
            }
        }
    }

    /// Send a message to a single user.
    pub fn send(&self, user_id: i32, msg: &S) {
        if let Some(sink) = self.inner.lock().handles.get(&user_id) {
            match sink.try_send(msg.clone()) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    tracing::debug!(user_id, "stream buffer full, cancelling");
                    sink.cancel(CancelReason::BackpressureFull);
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    sink.cancel(CancelReason::ChannelClosed);
                }
            }
        }
    }
}

// -- Internal pending/insert helpers ----------------------------------------

impl<S: Serialize + Send + 'static> StreamGroup<S> {
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
    /// Returns a clone of the sink's [`CancelHandle`] for external observation.
    fn insert_sink(self: &Arc<Self>, user_id: i32, sink: StreamSink<S>) -> CancelHandle {
        let cancel = sink.cancel_handle().clone();
        // `sink_snapshot` must be held by-value (not just a `CancelHandle` clone)
        // for ABA safety: it keeps the sink's inner `Arc` alive so the cleanup
        // task's `existing == sink_snapshot` identity check (via `Arc::ptr_eq`
        // on the cancel-reason slot) cannot alias a freed-then-reused allocation.
        let sink_snapshot = sink.clone();
        {
            let mut lock = self.inner.lock();
            // Check invariants before mutating so an assertion failure cannot
            // leave the map in a partially-updated state.
            assert!(
                lock.pending.contains(&user_id) && !lock.handles.contains_key(&user_id),
                "set_pending must succeed before insert_sink",
            );
            lock.pending.swap_remove(&user_id);
            lock.handles.insert(user_id, sink);
        }

        // Spawn a cleanup task that removes the handle when its cancel handle fires.
        let group = Arc::downgrade(self);
        let cancel_clone = cancel.clone();
        tokio::spawn(async move {
            cancel_clone.cancelled().await;
            if let Some(group) = group.upgrade() {
                let mut lock = group.inner.lock();
                // Only remove if the map still stores *this* sink (not a replacement).
                if let Some((idx, _, existing)) = lock.handles.get_full(&user_id)
                    && *existing == sink_snapshot
                {
                    lock.handles.swap_remove_index(idx);
                }
            }
        });

        cancel
    }
}

// -- Stream creation --------------------------------------------------------

impl<S: Clone + Serialize + Send + 'static> StreamGroup<S> {
    /// Create a stream and spawn a receive loop driven by a **sync** callback.
    ///
    /// `on_message(user_id, msg)` is called for each decoded client message.
    /// Return **`false`** to disconnect the user (e.g. on a `Leave` message).
    ///
    /// The callback runs on a tokio worker thread and must complete quickly
    /// (briefly acquiring a [`parking_lot::Mutex`] is fine).
    ///
    /// Returns the stream's [`CancelHandle`]; cancel it to tear down
    /// the stream externally.
    pub async fn create_stream<R: DeserializeOwned + Send + 'static>(
        self: &Arc<Self>,
        user_id: i32,
        stream_type: StreamType,
        sm: &StreamManager,
        on_message: impl Fn(i32, R) -> bool + Send + Sync + 'static,
    ) -> Result<CancelHandle, anyhow::Error> {
        let (rx, cancel) = self.open_stream::<R>(user_id, stream_type, sm).await?;

        // Type-erase the receiver so Rust Analyzer doesn't need to resolve
        // Stream::Item through the h3/webtransport generic chain.
        let mut rx: std::pin::Pin<
            Box<dyn futures::Stream<Item = Result<R, anyhow::Error>> + Send>,
        > = Box::pin(rx);

        let task_cancel = cancel.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    () = task_cancel.cancelled() => break,
                    item = rx.next() => {
                        match item {
                            Some(Ok(msg)) => {
                                if !on_message(user_id, msg) {
                                    task_cancel.cancel(CancelReason::Removed);
                                    break;
                                }
                            }
                            Some(Err(e)) => {
                                tracing::debug!(user_id, error = %e, "stream decode error");
                                task_cancel.cancel(CancelReason::DecodeError);
                                break;
                            }
                            None => {
                                task_cancel.cancel(CancelReason::StreamEnded);
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(cancel)
    }

    /// Create a stream and return the raw [`Receiver`] for caller-managed
    /// message handling.
    ///
    /// The caller **must** cancel the returned [`CancelHandle`] when
    /// done to ensure cleanup.
    pub async fn open_stream<R: DeserializeOwned + Send + 'static>(
        self: &Arc<Self>,
        user_id: i32,
        stream_type: StreamType,
        sm: &StreamManager,
    ) -> Result<(Receiver<R>, CancelHandle), anyhow::Error> {
        if !self.set_pending(user_id) {
            anyhow::bail!("stream already active or pending for user {user_id}");
        }

        let (sink, rx) = match sm
            .request_stream::<S, R>(user_id, stream_type, DEFAULT_SINK_BUFFER)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                self.unset_pending(user_id);
                return Err(e.into());
            }
        };

        let cancel = self.insert_sink(user_id, sink);
        Ok((rx, cancel))
    }

    /// Create a server → client uni-directional stream (no receive loop).
    pub async fn create_uni_stream(
        self: &Arc<Self>,
        user_id: i32,
        stream_type: StreamType,
        sm: &StreamManager,
    ) -> Result<CancelHandle, anyhow::Error> {
        if !self.set_pending(user_id) {
            anyhow::bail!("stream already active or pending for user {user_id}");
        }

        let sink = match sm
            .request_uni_stream::<S>(user_id, stream_type, DEFAULT_SINK_BUFFER)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                self.unset_pending(user_id);
                return Err(e.into());
            }
        };

        Ok(self.insert_sink(user_id, sink))
    }
}
