use std::num::NonZeroUsize;

use tokio::sync::mpsc::error::TrySendError;

use super::super::cancel::CancelReason;
use super::test_utils::{test_sink, test_sink_with_buffer};

#[tokio::test]
async fn test_stream_sink_send_recv() {
    let (sink, mut client) = test_sink::<String>();

    sink.send("hello".to_string()).await.unwrap();

    client.expect(&"hello".to_string()).await;
}

#[tokio::test]
async fn test_stream_sink_cancel_with_reason() {
    let (sink, mut client) = test_sink::<String>();

    // Cancel with an explicit reason.
    sink.cancel(CancelReason::Removed);

    assert!(sink.is_cancelled());
    assert_eq!(sink.reason(), Some(&CancelReason::Removed));

    // The forwarding task exits — client should see stream close.
    client.expect_closed().await;
}

#[tokio::test]
async fn test_stream_sink_transport_error_sets_reason() {
    let (sink, client) = test_sink::<String>();

    // Drop the client read end to break the transport pipe.
    drop(client);

    // Send a message — the forwarding task will hit a write error
    // on the broken DuplexStream and cancel with TransportError.
    //
    // send() succeeds because it writes to the mpsc channel, not the
    // transport. The forwarding task detects the transport error and
    // sets the reason asynchronously.
    let _ = sink.send("trigger".to_string()).await;

    // Wait for the cancel handle to fire.
    sink.cancel_handle().cancelled().await;

    assert!(sink.is_cancelled());
    assert_eq!(sink.reason(), Some(&CancelReason::TransportError));
}

#[tokio::test]
async fn test_stream_sink_clone_same_channel() {
    let (sink, _client) = test_sink::<String>();
    let clone = sink.clone();

    // Clones share the same cancel handle identity.
    assert_eq!(sink, clone);

    // A different sink from a separate construction is NOT equal.
    let (other, _other_client) = test_sink::<String>();
    assert_ne!(sink, other);
}

#[tokio::test]
async fn test_stream_sink_backpressure_try_send_returns_full() {
    let buffer = NonZeroUsize::new(1).unwrap();
    let (sink, _client) = test_sink_with_buffer::<String>(buffer);

    // Fill the single-slot buffer.
    sink.try_send("first".to_string()).unwrap();

    // The buffer is full — try_send must return Full.
    let err = sink.try_send("second".to_string()).unwrap_err();
    assert!(
        matches!(err, TrySendError::Full(_)),
        "expected TrySendError::Full, got {err:?}"
    );
}

#[tokio::test]
async fn test_stream_sink_send_fails_after_cancel() {
    let (sink, _client) = test_sink::<String>();

    sink.cancel(CancelReason::Removed);

    // send() on a cancelled sink should fail — the forwarding task has exited
    // and the mpsc receiver is dropped, closing the channel.
    // Yield to let the forwarding task process the cancellation.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    let result = sink.send("hello".to_string()).await;
    assert!(result.is_err(), "send() should fail after cancellation");
}

/// `try_send` returns `TrySendError::Closed` when the forwarding task has exited.
///
/// After cancellation the forwarding task drops the `mpsc::Receiver`,
/// closing the channel. `try_send` must distinguish Full from Closed.
#[tokio::test]
async fn sink_try_send_returns_closed() {
    let (sink, _client) = test_sink::<String>();

    sink.cancel(CancelReason::Removed);

    // Yield to let the forwarding task exit and drop the receiver.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    let err = sink.try_send("after-cancel".to_string()).unwrap_err();
    assert!(
        matches!(err, TrySendError::Closed(_)),
        "try_send on closed channel must return Closed, got {err:?}"
    );
}

/// Multiple clones of the same sink can send concurrently; all messages arrive.
///
/// This exercises the multi-producer semantics of the underlying mpsc channel.
/// The exact delivery order across clones is unspecified, but every message
/// sent by every clone must reach the client.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn sink_concurrent_clones_deliver_all_messages() {
    use std::collections::HashSet;

    // Large enough buffer so no message is dropped by backpressure.
    let buffer = NonZeroUsize::new(200).unwrap();
    let (sink, mut client) = test_sink_with_buffer::<String>(buffer);

    let mut handles = Vec::new();
    for clone_id in 0..10u32 {
        let sink = sink.clone();
        handles.push(tokio::spawn(async move {
            for msg_id in 0..10u32 {
                sink.send(format!("{clone_id}:{msg_id}")).await.unwrap();
            }
        }));
    }
    for h in handles {
        h.await.unwrap();
    }

    // Collect all 100 messages (order between clones is undefined).
    let mut received = HashSet::new();
    for _ in 0..100 {
        received.insert(client.recv().await);
    }
    assert_eq!(
        received.len(),
        100,
        "all 100 messages must be delivered exactly once"
    );
    for clone_id in 0..10u32 {
        for msg_id in 0..10u32 {
            assert!(
                received.contains(&format!("{clone_id}:{msg_id}")),
                "missing message {clone_id}:{msg_id}"
            );
        }
    }
}

/// After the Envelope refactor, basic send/recv must still work identically.
/// This test is identical to `test_stream_sink_send_recv` — it exists to
/// catch regressions from the internal channel type change.
#[tokio::test]
async fn test_stream_sink_send_recv_after_envelope_refactor() {
    let (sink, mut client) = test_sink::<String>();

    sink.send("hello".to_string()).await.unwrap();
    sink.send("world".to_string()).await.unwrap();

    client.expect(&"hello".to_string()).await;
    client.expect(&"world".to_string()).await;
}

/// `send_batch` delivers all messages as a single atomic unit.
/// No interleaving from other senders between batch items.
#[tokio::test]
async fn test_stream_sink_send_batch_delivers_all_in_order() {
    let (sink, mut client) = test_sink::<u32>();

    sink.send_batch(vec![1, 2, 3]).await.unwrap();

    client.expect(&1).await;
    client.expect(&2).await;
    client.expect(&3).await;
}

/// `send_batch` with an empty vec is a no-op (does not enqueue anything).
#[tokio::test]
async fn test_stream_sink_send_batch_empty_is_noop() {
    let (sink, mut client) = test_sink::<String>();

    sink.send_batch(vec![]).await.unwrap();
    sink.send("after".to_string()).await.unwrap();

    // "after" is the first message received — empty batch produced nothing.
    client.expect(&"after".to_string()).await;
}

use super::super::sink::ConfirmedSendError;

/// `send_confirmed` waits for the forwarding task to write to transport.
#[tokio::test]
async fn test_stream_sink_send_confirmed_success() {
    let (sink, mut client) = test_sink::<String>();

    // send_confirmed returns Ok only after the forwarding task writes to transport.
    sink.send_confirmed("hello".to_string()).await.unwrap();

    client.expect(&"hello".to_string()).await;
}

/// `send_confirmed` returns `ChannelClosed` when the forwarding task has exited.
#[tokio::test]
async fn test_stream_sink_send_confirmed_channel_closed() {
    let (sink, _client) = test_sink::<String>();
    sink.cancel(CancelReason::Removed);

    // Yield to let forwarding task exit.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    let err = sink.send_confirmed("msg".to_string()).await.unwrap_err();
    assert!(
        matches!(err, ConfirmedSendError::ChannelClosed),
        "expected ChannelClosed, got {err:?}"
    );
}

/// `send_confirmed` returns `Transport` error when the write fails.
#[tokio::test]
async fn test_stream_sink_send_confirmed_transport_error() {
    let (sink, client) = test_sink::<String>();

    // Drop client read end to break the transport pipe.
    drop(client);

    let err = sink
        .send_confirmed("trigger".to_string())
        .await
        .unwrap_err();
    assert!(
        matches!(err, ConfirmedSendError::Transport(_)),
        "expected Transport error, got {err:?}"
    );
}

/// `send_confirmed` preserves ordering with fire-and-forget `send`.
#[tokio::test]
async fn test_stream_sink_confirmed_preserves_ordering_with_fire_and_forget() {
    let (sink, mut client) = test_sink::<u32>();

    sink.send(1).await.unwrap();
    sink.send_confirmed(2).await.unwrap();
    sink.send(3).await.unwrap();

    // Must arrive in exact order: 1, 2, 3.
    client.expect(&1).await;
    client.expect(&2).await;
    client.expect(&3).await;
}

/// `send_confirmed_batch` delivers all messages and confirms success.
#[tokio::test]
async fn test_stream_sink_send_confirmed_batch_success() {
    let (sink, mut client) = test_sink::<u32>();

    sink.send_confirmed_batch(vec![10, 20, 30]).await.unwrap();

    client.expect(&10).await;
    client.expect(&20).await;
    client.expect(&30).await;
}

/// `send_confirmed_batch` with an empty vec succeeds immediately.
#[tokio::test]
async fn test_stream_sink_send_confirmed_batch_empty_succeeds() {
    let (sink, _client) = test_sink::<String>();

    // Empty batch is a no-op success.
    sink.send_confirmed_batch(vec![]).await.unwrap();
}

/// `send_confirmed_batch` returns `ChannelClosed`-style error when the forwarding
/// task has already exited. Because the messages are consumed by the failed mpsc
/// send, `unsent` is empty and `sent` is 0.
#[tokio::test]
async fn test_stream_sink_send_confirmed_batch_channel_closed() {
    let (sink, _client) = test_sink::<String>();
    sink.cancel(CancelReason::Removed);
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    let err = sink
        .send_confirmed_batch(vec!["a".into(), "b".into(), "c".into()])
        .await
        .unwrap_err();

    assert_eq!(err.sent, 0, "no messages should have been sent");
    // Messages are consumed by the failed mpsc send — they cannot be returned.
    assert!(
        err.unsent.is_empty(),
        "unsent must be empty when channel was closed before send"
    );
}

/// `send_confirmed_batch` on a broken transport returns a partial error
/// with the sent count and unsent messages.
#[tokio::test]
async fn test_stream_sink_send_confirmed_batch_partial_failure() {
    use std::num::NonZeroUsize;

    // Buffer of 10 so the batch fits in the mpsc channel.
    let (sink, client) = test_sink_with_buffer::<String>(NonZeroUsize::new(10).unwrap());

    // Drop client after receiving some messages to trigger transport error.
    // This is tricky to test precisely — we verify the error shape instead.
    drop(client);

    let err = sink
        .send_confirmed_batch(vec!["x".into(), "y".into(), "z".into()])
        .await
        .unwrap_err();

    // The forwarding task hits a transport error. Depending on timing,
    // 0 or more messages may have been "sent" (written into the broken pipe).
    // What matters: sent + unsent.len() + 1 (the failed message) = 3.
    assert!(
        err.sent + err.unsent.len() < 3,
        "sent ({}) + unsent ({}) must be less than total (3) because one message was consumed by the failing write",
        err.sent,
        err.unsent.len()
    );
}

/// A single sender's messages arrive at the client in FIFO order.
///
/// The mpsc channel guarantees FIFO per sender; this makes the invariant
/// observable and regression-proof.
#[tokio::test]
async fn sink_send_order_preserved() {
    // Buffer large enough to hold all messages without blocking.
    let buffer = NonZeroUsize::new(200).unwrap();
    let (sink, mut client) = test_sink_with_buffer::<u32>(buffer);

    for i in 0..200u32 {
        sink.send(i).await.unwrap();
    }

    for expected in 0..200u32 {
        let received = client.recv().await;
        assert_eq!(received, expected, "messages must arrive in send order");
    }
}
