use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::super::cancel::CancelReason;
use super::super::sink::StreamSink;
use super::super::user_stream::{SendError, UserStream, UserStreamProtocol};
use super::super::StreamType;

/// Minimal test protocol that tracks open/close calls.
struct TestProtocol {
    open_count: AtomicUsize,
    close_count: AtomicUsize,
}

impl TestProtocol {
    fn new() -> Self {
        Self {
            open_count: AtomicUsize::new(0),
            close_count: AtomicUsize::new(0),
        }
    }

    fn opens(&self) -> usize {
        self.open_count.load(Ordering::SeqCst)
    }

    fn closes(&self) -> usize {
        self.close_count.load(Ordering::SeqCst)
    }
}

impl UserStreamProtocol for TestProtocol {
    type Send = String;
    type State = ();
    type OpenContext = ();
    type OpenReject = Infallible;

    fn stream_type(&self) -> StreamType {
        StreamType::Test
    }

    fn init_state(&self, _user_id: i32, _context: &()) -> () {}

    async fn on_open(
        &self,
        _user_id: i32,
        _state: &mut (),
        _context: (),
        _sink: &StreamSink<String>,
    ) -> Result<(), Infallible> {
        self.open_count.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn on_close(&self, _user_id: i32, _state: ()) {
        self.close_count.fetch_add(1, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn test_user_stream_open_and_has_stream() {
    let us = UserStream::new_test(TestProtocol::new());

    assert!(!us.has_stream(1), "no stream before open");

    let _ = us.open_stream_test(1, ()).await.unwrap();

    assert!(us.has_stream(1), "stream should be live after open");
    assert_eq!(us.protocol().opens(), 1);
}

#[tokio::test]
async fn test_user_stream_close_removes_entry() {
    let us = UserStream::new_test(TestProtocol::new());

    let _ = us.open_stream_test(1, ()).await.unwrap();
    assert!(us.has_stream(1));

    us.close_stream(1);

    // Yield to let cleanup task run.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    assert!(!us.has_stream(1), "entry should be removed after close");
    assert_eq!(us.protocol().closes(), 1);
}

#[tokio::test]
async fn test_user_stream_cleanup_on_cancel() {
    let us = UserStream::new_test(TestProtocol::new());

    let sink = us.open_stream_test(1, ()).await.unwrap();

    // Cancel the sink to trigger cleanup.
    sink.cancel(CancelReason::TransportError);

    // Yield to let cleanup task process.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    assert!(!us.has_stream(1), "entry should be removed after cancel");
    assert_eq!(us.protocol().closes(), 1, "on_close should have been called");
}

#[tokio::test]
async fn test_user_stream_replace_stream_on_second_open() {
    let us = UserStream::new_test(TestProtocol::new());

    let sink1 = us.open_stream_test(1, ()).await.unwrap();
    let sink2 = us.open_stream_test(1, ()).await.unwrap();

    // sink1 should have been replaced
    assert!(us.has_stream(1));
    assert_ne!(sink1, sink2, "should be different sinks");
    assert_eq!(us.protocol().opens(), 2);
}

#[tokio::test]
async fn test_user_stream_send_to_live_user() {
    let us = UserStream::new_test(TestProtocol::new());

    let _ = us.open_stream_test(1, ()).await.unwrap();

    let result = us.send(1, "hello".to_string()).await;
    assert!(result.is_ok(), "send to live user should succeed");
}

#[tokio::test]
async fn test_user_stream_send_to_offline_user_returns_no_stream() {
    let us = UserStream::new_test(TestProtocol::new());

    let err = us.send(999, "hello".to_string()).await.unwrap_err();
    assert!(
        matches!(err, SendError::NoStream(_)),
        "expected NoStream, got {err:?}"
    );
}

#[tokio::test]
async fn test_user_stream_with_live_returns_none_for_offline() {
    let us = UserStream::new_test(TestProtocol::new());

    let result = us
        .with_live(1, |_sink, _state| async { 42 })
        .await;
    assert!(result.is_none(), "with_live should return None for offline user");
}

#[tokio::test]
async fn test_user_stream_with_live_accesses_sink_and_state() {
    let us = UserStream::new_test(TestProtocol::new());

    let _ = us.open_stream_test(1, ()).await.unwrap();

    let result = us
        .with_live(1, |sink, _state: &mut ()| {
            let cancelled = sink.is_cancelled();
            async move { !cancelled }
        })
        .await;
    assert_eq!(result, Some(true));
}

#[tokio::test]
async fn test_user_stream_with_live_or_else_calls_online_for_live() {
    let us = UserStream::new_test(TestProtocol::new());

    let _ = us.open_stream_test(1, ()).await.unwrap();

    let was_online = us
        .with_live_or_else(
            1,
            |_sink, _state| async { true },
            || async { false },
        )
        .await;
    assert!(was_online, "should have called on_live");
}

#[tokio::test]
async fn test_user_stream_with_live_or_else_calls_offline_for_absent() {
    let us = UserStream::new_test(TestProtocol::new());

    let was_online = us
        .with_live_or_else(
            999,
            |_sink, _state| async { true },
            || async { false },
        )
        .await;
    assert!(!was_online, "should have called on_offline");
}

/// After `with_live_or_else` for an offline user, the ephemeral slot is cleaned up.
#[tokio::test]
async fn test_user_stream_with_live_or_else_cleans_up_ephemeral_slot() {
    let us = UserStream::new_test(TestProtocol::new());

    us.with_live_or_else(
        999,
        |_sink, _state| async { () },
        || async { () },
    )
    .await;

    // The ephemeral slot should have been removed.
    assert!(
        !us.has_slot(999),
        "ephemeral slot should be removed after with_live_or_else"
    );
}

#[tokio::test]
async fn test_user_stream_open_bidi_stream_test() {
    let us = UserStream::new_test(TestProtocol::new());

    let (_sink, _client_sender) = us
        .open_bidi_stream_test(1, (), |_msg: String| async {})
        .await
        .unwrap();

    assert!(us.has_stream(1));
    assert_eq!(us.protocol().opens(), 1);
}
