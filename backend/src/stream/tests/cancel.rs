use super::super::cancel::{CancelHandle, CancelReason};
use tokio_util::sync::CancellationToken;

#[test]
fn test_cancel_handle_sets_reason() {
    let token = CancellationToken::new();
    let handle = CancelHandle::new(token);

    assert!(!handle.is_cancelled());
    assert!(handle.reason().is_none());

    handle.cancel(CancelReason::BackpressureFull);

    assert!(handle.is_cancelled());
    assert_eq!(handle.reason(), Some(&CancelReason::BackpressureFull));
}

#[test]
fn test_cancel_handle_first_writer_wins() {
    let token = CancellationToken::new();
    let handle = CancelHandle::new(token);

    handle.cancel(CancelReason::BackpressureFull);
    handle.cancel(CancelReason::TransportError);

    // First reason is preserved — OnceLock first-writer-wins.
    assert_eq!(handle.reason(), Some(&CancelReason::BackpressureFull));
}

#[test]
fn test_cancel_handle_external_cancellation_no_reason() {
    let parent = CancellationToken::new();
    let child = parent.child_token();
    let handle = CancelHandle::new(child);

    // Cancel via parent — no stream-level reason set.
    parent.cancel();

    assert!(handle.is_cancelled());
    assert!(
        handle.reason().is_none(),
        "external cancellation must produce None reason"
    );
}

#[test]
fn test_cancel_handle_clone_shares_reason() {
    let token = CancellationToken::new();
    let handle1 = CancelHandle::new(token);
    let handle2 = handle1.clone();

    handle1.cancel(CancelReason::Removed);

    assert!(handle2.is_cancelled());
    assert_eq!(handle2.reason(), Some(&CancelReason::Removed));
}

#[test]
fn test_cancel_handle_eq_same_origin() {
    let token = CancellationToken::new();
    let handle1 = CancelHandle::new(token.clone());
    let handle2 = handle1.clone();
    let handle3 = CancelHandle::new(token);

    // Clones are equal (same Arc).
    assert_eq!(handle1, handle2);
    // Different new() calls are not equal (different Arc).
    assert_ne!(handle1, handle3);
}

#[test]
fn test_cancel_handle_debug_output() {
    let token = CancellationToken::new();
    let handle = CancelHandle::new(token);

    let debug = format!("{handle:?}");
    assert!(debug.contains("cancelled: false"));
    assert!(debug.contains("reason: None"));

    handle.cancel(CancelReason::TransportError);

    let debug = format!("{handle:?}");
    assert!(debug.contains("cancelled: true"));
    assert!(debug.contains("TransportError"));
}

#[test]
fn test_cancel_handle_stream_ended_distinct_from_none() {
    let token = CancellationToken::new();
    let handle = CancelHandle::new(token);

    handle.cancel(CancelReason::StreamEnded);

    // StreamEnded is an explicit reason — distinct from None (external).
    assert_eq!(handle.reason(), Some(&CancelReason::StreamEnded));
    assert!(handle.is_cancelled());
}

#[test]
fn test_cancel_handle_hash_consistent_with_eq() {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    fn hash_of(h: &CancelHandle) -> u64 {
        let mut hasher = DefaultHasher::new();
        h.hash(&mut hasher);
        hasher.finish()
    }

    let token = CancellationToken::new();
    let h1 = CancelHandle::new(token.clone());
    let h2 = h1.clone();
    let h3 = CancelHandle::new(token);

    // Equal handles must have equal hashes.
    assert_eq!(h1, h2);
    assert_eq!(
        hash_of(&h1),
        hash_of(&h2),
        "equal handles must hash equally"
    );

    // Non-equal handles should have different hashes (different Arc pointers).
    assert_ne!(h1, h3);
    assert_ne!(
        hash_of(&h1),
        hash_of(&h3),
        "distinct handles should hash differently"
    );
}

#[test]
fn test_cancel_handle_concurrent_cancel_preserves_first_reason() {
    use std::sync::{Arc, Barrier};

    let token = CancellationToken::new();
    let handle = CancelHandle::new(token);
    let barrier = Arc::new(Barrier::new(2));

    let h1 = handle.clone();
    let b1 = Arc::clone(&barrier);
    let t1 = std::thread::spawn(move || {
        b1.wait();
        h1.cancel(CancelReason::BackpressureFull);
    });

    let h2 = handle.clone();
    let b2 = Arc::clone(&barrier);
    let t2 = std::thread::spawn(move || {
        b2.wait();
        h2.cancel(CancelReason::TransportError);
    });

    t1.join().expect("t1 panicked");
    t2.join().expect("t2 panicked");

    assert!(handle.is_cancelled());
    // Exactly one of the two reasons won — first-writer-wins is stable.
    let reason = handle.reason().expect("reason must be set after cancel");
    assert!(
        *reason == CancelReason::BackpressureFull || *reason == CancelReason::TransportError,
        "reason must be one of the two contenders, got: {reason:?}"
    );
}

/// Every `CancelReason` variant must survive a round-trip through
/// `cancel()` / `reason()`.  Catches the case where a new variant is
/// added without being exercised anywhere in the test suite.
#[test]
fn cancel_handle_all_cancel_reasons_round_trip() {
    use tokio_util::sync::CancellationToken;

    let all_reasons = [
        CancelReason::BackpressureFull,
        CancelReason::ChannelClosed,
        CancelReason::DecodeError,
        CancelReason::Removed,
        CancelReason::RoomDestroyed,
        CancelReason::TransportError,
        CancelReason::StreamEnded,
        CancelReason::SenderDropped,
    ];

    for reason in &all_reasons {
        let token = CancellationToken::new();
        let handle = CancelHandle::new(token);
        handle.cancel(reason.clone());
        assert_eq!(
            handle.reason(),
            Some(reason),
            "reason {reason:?} did not round-trip through cancel()/reason()"
        );
        assert!(
            handle.is_cancelled(),
            "handle must be cancelled after cancel({reason:?})"
        );
    }
}

/// With 100 threads all racing to call `cancel()` simultaneously, exactly
/// one reason must win and the handle must be fully cancelled.
///
/// This stresses both the `OnceLock` (reason storage) and the
/// `CancellationToken` (cancellation signal) under high contention.
#[test]
fn cancel_handle_100_thread_contention_first_writer_wins() {
    use std::sync::{Arc, Barrier};

    let token = tokio_util::sync::CancellationToken::new();
    let handle = CancelHandle::new(token);
    let barrier = Arc::new(Barrier::new(100));

    let competing_reasons = [
        CancelReason::BackpressureFull,
        CancelReason::ChannelClosed,
        CancelReason::DecodeError,
        CancelReason::Removed,
        CancelReason::RoomDestroyed,
        CancelReason::TransportError,
        CancelReason::StreamEnded,
    ];

    let mut threads = Vec::new();
    for i in 0..100usize {
        let h = handle.clone();
        let b = Arc::clone(&barrier);
        let reason = competing_reasons[i % competing_reasons.len()].clone();
        threads.push(std::thread::spawn(move || {
            b.wait(); // all threads start simultaneously
            h.cancel(reason);
        }));
    }
    for t in threads {
        t.join().expect("thread panicked");
    }

    assert!(
        handle.is_cancelled(),
        "handle must be cancelled after 100 threads race"
    );
    let winner = handle.reason().expect("exactly one reason must be set");
    assert!(
        competing_reasons.contains(winner),
        "winning reason must be one of the competing reasons, got {winner:?}"
    );
}
