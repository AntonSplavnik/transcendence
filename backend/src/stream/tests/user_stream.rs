use std::convert::Infallible;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::super::cancel::CancelReason;
use super::super::sink::StreamSink;
use super::super::user_stream::{UserStream, UserStreamProtocol};
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
