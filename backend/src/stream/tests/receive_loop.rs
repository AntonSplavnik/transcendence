use super::super::{CancelHandle, CancelReason, spawn_receive_loop};
use super::test_utils::DUPLEX_BUFFER;

#[tokio::test]
async fn test_stream_sink_decode_error_sets_reason() {
    // Use DuplexStream directly with raw bytes to trigger a decode error.
    let (client_write, server_read) = tokio::io::duplex(DUPLEX_BUFFER);
    let server_rx_raw = tokio_util::codec::FramedRead::new(
        server_read,
        super::super::compress_cbor_codec::CompressedCborDecoder::<String>::new(),
    );
    let server_rx_stream =
        futures::StreamExt::map(server_rx_raw, |r| r.map_err(|e| anyhow::anyhow!(e)));

    let token = tokio_util::sync::CancellationToken::new();
    let cancel2 = CancelHandle::new(token);

    let _handle2 = spawn_receive_loop(server_rx_stream, cancel2.clone(), |_msg: String| async {});

    // Write garbage bytes — not valid CBOR framing.
    use tokio::io::AsyncWriteExt;
    let mut writer = client_write;
    writer
        .write_all(&[0xFF, 0xFE, 0xFD, 0xFC, 0x00, 0x00, 0x00, 0x05])
        .await
        .unwrap();
    writer.flush().await.unwrap();

    // Wait for cancel to fire.
    cancel2.cancelled().await;

    assert!(cancel2.is_cancelled());
    assert_eq!(
        cancel2.reason(),
        Some(&CancelReason::DecodeError),
        "decode error should set DecodeError reason"
    );
}

#[tokio::test]
async fn test_stream_sink_stream_ended_sets_reason() {
    let (client_write, server_read) = tokio::io::duplex(DUPLEX_BUFFER);
    let server_rx = tokio_util::codec::FramedRead::new(
        server_read,
        super::super::compress_cbor_codec::CompressedCborDecoder::<String>::new(),
    );
    let server_rx_stream =
        futures::StreamExt::map(server_rx, |r| r.map_err(|e| anyhow::anyhow!(e)));

    let token = tokio_util::sync::CancellationToken::new();
    let cancel = CancelHandle::new(token);

    let _handle = spawn_receive_loop(server_rx_stream, cancel.clone(), |_msg: String| async {});

    // Drop the client write end — stream ends normally (None).
    drop(client_write);

    // Wait for cancel to fire.
    cancel.cancelled().await;

    assert!(cancel.is_cancelled());
    assert_eq!(
        cancel.reason(),
        Some(&CancelReason::StreamEnded),
        "normal stream close should set StreamEnded reason"
    );
}

// ── Happy-path handler invocation ───────────────────────────────────────────

/// The handler must be called when a valid message arrives.
/// This covers the `Some(Ok(msg))` arm — the only arm not exercised above.
#[tokio::test]
async fn receive_loop_handler_called_on_message() {
    use super::super::compress_cbor_codec::{CompressedCborDecoder, CompressedCborEncoder};
    use futures::SinkExt as _;
    use std::time::Duration;
    use tokio_util::codec::{FramedRead, FramedWrite};

    let (client_write, server_read) = tokio::io::duplex(DUPLEX_BUFFER);
    let server_rx = FramedRead::new(server_read, CompressedCborDecoder::<String>::new());
    let server_rx_stream =
        futures::StreamExt::map(server_rx, |r| r.map_err(|e| anyhow::anyhow!(e)));

    let token = tokio_util::sync::CancellationToken::new();
    let cancel = CancelHandle::new(token);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let _handle = spawn_receive_loop(server_rx_stream, cancel.clone(), move |msg: String| {
        let tx = tx.clone();
        async move {
            let _ = tx.send(msg);
        }
    });

    let mut writer = FramedWrite::new(client_write, CompressedCborEncoder::<String>::new());
    writer.send("hello".to_string()).await.unwrap();

    let received = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timed out waiting for handler to be called")
        .expect("handler channel closed");
    assert_eq!(received, "hello");
    assert!(
        !cancel.is_cancelled(),
        "happy path must not cancel the handle"
    );
}

/// 200 sequential messages must all reach the handler in send order.
///
/// The receive loop processes messages one at a time (awaits handler per
/// message) so ordering is guaranteed — this test makes that explicit.
#[tokio::test]
async fn receive_loop_handler_called_200_messages_in_order() {
    use super::super::compress_cbor_codec::{CompressedCborDecoder, CompressedCborEncoder};
    use futures::SinkExt as _;
    use std::time::Duration;
    use tokio_util::codec::{FramedRead, FramedWrite};

    let (client_write, server_read) = tokio::io::duplex(DUPLEX_BUFFER);
    let server_rx = FramedRead::new(server_read, CompressedCborDecoder::<String>::new());
    let server_rx_stream =
        futures::StreamExt::map(server_rx, |r| r.map_err(|e| anyhow::anyhow!(e)));

    let token = tokio_util::sync::CancellationToken::new();
    let cancel = CancelHandle::new(token);

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let _handle = spawn_receive_loop(server_rx_stream, cancel, move |msg: String| {
        let tx = tx.clone();
        async move {
            let _ = tx.send(msg);
        }
    });

    let mut writer = FramedWrite::new(client_write, CompressedCborEncoder::<String>::new());
    for i in 0..200u32 {
        writer.send(format!("msg:{i}")).await.unwrap();
    }
    writer.flush().await.unwrap();

    for i in 0..200u32 {
        let received = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("timed out waiting for handler")
            .expect("handler channel closed");
        assert_eq!(
            received,
            format!("msg:{i}"),
            "handler must receive messages in send order"
        );
    }
}

/// External cancellation (parent token) must not set a stream-level reason.
///
/// When the parent `CancellationToken` is cancelled directly — not through
/// `CancelHandle::cancel()` — `reason()` must be `None`. The cause is above
/// the stream's scope.
#[tokio::test]
async fn receive_loop_external_cancel_produces_no_reason() {
    use super::super::compress_cbor_codec::CompressedCborDecoder;
    use tokio_util::codec::FramedRead;

    let parent = tokio_util::sync::CancellationToken::new();
    let child = parent.child_token();
    let cancel = CancelHandle::new(child);

    let (_client_write, server_read) = tokio::io::duplex(DUPLEX_BUFFER);
    let server_rx = FramedRead::new(server_read, CompressedCborDecoder::<String>::new());
    let server_rx_stream =
        futures::StreamExt::map(server_rx, |r| r.map_err(|e| anyhow::anyhow!(e)));

    let _handle = spawn_receive_loop(server_rx_stream, cancel.clone(), |_: String| async {});

    // Cancel via the parent — no stream-level CancelHandle::cancel() call.
    parent.cancel();
    cancel.cancelled().await;

    assert!(cancel.is_cancelled());
    assert!(
        cancel.reason().is_none(),
        "parent-token cancellation must produce None reason, not a stream-level reason"
    );
}
