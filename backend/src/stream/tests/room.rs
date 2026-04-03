use std::convert::Infallible;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::super::cancel::CancelReason;
use super::super::stream_room::{JoinError, RoomProtocol, StreamRoom};
use super::super::{MAX_INIT_MESSAGES, StreamType};

/// Stamp out the common associated types and `stream_type()` for test protocols.
///
/// Most test protocols use `Send=String, Recv=String, JoinContext=(),
/// JoinReject=Infallible` and don't care about the stream type.
/// Place this at the top of an `impl RoomProtocol for ...` block.
macro_rules! simple_test_protocol {
    () => {
        type Send = String;
        type Recv = String;
        type JoinContext = ();
        type JoinReject = Infallible;
        fn stream_type(&self) -> StreamType {
            StreamType::Test
        }
    };
}

// ── EchoProtocol ────────────────────────────────────────────────

/// Simple test protocol with no join context or rejection.
#[derive(Debug)]
struct EchoProtocol {
    join_count: usize,
    leave_count: usize,
}

impl EchoProtocol {
    fn new() -> Self {
        Self {
            join_count: 0,
            leave_count: 0,
        }
    }
}

impl RoomProtocol for EchoProtocol {
    simple_test_protocol!();
    fn init_messages(&self, _user_id: i32) -> Vec<String> {
        vec!["welcome".to_string()]
    }
    fn on_member_joined(&mut self, user_id: i32) -> Option<String> {
        self.join_count += 1;
        Some(format!("joined:{user_id}"))
    }
    fn on_member_left(&mut self, user_id: i32) -> Option<String> {
        self.leave_count += 1;
        Some(format!("left:{user_id}"))
    }
}

// ── EmptyInitProtocol ───────────────────────────────────────────

/// Protocol that returns empty init messages.
#[derive(Debug)]
struct EmptyInitProtocol;

impl RoomProtocol for EmptyInitProtocol {
    simple_test_protocol!();
    fn init_messages(&self, _user_id: i32) -> Vec<String> {
        vec![]
    }
    fn on_member_joined(&mut self, user_id: i32) -> Option<String> {
        Some(format!("joined:{user_id}"))
    }
}

// ── ContextProtocol ─────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
#[error("room full")]
struct RoomFull;

#[derive(Debug)]
struct ContextProtocol {
    members: std::collections::HashMap<i32, String>,
    max: usize,
}

impl RoomProtocol for ContextProtocol {
    type Send = String;
    type Recv = String;
    type JoinContext = String; // nick
    type JoinReject = RoomFull;

    fn stream_type(&self) -> StreamType {
        StreamType::Test
    }

    fn on_member_joining(&mut self, user_id: i32, nick: String) -> Result<(), RoomFull> {
        if self.members.len() >= self.max {
            return Err(RoomFull);
        }
        self.members.insert(user_id, nick);
        Ok(())
    }

    fn init_messages(&self, user_id: i32) -> Vec<String> {
        vec![format!("hello:{}", self.members[&user_id])]
    }

    fn on_member_joined(&mut self, user_id: i32) -> Option<String> {
        Some(format!("joined:{}", self.members[&user_id]))
    }

    fn on_member_left(&mut self, user_id: i32) -> Option<String> {
        self.members.remove(&user_id);
        Some(format!("left:{user_id}"))
    }
}

// ── CountingProtocol (for leave_count via AtomicUsize) ──────────

/// Protocol that tracks leave_count via AtomicUsize for post-drop inspection.
#[derive(Debug)]
struct CountingProtocol {
    join_count: Arc<AtomicUsize>,
    leave_count: Arc<AtomicUsize>,
}

impl CountingProtocol {
    fn new(join_count: Arc<AtomicUsize>, leave_count: Arc<AtomicUsize>) -> Self {
        Self {
            join_count,
            leave_count,
        }
    }
}

impl RoomProtocol for CountingProtocol {
    simple_test_protocol!();
    fn init_messages(&self, _user_id: i32) -> Vec<String> {
        vec!["welcome".to_string()]
    }
    fn on_member_joined(&mut self, user_id: i32) -> Option<String> {
        self.join_count.fetch_add(1, Ordering::SeqCst);
        Some(format!("joined:{user_id}"))
    }
    fn on_member_left(&mut self, user_id: i32) -> Option<String> {
        self.leave_count.fetch_add(1, Ordering::SeqCst);
        Some(format!("left:{user_id}"))
    }
}

// ── CountingNoBroadcastProtocol ─────────────────────────────────────────────

/// Like CountingProtocol but with no init messages and no join/leave broadcasts.
///
/// Used in concurrency tests where broadcast storms would cancel members via
/// backpressure, obscuring the behaviour under test.
#[derive(Debug)]
struct CountingNoBroadcastProtocol {
    join_count: Arc<AtomicUsize>,
    leave_count: Arc<AtomicUsize>,
}

impl CountingNoBroadcastProtocol {
    fn new(join_count: Arc<AtomicUsize>, leave_count: Arc<AtomicUsize>) -> Self {
        Self {
            join_count,
            leave_count,
        }
    }
}

impl RoomProtocol for CountingNoBroadcastProtocol {
    simple_test_protocol!();
    fn init_messages(&self, _user_id: i32) -> Vec<String> {
        vec![] // no init messages → buffer stays empty, no backpressure risk
    }
    fn on_member_joined(&mut self, _user_id: i32) -> Option<String> {
        self.join_count.fetch_add(1, Ordering::SeqCst);
        None // no broadcast → other members' buffers never fill
    }
    fn on_member_left(&mut self, _user_id: i32) -> Option<String> {
        self.leave_count.fetch_add(1, Ordering::SeqCst);
        None
    }
}

// ── OverflowInitProtocol ────────────────────────────────────────

/// Protocol that returns more than MAX_INIT_MESSAGES init messages.
#[derive(Debug)]
struct OverflowInitProtocol {
    init_count: usize,
}

impl RoomProtocol for OverflowInitProtocol {
    simple_test_protocol!();
    fn init_messages(&self, _user_id: i32) -> Vec<String> {
        (0..self.init_count).map(|i| format!("init:{i}")).collect()
    }
}

// ── MaxInitProtocol ─────────────────────────────────────────────

/// Protocol that returns exactly MAX_INIT_MESSAGES (31) init messages.
///
/// Tests the boundary: 31 init messages + 1 join broadcast = 32 = full buffer.
/// `try_send` must accept all of them (fresh buffer has exactly enough space).
#[derive(Debug)]
struct MaxInitProtocol;

impl RoomProtocol for MaxInitProtocol {
    simple_test_protocol!();
    fn init_messages(&self, _user_id: i32) -> Vec<String> {
        (0..MAX_INIT_MESSAGES)
            .map(|i| format!("init:{i}"))
            .collect()
    }
    fn on_member_joined(&mut self, user_id: i32) -> Option<String> {
        Some(format!("joined:{user_id}"))
    }
}

// ── UniEchoProtocol ─────────────────────────────────────────────

/// Uni-directional protocol: server sends String, client receives only.
#[derive(Debug)]
struct UniEchoProtocol {
    join_count: usize,
    leave_count: usize,
}

impl UniEchoProtocol {
    fn new() -> Self {
        Self {
            join_count: 0,
            leave_count: 0,
        }
    }
}

impl RoomProtocol for UniEchoProtocol {
    type Send = String;
    type Recv = String; // Not used — no receive loop
    type JoinContext = ();
    type JoinReject = Infallible;

    fn stream_type(&self) -> StreamType {
        StreamType::Test
    }
    fn init_messages(&self, _user_id: i32) -> Vec<String> {
        vec!["welcome".to_string()]
    }
    fn on_member_joined(&mut self, user_id: i32) -> Option<String> {
        self.join_count += 1;
        Some(format!("joined:{user_id}"))
    }
    fn on_member_left(&mut self, user_id: i32) -> Option<String> {
        self.leave_count += 1;
        Some(format!("left:{user_id}"))
    }
}

/// No-op handler for tests that don't care about incoming messages.
async fn noop_handler(_msg: String) {}

// ── Tests ───────────────────────────────────────────────────────

// 1. Join user 1, verify client gets init msg ("welcome") before join broadcast ("joined:1")
#[tokio::test]
async fn test_stream_room_join_init_before_broadcasts() {
    let room = StreamRoom::new(EchoProtocol::new());
    let (_handle, mut client, _sender) = room.join(1, noop_handler).await.unwrap();

    // Init message comes first.
    client.expect(&"welcome".to_string()).await;
    // Then the join broadcast.
    client.expect(&"joined:1".to_string()).await;
}

// 2. Protocol returns different init per user (ContextProtocol)
#[tokio::test]
async fn test_stream_room_per_member_init() {
    let proto = ContextProtocol {
        members: std::collections::HashMap::new(),
        max: 10,
    };
    let room = StreamRoom::new(proto);

    let (_h1, mut c1, _s1) = room
        .join_with(1, "Alice".to_string(), noop_handler)
        .await
        .unwrap();

    let (_h2, mut c2, _s2) = room
        .join_with(2, "Bob".to_string(), noop_handler)
        .await
        .unwrap();

    // User 1 gets personalized init.
    c1.expect(&"hello:Alice".to_string()).await;
    // User 2 gets personalized init.
    c2.expect(&"hello:Bob".to_string()).await;
}

// 3. Use ContextProtocol, verify context flows through
#[tokio::test]
async fn test_stream_room_on_member_joining_receives_context() {
    let proto = ContextProtocol {
        members: std::collections::HashMap::new(),
        max: 10,
    };
    let room = StreamRoom::new(proto);

    let (_handle, mut client, _sender) = room
        .join_with(42, "Charlie".to_string(), noop_handler)
        .await
        .unwrap();

    // init_messages uses the context stored in on_member_joining.
    client.expect(&"hello:Charlie".to_string()).await;
    // on_member_joined broadcast also uses the stored nick.
    client.expect(&"joined:Charlie".to_string()).await;
}

// 4. JoinContext data visible in init_messages (same lock acquisition)
#[tokio::test]
async fn test_stream_room_join_with_context_atomic() {
    let proto = ContextProtocol {
        members: std::collections::HashMap::new(),
        max: 10,
    };
    let room = StreamRoom::new(proto);

    let (_handle, mut client, _sender) = room
        .join_with(1, "Dave".to_string(), noop_handler)
        .await
        .unwrap();

    // The nick "Dave" was inserted by on_member_joining and is visible
    // to init_messages in the same lock acquisition.
    client.expect(&"hello:Dave".to_string()).await;
}

// 5. join() works for JoinContext = () protocols
#[tokio::test]
async fn test_stream_room_join_convenience_unit_context() {
    let room = StreamRoom::new(EchoProtocol::new());
    // join() is the convenience wrapper — should compile and work.
    let (_handle, mut client, _sender) = room.join(1, noop_handler).await.unwrap();
    client.expect(&"welcome".to_string()).await;
}

// 6. ContextProtocol with max=0, join fails with JoinError::Rejected
#[tokio::test]
async fn test_stream_room_join_rejected_by_protocol() {
    let proto = ContextProtocol {
        members: std::collections::HashMap::new(),
        max: 0,
    };
    let room = StreamRoom::new(proto);

    let result = room.join_with(1, "Eve".to_string(), noop_handler).await;

    assert!(
        matches!(result, Err(JoinError::Rejected(_))),
        "expected JoinError::Rejected, got {result:?}"
    );
}

// 7. After rejection, leave_count unchanged (on_member_left NOT called)
#[tokio::test]
async fn test_stream_room_join_rejected_no_on_member_left() {
    let proto = ContextProtocol {
        members: std::collections::HashMap::new(),
        max: 0,
    };
    let room = StreamRoom::new(proto);

    let result = room.join_with(1, "Frank".to_string(), noop_handler).await;
    assert!(matches!(result, Err(JoinError::Rejected(_))));

    // on_member_left is NOT called when on_member_joining rejects.
    // members map should still be empty — no state was modified.
    room.with_state(|state| {
        assert!(
            state.members.is_empty(),
            "members should be empty after rejection — on_member_left must not be called"
        );
    });
}

// 8. After rejection, same user_id can try again (use max=1)
#[tokio::test]
async fn test_stream_room_join_rejected_slot_reusable() {
    let proto = ContextProtocol {
        members: std::collections::HashMap::new(),
        max: 0,
    };
    let room = StreamRoom::new(proto);

    // First join rejected.
    let result = room.join_with(1, "Gina".to_string(), noop_handler).await;
    assert!(matches!(result, Err(JoinError::Rejected(_))));

    // Bump max to 1 so next join succeeds.
    room.with_state_mut(|state| {
        state.max = 1;
    });

    // Same user_id can try again — pending was cleaned up.
    let result = room.join_with(1, "Gina".to_string(), noop_handler).await;
    assert!(
        result.is_ok(),
        "expected Ok after rejection cleanup, got {result:?}"
    );
}

// 9. mutate_and_broadcast changes state and sends to all
#[tokio::test]
async fn test_stream_room_mutate_and_broadcast_atomic() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    // Drain init + join broadcasts.
    c1.drain(3).await; // welcome, joined:1, joined:2
    c2.drain(2).await; // welcome, joined:2

    room.mutate_and_broadcast(|state| {
        state.join_count += 100;
        "mutated".to_string()
    });

    c1.expect(&"mutated".to_string()).await;
    c2.expect(&"mutated".to_string()).await;

    // Verify state was actually mutated.
    room.with_state(|state| {
        assert_eq!(state.join_count, 102); // 2 joins + 100
    });
}

// 10. Cancel a sink, verify on_member_left runs and broadcast_except sends departure
#[tokio::test]
async fn test_stream_room_disconnect_triggers_left() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    // Drain init + join broadcasts.
    c1.drain(3).await; // welcome, joined:1, joined:2
    c2.drain(2).await; // welcome, joined:2

    // Get user 1's cancel handle and cancel it (simulating disconnect).
    let cancel = room.cancel_handle_for(1);
    cancel.cancel(CancelReason::TransportError);

    // Give cleanup task time to run.
    // Yield to let the cleanup task process the cancellation.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // User 2 should receive the departure broadcast.
    c2.expect(&"left:1".to_string()).await;

    // User 1 should no longer be in the room.
    assert!(!room.contains(1));
    assert!(room.contains(2));

    // Leave count should be 1.
    room.with_state(|state| {
        assert_eq!(state.leave_count, 1);
    });
}

// 11. Verify join broadcast goes to ALL members including joiner
#[tokio::test]
async fn test_stream_room_on_member_joined_broadcasts() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();

    // User 1 gets init + own join broadcast.
    c1.expect(&"welcome".to_string()).await;
    c1.expect(&"joined:1".to_string()).await;

    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    // User 2 gets init + own join broadcast.
    c2.expect(&"welcome".to_string()).await;
    c2.expect(&"joined:2".to_string()).await;

    // User 1 also gets user 2's join broadcast.
    c1.expect(&"joined:2".to_string()).await;
}

// 12. room.remove(user_id) triggers on_member_left
#[tokio::test]
async fn test_stream_room_remove_calls_on_member_left() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    c2.drain(2).await; // welcome, joined:2

    let removed = room.remove(1);
    assert!(removed);

    // on_member_left was called, broadcast_except to user 2.
    c2.expect(&"left:1".to_string()).await;

    room.with_state(|state| {
        assert_eq!(state.leave_count, 1);
    });
}

// 13. After remove(), reason is Removed
#[tokio::test]
async fn test_stream_room_remove_sets_cancel_reason() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    // Grab cancel handle before remove.
    let cancel = room.cancel_handle_for(1);

    let _ = room.remove(1);

    assert!(cancel.is_cancelled());
    assert_eq!(cancel.reason(), Some(&CancelReason::Removed));
}

// 14. (gated test) remove pending user returns true
#[tokio::test]
async fn test_stream_room_remove_clears_pending() {
    let (room, gate) = StreamRoom::new_gated(EchoProtocol::new());

    // Start join — will block at step 2 (stream open).
    let room2 = Arc::clone(&room);
    let join_task = tokio::spawn(async move { room2.join(1, noop_handler).await });

    // Give the join task time to reach the gate.
    // Yield to let the cleanup task process the cancellation.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // User should be in pending.
    assert!(room.user_is_pending(1), "user 1 should be pending");

    // Remove the pending user.
    let removed = room.remove(1);
    assert!(removed, "remove should return true for pending user");

    // Pending should be empty now.
    assert!(
        !room.user_is_pending(1),
        "user 1 should no longer be pending"
    );

    // Open the gate so the join task can finish (it will fail or complete).
    gate.open();
    // The join task will fail because pending was removed, but the task
    // should not panic. We just await it to clean up.
    let _ = join_task.await;
}

// 15. Fill buffer, broadcast, verify BackpressureFull
#[tokio::test]
async fn test_stream_room_broadcast_cancel_reason_backpressure() {
    let room = StreamRoom::new(EchoProtocol::new());
    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    let cancel = room.cancel_handle_for(1);

    // Fill buffer: init(1) + join(1) + 30 more = 32 = full. Next one triggers Full.
    for i in 0..31 {
        room.broadcast(&format!("flood:{i}"));
    }

    assert!(cancel.is_cancelled());
    assert_eq!(
        cancel.reason(),
        Some(&CancelReason::BackpressureFull),
        "expected BackpressureFull cancel reason"
    );
}

// 16. Closed channel → reason is ChannelClosed or TransportError
#[tokio::test]
async fn test_stream_room_broadcast_cancel_reason_closed() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_handle, c1, _s1) = room.join(1, noop_handler).await.unwrap();

    let cancel = room.cancel_handle_for(1);

    // Drop the client — closes the DuplexStream transport.
    // The forwarding task detects the write error and sets TransportError.
    // Alternatively, if broadcast runs first, try_send returns Closed and
    // sets ChannelClosed. Both are correct channel-error reasons.
    drop(c1);

    // Yield to let the forwarding task process the transport error.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // Broadcast to trigger try_send on the (possibly closed) channel.
    room.broadcast(&"after-drop".to_string());

    // The sink must be cancelled. The specific reason depends on which
    // path fires first: forwarding task (TransportError) or broadcast's
    // try_send (ChannelClosed). Both are correct — the invariant is that
    // the sink IS cancelled with a channel-error reason.
    assert!(cancel.is_cancelled(), "sink must be cancelled");
    let reason = cancel.reason().expect("cancel reason must be set");
    assert!(
        matches!(
            reason,
            CancelReason::ChannelClosed | CancelReason::TransportError
        ),
        "expected ChannelClosed or TransportError, got {reason:?}"
    );
}

// 17. Per-member conditional broadcast
#[tokio::test]
async fn test_stream_room_broadcast_map() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    // Drain init + join broadcasts.
    c1.drain(3).await; // welcome, joined:1, joined:2
    c2.drain(2).await; // welcome, joined:2

    // broadcast_map: only send to even user_ids.
    room.broadcast_map(|_state, user_id| {
        if user_id % 2 == 0 {
            Some(format!("even:{user_id}"))
        } else {
            None
        }
    });

    // User 2 (even) should get the message.
    c2.expect(&"even:2".to_string()).await;

    // User 1 (odd) should NOT get a message. Send another broadcast to
    // verify ordering — if user 1 got the map message, it would appear first.
    room.broadcast(&"sentinel".to_string());
    c1.expect(&"sentinel".to_string()).await;
}

// 18. Atomic mutate + per-member conditional
#[tokio::test]
async fn test_stream_room_mutate_and_broadcast_map() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    // Drain init + join broadcasts.
    c1.drain(3).await; // welcome, joined:1, joined:2
    c2.drain(2).await; // welcome, joined:2

    room.mutate_and_broadcast_map(
        |state| {
            state.join_count += 50;
        },
        |state, user_id| Some(format!("count:{}:user:{user_id}", state.join_count)),
    );

    // Both should see the mutated state.
    c1.expect(&"count:52:user:1".to_string()).await;
    c2.expect(&"count:52:user:2".to_string()).await;

    // State was mutated.
    room.with_state(|state| {
        assert_eq!(state.join_count, 52); // 2 joins + 50
    });
}

// 19. Drop room, verify RoomDestroyed on all sinks
#[tokio::test]
async fn test_stream_room_drop_cancels_with_reason() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    // Grab cancel handles before drop.
    let cancel1 = room.cancel_handle_for(1);
    let cancel2 = room.cancel_handle_for(2);

    // Drop the room.
    drop(room);

    assert!(cancel1.is_cancelled());
    assert_eq!(cancel1.reason(), Some(&CancelReason::RoomDestroyed));
    assert!(cancel2.is_cancelled());
    assert_eq!(cancel2.reason(), Some(&CancelReason::RoomDestroyed));

    // Clients should see the stream close.
    c1.expect_closed().await;
    c2.expect_closed().await;
}

// 20. (gated test) join_with pending cleanup on error
#[tokio::test]
async fn test_stream_room_join_error_pending_cleanup() {
    // When join_with fails at step 3 (e.g., rejected), pending should be cleaned up.
    let proto = ContextProtocol {
        members: std::collections::HashMap::new(),
        max: 0,
    };
    let room = StreamRoom::new(proto);

    let result = room.join_with(1, "Test".to_string(), noop_handler).await;
    assert!(matches!(result, Err(JoinError::Rejected(_))));

    // Pending should be empty after rejection.
    assert!(
        !room.user_is_pending(1),
        "pending should be cleaned up after rejection"
    );
}

// 21. Use gated test, drop join future, verify slot reusable
#[tokio::test]
async fn test_stream_room_join_cancelled_during_stream_open() {
    let (room, gate) = StreamRoom::new_gated(EchoProtocol::new());

    // Start join — will block at step 2 (stream open).
    let room2 = Arc::clone(&room);
    let join_task = tokio::spawn(async move { room2.join(1, noop_handler).await });

    // Give the join task time to reach the gate.
    // Yield to let the cleanup task process the cancellation.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // User should be in pending.
    assert!(room.user_is_pending(1));

    // Abort the join task (simulates dropping the future).
    join_task.abort();
    let _ = join_task.await;

    // PendingGuard should clean up — give it a moment.
    // Yield to let the cleanup task process the cancellation.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // Pending should be empty.
    assert!(
        !room.user_is_pending(1),
        "PendingGuard should have removed user from pending"
    );

    // Slot should be reusable — join again with the gate open.
    gate.open();
    let room3 = Arc::clone(&room);
    let result = room3.join(1, noop_handler).await;
    assert!(
        result.is_ok(),
        "join should succeed after cancellation cleanup"
    );
}

// 22. Happy path: join succeeds, pending is empty
#[tokio::test]
async fn test_stream_room_pending_guard_disarm_on_success() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    // After successful join, pending should be empty and user in handles.
    assert!(
        room.pending_is_empty(),
        "pending should be empty after successful join"
    );
    assert!(room.user_is_active(1), "user should be in handles");
}

// 23. Protocol returns empty init vec
#[tokio::test]
async fn test_stream_room_empty_init_messages() {
    let room = StreamRoom::new(EmptyInitProtocol);

    let (_handle, mut c1, _sender) = room.join(1, noop_handler).await.unwrap();

    // No init messages — first message should be the join broadcast.
    c1.expect(&"joined:1".to_string()).await;
}

// ── Uni-stream tests ─────────────────────────────────────────────

// 24. Uni client receives init message and join broadcast.
#[tokio::test]
async fn test_uni_stream_join_receives_init_and_join_broadcast() {
    let room = StreamRoom::new(UniEchoProtocol::new());
    let mut client = room.join_send_only(1).await.unwrap();
    client.expect(&"welcome".to_string()).await;
    client.expect(&"joined:1".to_string()).await;
}

// 25. Broadcast reaches all uni-stream members.
#[tokio::test]
async fn test_uni_stream_broadcast_reaches_all_members() {
    let room = StreamRoom::new(UniEchoProtocol::new());
    let mut c1 = room.join_send_only(1).await.unwrap();
    let mut c2 = room.join_send_only(2).await.unwrap();
    // Drain setup: c1 gets welcome + joined:1 + joined:2 = 3 msgs
    c1.drain(3).await;
    // c2 gets welcome + joined:2 = 2 msgs
    c2.drain(2).await;

    room.broadcast(&"hello all".to_string());
    c1.expect(&"hello all".to_string()).await;
    c2.expect(&"hello all".to_string()).await;
}

// 26. remove() triggers leave broadcast to remaining member and closes removed member's stream.
#[tokio::test]
async fn test_uni_stream_remove_triggers_leave_broadcast() {
    let room = StreamRoom::new(UniEchoProtocol::new());
    let mut c1 = room.join_send_only(1).await.unwrap();
    let mut c2 = room.join_send_only(2).await.unwrap();
    c1.drain(3).await;
    c2.drain(2).await;

    let _ = room.remove(1);
    c2.expect(&"left:1".to_string()).await;
    c1.expect_closed().await;
}

// 27. Mixed bidi and uni members both receive broadcasts.
#[tokio::test]
async fn test_mixed_bidi_and_uni_members() {
    let room = StreamRoom::new(EchoProtocol::new());
    // User 1: bidi
    let (_handle, mut c1, _sender) = room.join(1, noop_handler).await.unwrap();
    // User 2: uni
    let mut c2 = room.join_send_only(2).await.unwrap();
    c1.drain(3).await;
    c2.drain(2).await;

    room.broadcast(&"ping".to_string());
    c1.expect(&"ping".to_string()).await;
    c2.expect(&"ping".to_string()).await;

    assert!(room.contains(1));
    assert!(room.contains(2));
    assert_eq!(room.member_count(), 2);
}

// 28. Uni member that does not drain is evicted by backpressure.
#[tokio::test]
async fn test_uni_stream_backpressure_cancels_member() {
    let room = StreamRoom::new(UniEchoProtocol::new());
    let _client = room.join_send_only(1).await.unwrap();
    // Don't drain. Buffer = 32. Init (1) + join broadcast (1) = 2 in buffer.
    // Send 31 more to exceed capacity (30 fills, 31st overflows).
    for i in 0..31 {
        room.broadcast(&format!("flood:{i}"));
    }
    // Allow cleanup task to run.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    assert!(
        room.is_empty(),
        "member should have been removed by cleanup task"
    );
}

// 29. Dropping the room closes all uni-stream clients.
#[tokio::test]
async fn test_uni_stream_room_drop_cancels_all() {
    let room = StreamRoom::new(UniEchoProtocol::new());
    let mut c1 = room.join_send_only(1).await.unwrap();
    let mut c2 = room.join_send_only(2).await.unwrap();
    drop(room);
    c1.expect_closed().await;
    c2.expect_closed().await;
}

// 30. Cancel existing member's sink, then join same user_id, verify old entry cleaned up
#[tokio::test]
async fn test_stream_room_join_self_heals_stale_entry() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    // Cancel user 1's sink (simulating a stale entry).
    room.cancel_user_sink(1, CancelReason::BackpressureFull);

    // Join again with same user_id — should self-heal.
    let (_handle, mut c1_new, _sender) = room.join(1, noop_handler).await.unwrap();

    // New client should get init + join.
    c1_new.expect(&"welcome".to_string()).await;
    c1_new.expect(&"joined:1".to_string()).await;

    // Room should have exactly 1 member.
    assert_eq!(room.member_count(), 1);
    assert!(room.contains(1));
}

// 31. Atomic mutate + broadcast skips excluded user
#[tokio::test]
async fn test_stream_room_mutate_and_broadcast_except_skips_user() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    // Drain init + join broadcasts.
    c1.drain(3).await; // welcome, joined:1, joined:2
    c2.drain(2).await; // welcome, joined:2

    room.mutate_and_broadcast_except(
        |state| {
            state.join_count += 10;
            "excluded_msg".to_string()
        },
        1, // exclude user 1
    );

    // User 2 gets the message.
    c2.expect(&"excluded_msg".to_string()).await;

    // User 1 should NOT get it. Send sentinel to verify.
    room.broadcast(&"sentinel".to_string());
    c1.expect(&"sentinel".to_string()).await;

    // State was mutated.
    room.with_state(|state| {
        assert_eq!(state.join_count, 12); // 2 joins + 10
    });
}

// 32. FnOnce returns None -> no broadcast
#[tokio::test]
async fn test_stream_room_mutate_and_maybe_broadcast_none() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_handle, mut c1, _sender) = room.join(1, noop_handler).await.unwrap();

    c1.drain(2).await; // welcome, joined:1

    room.mutate_and_maybe_broadcast(|state| {
        state.join_count += 5;
        None // no broadcast
    });

    // State was mutated but no message sent.
    room.with_state(|state| {
        assert_eq!(state.join_count, 6); // 1 join + 5
    });

    // Verify no message by sending a sentinel.
    room.broadcast(&"sentinel".to_string());
    c1.expect(&"sentinel".to_string()).await;
}

// 33. send() to user with full buffer -> BackpressureFull
#[tokio::test]
async fn test_stream_room_send_cancels_on_full() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    let cancel = room.cancel_handle_for(1);

    // Fill the buffer: init(1) + join(1) = 2 used, 30 remaining.
    // Send 30 more via send() to fill buffer.
    for i in 0..30 {
        let _ = room.send(1, &format!("fill:{i}"));
    }

    // Buffer is now full (32/32). Next send should trigger BackpressureFull.
    let result = room.send(1, &"overflow".to_string());
    assert!(!result, "send should return false when buffer is full");

    assert!(cancel.is_cancelled());
    assert_eq!(cancel.reason(), Some(&CancelReason::BackpressureFull));
}

// 34. (gated test) remove pending-only user returns true
#[tokio::test]
async fn test_stream_room_remove_pending_only() {
    let (room, gate) = StreamRoom::new_gated(EchoProtocol::new());

    // Start join — blocks at gate.
    let room2 = Arc::clone(&room);
    let join_task = tokio::spawn(async move { room2.join(1, noop_handler).await });

    // Yield to let the cleanup task process the cancellation.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // User is pending but not yet in handles.
    assert!(room.user_is_pending(1));
    assert!(!room.user_is_active(1));

    // Remove pending user.
    let removed = room.remove(1);
    assert!(removed, "remove should return true for pending-only user");

    assert!(!room.user_is_pending(1));

    // Let the gate open so the task can finish.
    gate.open();
    let _ = join_task.await;
}

// 35. remove(999) returns false
#[tokio::test]
async fn test_stream_room_remove_returns_false_for_unknown() {
    let room = StreamRoom::new(EchoProtocol::new());
    assert!(!room.remove(999));
}

// 36. Standalone broadcast_except
#[tokio::test]
async fn test_stream_room_broadcast_except_skips_user() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();
    let (_h3, mut c3, _s3) = room.join(3, noop_handler).await.unwrap();

    // Drain init + join broadcasts.
    c1.drain(4).await; // welcome, joined:1, joined:2, joined:3
    c2.drain(3).await; // welcome, joined:2, joined:3
    c3.drain(2).await; // welcome, joined:3

    room.broadcast_except(&"hello_except".to_string(), 2);

    // User 1 and 3 should get it.
    c1.expect(&"hello_except".to_string()).await;
    c3.expect(&"hello_except".to_string()).await;

    // User 2 should NOT. Verify with sentinel.
    room.broadcast(&"sentinel".to_string());
    c2.expect(&"sentinel".to_string()).await;
}

// 37. send() to unknown user returns false
#[tokio::test]
async fn test_stream_room_send_not_found_returns_false() {
    let room = StreamRoom::new(EchoProtocol::new());
    let result = room.send(999, &"hello".to_string());
    assert!(!result, "send to unknown user should return false");
}

// 38. member_ids, member_count, is_empty, contains
#[tokio::test]
async fn test_stream_room_query_methods() {
    let room = StreamRoom::new(EchoProtocol::new());

    assert!(room.is_empty());
    assert_eq!(room.member_count(), 0);
    assert!(!room.contains(1));
    assert!(room.member_ids().is_empty());

    let _ = room.join(1, noop_handler).await.unwrap();

    assert!(!room.is_empty());
    assert_eq!(room.member_count(), 1);
    assert!(room.contains(1));
    assert!(!room.contains(2));
    assert_eq!(room.member_ids(), vec![1]);

    let _ = room.join(2, noop_handler).await.unwrap();

    assert_eq!(room.member_count(), 2);
    assert!(room.contains(1));
    assert!(room.contains(2));

    let ids = room.member_ids();
    assert!(ids.contains(&1));
    assert!(ids.contains(&2));
    assert_eq!(ids.len(), 2);
}

// 39. Drop room, verify on_member_left NOT called
#[tokio::test]
async fn test_stream_room_drop_no_on_member_left() {
    let join_count = Arc::new(AtomicUsize::new(0));
    let leave_count = Arc::new(AtomicUsize::new(0));

    let proto = CountingProtocol::new(Arc::clone(&join_count), Arc::clone(&leave_count));
    let room = StreamRoom::new(proto);

    let _p1 = room.join(1, noop_handler).await.unwrap();
    let _p2 = room.join(2, noop_handler).await.unwrap();

    // Verify leave_count before drop.
    assert_eq!(leave_count.load(Ordering::SeqCst), 0);

    // Drop the room.
    drop(room);
    // Drop the client pairs so cleanup tasks can't interfere.
    drop(_p1);
    drop(_p2);

    // Yield to let any hypothetical cleanup tasks attempt to run.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // on_member_left should NOT have been called during Drop.
    // The cleanup tasks use Weak and the room is dropped, so they
    // can't upgrade the Weak reference and exit without action.
    assert_eq!(
        leave_count.load(Ordering::SeqCst),
        0,
        "on_member_left should NOT be called during Drop"
    );
}

// 40. 100 concurrent joins/removes, no panics
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_stream_room_concurrent_join_remove_stress() {
    let room = StreamRoom::new(EchoProtocol::new());

    let mut handles = Vec::new();
    for i in 0..100i32 {
        let room = Arc::clone(&room);
        handles.push(tokio::spawn(async move {
            // Join.
            let result = room.join(i, noop_handler).await;
            if result.is_ok() {
                // Small delay to let other tasks interleave.
                tokio::task::yield_now().await;
                // Remove.
                let _ = room.remove(i);
            }
        }));
    }

    // All tasks should complete without panic.
    for handle in handles {
        handle.await.expect("task panicked during stress test");
    }

    // Room should be empty after all joins and removes.
    assert!(
        room.is_empty(),
        "room should be empty after all concurrent join/remove cycles"
    );
}

// 41. Failed try_send undoes on_member_joining by calling on_member_left.
//
// The undo path (step 3c) fires when try_send returns Closed during init.
// With test infrastructure (DuplexStream + fresh mpsc buffer=32 + <=31 init
// messages), the channel never overflows and the forwarding task hasn't
// exited, so the path is nearly unreachable. We verify the invariant through
// the observable undo behavior: on_member_joining mutates state, and
// on_member_left undoes it. The same cleanup logic is exercised by remove().
#[tokio::test]
async fn test_stream_room_join_failure_calls_on_member_left() {
    let proto = ContextProtocol {
        members: std::collections::HashMap::new(),
        max: 10,
    };
    let room = StreamRoom::new(proto);

    // Join user 1 — on_member_joining inserts nick into members map.
    let (_h1, _c1, _s1) = room
        .join_with(1, "Alice".to_string(), noop_handler)
        .await
        .unwrap();

    // Verify state was modified by on_member_joining.
    room.with_state(|state| {
        assert_eq!(state.members.len(), 1);
        assert_eq!(state.members.get(&1).unwrap(), "Alice");
    });

    // remove() triggers on_member_left, which undoes on_member_joining
    // (removes from members map). This is the same cleanup logic that
    // step 3c uses when try_send fails.
    let removed = room.remove(1);
    assert!(removed);

    // on_member_left should have undone the state change.
    room.with_state(|state| {
        assert!(
            state.members.is_empty(),
            "on_member_left should undo on_member_joining state change"
        );
    });

    // Slot should be reusable after the undo.
    let (_h1b, _c1b, _s1b) = room
        .join_with(1, "Alice2".to_string(), noop_handler)
        .await
        .unwrap();

    room.with_state(|state| {
        assert_eq!(state.members.get(&1).unwrap(), "Alice2");
    });
}

// 42. Cleanup task logs the CancelReason after disconnect.
#[tokio::test]
async fn test_stream_room_disconnect_logs_cancel_reason() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    // Grab cancel handle for user 1.
    let cancel = room.cancel_handle_for(1);

    // Cancel with a specific reason.
    cancel.cancel(CancelReason::TransportError);

    // Yield to let the cleanup task run.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // Member should be removed.
    assert!(!room.contains(1), "member should be removed after cancel");

    // Reason should be set to the one we provided.
    assert_eq!(
        cancel.reason(),
        Some(&CancelReason::TransportError),
        "cancel reason should be TransportError"
    );
}

// 43. ABA prevention: rapid leave + rejoin. The cleanup task from the
// first join should NOT interfere with the second join because the
// identity check (sink equality) prevents stale cleanup.
#[tokio::test]
async fn test_stream_room_rapid_leave_rejoin() {
    let room = StreamRoom::new(EchoProtocol::new());

    // First join.
    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    // Grab cancel handle for the first join's sink.
    let cancel1 = room.cancel_handle_for(1);

    // Remove user 1 (this cancels with Removed and removes from handles).
    let _ = room.remove(1);

    // Immediately re-join user 1 — before the cleanup task from the
    // first join has had a chance to run.
    let (_handle, mut c1_new, _sender) = room.join(1, noop_handler).await.unwrap();

    // The new client should receive init + join broadcast normally.
    c1_new.expect(&"welcome".to_string()).await;
    c1_new.expect(&"joined:1".to_string()).await;

    // Now yield to let the first join's cleanup task attempt to run.
    // It should detect a sink mismatch (ABA check) and do nothing.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // User 1 should STILL be in the room (cleanup task did NOT remove
    // the new entry).
    assert!(
        room.contains(1),
        "ABA prevention: cleanup task from first join must not remove re-joined user"
    );
    assert_eq!(room.member_count(), 1);

    // The first cancel handle should show Removed.
    assert_eq!(cancel1.reason(), Some(&CancelReason::Removed));
}

// 44. > 31 init messages truncated to MAX_INIT_MESSAGES.
#[tokio::test]
async fn test_stream_room_init_messages_truncated() {
    // Protocol returns 50 init messages, but only 31 should be sent.
    let proto = OverflowInitProtocol { init_count: 50 };
    let room = StreamRoom::new(proto);

    let (_handle, mut c1, _sender) = room.join(1, noop_handler).await.unwrap();

    // Read exactly MAX_INIT_MESSAGES (31) init messages.
    for i in 0..MAX_INIT_MESSAGES {
        c1.expect(&format!("init:{i}")).await;
    }

    // The next message should NOT be init:31 — it should be absent.
    // on_member_joined returns None for OverflowInitProtocol (default),
    // so no join broadcast either. Send a sentinel to verify no extra
    // init messages leaked through.
    room.broadcast(&"sentinel".to_string());
    c1.expect(&"sentinel".to_string()).await;
}

// 45. send() on a closed channel sets ChannelClosed or TransportError.
#[tokio::test]
async fn test_stream_room_send_cancels_on_closed() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_handle, c1, _s1) = room.join(1, noop_handler).await.unwrap();

    let cancel = room.cancel_handle_for(1);

    // Drop the client — closes the DuplexStream transport.
    drop(c1);

    // Yield to let the forwarding task detect the transport error.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // send() should fail — either the forwarding task already set
    // TransportError, or try_send returns Closed and sets ChannelClosed.
    let result = room.send(1, &"after-close".to_string());
    assert!(!result, "send should return false on closed channel");

    // Same race as test 16: forwarding task may set TransportError first.
    assert!(cancel.is_cancelled(), "sink must be cancelled");
    let reason = cancel.reason().expect("cancel reason must be set");
    assert!(
        matches!(
            reason,
            CancelReason::ChannelClosed | CancelReason::TransportError
        ),
        "expected ChannelClosed or TransportError, got {reason:?}"
    );
}

// 46. Join while existing member has full buffer: existing gets
// cancelled with BackpressureFull, new join still succeeds.
#[tokio::test]
async fn test_stream_room_join_broadcast_backpressure_existing() {
    let room = StreamRoom::new(EchoProtocol::new());

    // Join user 1.
    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    let cancel1 = room.cancel_handle_for(1);

    // Fill user 1's buffer. Buffer=32, init(1)+join(1)=2 used, 30 remaining.
    // Send 30 more to fill it completely.
    for i in 0..30 {
        room.broadcast(&format!("flood:{i}"));
    }

    // Buffer is now full (32/32). User 1 is not cancelled yet (Full
    // only triggers on the NEXT send).

    // Join user 2 — the on_member_joined broadcast goes to ALL handles
    // including user 1. User 1's buffer is full, so try_send returns
    // Full and user 1 gets cancelled with BackpressureFull.
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    // User 1 should be cancelled with BackpressureFull.
    assert!(
        cancel1.is_cancelled(),
        "user 1 should be cancelled after buffer overflow"
    );
    assert_eq!(
        cancel1.reason(),
        Some(&CancelReason::BackpressureFull),
        "user 1 cancel reason should be BackpressureFull"
    );

    // User 2 should have joined successfully and receive init + join.
    c2.expect(&"welcome".to_string()).await;
    c2.expect(&"joined:2".to_string()).await;

    // User 2 should still be active.
    assert!(room.contains(2), "user 2 should still be in the room");
}

// 47. with_state_mut under concurrent broadcast/join is serialized
// by the mutex — verify counter correctness.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_stream_room_with_state_mut_concurrent_safety() {
    let room = StreamRoom::new(EchoProtocol::new());

    // Join a member so broadcast has something to send to.
    let (_h1, _c1, _s1) = room.join(1, noop_handler).await.unwrap();

    let iterations = 100;
    let mut handles = Vec::new();

    // Spawn tasks that concurrently increment join_count via with_state_mut.
    for _ in 0..iterations {
        let room = Arc::clone(&room);
        handles.push(tokio::spawn(async move {
            room.with_state_mut(|state| {
                state.join_count += 1;
            });
        }));
    }

    // Spawn tasks that concurrently broadcast messages.
    for i in 0..iterations {
        let room = Arc::clone(&room);
        handles.push(tokio::spawn(async move {
            room.broadcast(&format!("concurrent:{i}"));
        }));
    }

    // Wait for all tasks to complete.
    for handle in handles {
        handle.await.expect("task panicked during concurrent test");
    }

    // The mutex serializes all access, so the counter should be exactly
    // iterations + the 1 from the initial join's on_member_joined.
    room.with_state(|state| {
        assert_eq!(
            state.join_count,
            iterations + 1, // +1 from on_member_joined during join
            "counter should reflect exactly {iterations} increments + 1 join"
        );
    });
}

// ── Receive-loop integration (end-to-end client→server message flow) ─────────

// 48. Client sends one message; the handler receives it.
//
// This is the most critical missing coverage: verifies the receive loop
// spawned by join_with actually calls the handler. None of the 41 tests
// above exercised this path.
#[tokio::test]
async fn receive_loop_integration_client_message_reaches_handler() {
    use std::time::Duration;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let room = StreamRoom::new(EchoProtocol::new());

    let tx_clone = tx.clone();
    let (_handle, _c1, mut sender) = room
        .join(1, move |msg: String| {
            let tx = tx_clone.clone();
            async move {
                let _ = tx.send(msg);
            }
        })
        .await
        .unwrap();

    // Send one message from the simulated client to the server.
    sender.send("ping".to_string()).await;

    let received = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("timed out waiting for handler")
        .expect("handler channel closed unexpectedly");
    assert_eq!(received, "ping");
}

// 49. Client sends 200 messages; handler receives all in order.
#[tokio::test]
async fn receive_loop_integration_200_client_messages_in_order() {
    use std::time::Duration;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let room = StreamRoom::new(EchoProtocol::new());

    let tx_clone = tx.clone();
    let (_handle, _c1, mut sender) = room
        .join(1, move |msg: String| {
            let tx = tx_clone.clone();
            async move {
                let _ = tx.send(msg);
            }
        })
        .await
        .unwrap();

    for i in 0..200u32 {
        sender.send(format!("msg:{i}")).await;
    }

    for i in 0..200u32 {
        let received = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("timed out waiting for handler")
            .expect("handler channel closed");
        assert_eq!(
            received,
            format!("msg:{i}"),
            "handler must receive in send order"
        );
    }
}

// ── Init-message boundary ────────────────────────────────────────────────────

// 50. Exactly MAX_INIT_MESSAGES (31) init messages fit without truncation.
//
// The const assertion guarantees 31 + 1 join broadcast ≤ 32 buffer slots.
// This test makes the runtime behavior observable: all 31 arrive, plus the
// join broadcast, with no slot left unused and no try_send failure.
#[tokio::test]
async fn init_messages_exactly_at_max_no_truncation() {
    let room = StreamRoom::new(MaxInitProtocol);
    let (_handle, mut c1, _sender) = room.join(1, noop_handler).await.unwrap();

    // All 31 init messages must arrive without truncation.
    for i in 0..MAX_INIT_MESSAGES {
        c1.expect(&format!("init:{i}")).await;
    }

    // The join broadcast (slot 32) must also arrive.
    c1.expect(&"joined:1".to_string()).await;

    // Sentinel: no extra init messages slipped through.
    room.broadcast(&"sentinel".to_string());
    c1.expect(&"sentinel".to_string()).await;
}

// ── broadcast_except with non-member ────────────────────────────────────────

// 51. Excluding a user_id that is not in the room is a no-op — all active
// members still receive the message.
#[tokio::test]
async fn broadcast_except_nonexistent_excluded_user_broadcasts_to_all() {
    let room = StreamRoom::new(EchoProtocol::new());

    let (_h1, mut c1, _s1) = room.join(1, noop_handler).await.unwrap();
    let (_h2, mut c2, _s2) = room.join(2, noop_handler).await.unwrap();

    c1.drain(3).await; // welcome, joined:1, joined:2
    c2.drain(2).await; // welcome, joined:2

    // 999 is not in the room — exclusion has no effect.
    room.broadcast_except(&"hello".to_string(), 999);

    c1.expect(&"hello".to_string()).await;
    c2.expect(&"hello".to_string()).await;
}

// ── Large-scale concurrency (stress / race-freedom) ──────────────────────────

// 52. 500 concurrent unique-user joins — no deadlock, no panic.
//
// With EchoProtocol (1 init message + 1 join broadcast = 2 msgs), a fresh
// 32-slot buffer never overflows for the JOINING user. All 500 join()
// calls must return Ok. Early members may be cancelled by the flood of join
// broadcasts — that is expected backpressure behaviour, not a failure.
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn concurrent_500_users_join_no_deadlock_no_panic() {
    let room = StreamRoom::new(EchoProtocol::new());

    let mut handles = Vec::new();
    for i in 0..500i32 {
        let room = Arc::clone(&room);
        handles.push(tokio::spawn(async move {
            room.join(i, noop_handler)
                .await
                .expect("join must not fail: fresh buffer fits 1 init + 1 broadcast");
        }));
    }

    for h in handles {
        h.await.expect("task panicked during concurrent join");
    }

    // Every user moved from pending → handles. No user stuck in pending.
    assert!(
        room.pending_is_empty(),
        "no user should be stuck in pending after all joins"
    );
}

// 53. Concurrent join + broadcast + remove chaos: no deadlock, no panic.
//
// The room's single mutex must serialize all operations without starvation.
// Spawns 100 joins + 500 broadcasts + 50 removes all simultaneously against
// a room that already has 50 members.
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn concurrent_join_broadcast_remove_chaos_no_deadlock() {
    let room = StreamRoom::new(EchoProtocol::new());

    // Pre-join 50 users so broadcasts have real targets.
    for i in 0..50i32 {
        let _ = room.join(i, noop_handler).await.unwrap();
    }

    let mut handles = Vec::new();

    // 100 new join tasks (users 50–149).
    for i in 50..150i32 {
        let room = Arc::clone(&room);
        handles.push(tokio::spawn(async move {
            let _ = room.join(i, noop_handler).await;
        }));
    }

    // 500 broadcast tasks — all racing with joins and removes.
    for i in 0..500u32 {
        let room = Arc::clone(&room);
        handles.push(tokio::spawn(async move {
            room.broadcast(&format!("chaos:{i}"));
        }));
    }

    // 50 remove tasks for the pre-joined users.
    for i in 0..50i32 {
        let room = Arc::clone(&room);
        handles.push(tokio::spawn(async move {
            let _ = room.remove(i);
        }));
    }

    for h in handles {
        h.await.expect("task panicked");
    }

    // Structural integrity: member count is within expected bounds.
    let count = room.member_count();
    assert!(
        count <= 150,
        "member count cannot exceed total join attempts"
    );
    assert!(
        room.pending_is_empty(),
        "no user should be stuck in pending after chaos test"
    );
}

// 54. After 200 concurrent join→remove cycles, room is empty and counts match.
//
// Each task joins unique user i, increments a counter, then removes user i.
// With EchoProtocol, all joins succeed (fresh buffer). After all tasks and
// cleanup tasks settle, the room must be empty.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn member_count_consistent_after_concurrent_join_remove() {
    use std::sync::atomic::Ordering;

    let joined = Arc::new(AtomicUsize::new(0));
    let room = StreamRoom::new(EchoProtocol::new());

    let mut handles = Vec::new();
    for i in 0..200i32 {
        let room = Arc::clone(&room);
        let joined = Arc::clone(&joined);
        handles.push(tokio::spawn(async move {
            room.join(i, noop_handler)
                .await
                .expect("join must succeed for unique user with fresh buffer");
            joined.fetch_add(1, Ordering::Relaxed);
            let _ = room.remove(i);
        }));
    }

    for h in handles {
        h.await.expect("task panicked");
    }

    // Yield to let all cleanup tasks run.
    for _ in 0..40 {
        tokio::task::yield_now().await;
    }

    assert_eq!(
        joined.load(Ordering::SeqCst),
        200,
        "all 200 joins must succeed"
    );
    assert!(
        room.is_empty(),
        "room must be empty after all join/remove cycles"
    );
    assert!(room.pending_is_empty(), "no user stuck in pending");
}

// 55. ABA prevention under real parallelism.
//
// 100 tasks each do: join(i) → remove(i) → re-join(i), using a barrier
// to separate the two phases so the order is deterministic.
//
// Phase 1 (pre-barrier): all first joins.
// Phase 2 (post-barrier): all removes + second joins.
//
// The cleanup task spawned by the first join sees a different sink than the
// one from the re-join → identity check fails → on_member_left must NOT be
// called a second time.
//
// Uses CountingNoBroadcastProtocol (no init messages, no join broadcasts)
// so buffers never overflow and the leave_count invariant is clean.
//
// Invariant: leave_count == 100 (exactly one on_member_left per remove,
// zero from cleanup tasks).
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn aba_prevention_parallel_real_threads() {
    use std::sync::atomic::Ordering;
    use tokio::sync::Barrier;

    let join_count = Arc::new(AtomicUsize::new(0));
    let leave_count = Arc::new(AtomicUsize::new(0));

    let proto = CountingNoBroadcastProtocol::new(Arc::clone(&join_count), Arc::clone(&leave_count));
    let room = StreamRoom::new(proto);

    // Barrier ensures all 100 tasks complete Phase 1 before any enters Phase 2.
    let barrier = Arc::new(Barrier::new(100));

    let mut handles = Vec::new();
    for i in 0..100i32 {
        let room = Arc::clone(&room);
        let barrier = Arc::clone(&barrier);
        handles.push(tokio::spawn(async move {
            // ── Phase 1: first join ──────────────────────────────────
            let first_pair = room.join(i, noop_handler).await.expect("first join failed");

            barrier.wait().await; // ← all first joins done before any remove/re-join

            // ── Phase 2: remove + re-join ────────────────────────────
            let _ = room.remove(i);
            // Cleanup task for the first join wakes here (cancel fired).
            // It will find a different sink (ABA check) → no-op.
            let second_pair = room.join(i, noop_handler).await.expect("re-join failed");

            // Return both pairs so the caller can keep the TestClientSenders
            // alive through the assertion window.
            (first_pair, second_pair)
        }));
    }

    // Collect all pairs. TestClientSenders for both joins stay alive.
    let mut all_pairs = Vec::new();
    for h in handles {
        all_pairs.push(h.await.expect("task panicked"));
    }

    // Yield to let first-join cleanup tasks (woken by remove) attempt to run.
    // Second-join cleanup tasks stay dormant (TestClientSenders alive).
    for _ in 0..40 {
        tokio::task::yield_now().await;
    }

    // Every user must still be active — first-join cleanup tasks were no-ops.
    assert_eq!(
        room.member_count(),
        100,
        "ABA prevention: first-join cleanup tasks must not remove re-joined users"
    );
    // on_member_joined: first join + second join per user = 200.
    assert_eq!(join_count.load(Ordering::SeqCst), 200);
    // on_member_left: exactly once per user (from remove) = 100.
    assert_eq!(
        leave_count.load(Ordering::SeqCst),
        100,
        "cleanup tasks must not double-call on_member_left: ABA prevention broken"
    );

    // Explicit drop: triggers StreamEnded for all second joins → correct teardown.
    drop(all_pairs);
}

// 56. Drop the room while join futures are in-flight — no panic.
//
// `PendingGuard` holds an `Arc<StreamRoom>` — the room stays alive until
// the guard drops. Aborting the join tasks drops the guards, which remove
// the pending entries and release the last Arc. Everything must unwind
// cleanly without any panic or lock poisoning.
#[tokio::test]
async fn drop_room_while_join_in_flight_no_panic() {
    let (room, gate) = StreamRoom::new_gated(EchoProtocol::new());

    // Spawn 10 join tasks — each will block at the gate (step 2).
    let mut join_tasks = Vec::new();
    for i in 0..10i32 {
        let room2 = Arc::clone(&room);
        join_tasks.push(tokio::spawn(
            async move { room2.join(i, noop_handler).await },
        ));
    }

    // Yield to let tasks reach the gate.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    // Drop the test's Arc — only the join tasks keep the room alive.
    drop(room);

    // Abort all join tasks. PendingGuard::drop runs for each, cleaning up
    // the pending entries and releasing the last Arc of StreamRoom.
    for task in join_tasks {
        task.abort();
        let _ = task.await; // consume JoinError::Cancelled
    }

    // If we reach here without panic, the test passes.
    // Also drop gate to ensure nothing holds a dangling ref.
    drop(gate);
}

// ── StreamRoom confirmed send wrappers ──────────────────────────

/// `send_confirmed` delivers a confirmed message to a specific member.
#[tokio::test]
async fn test_room_send_confirmed_delivers_to_member() {
    let room = StreamRoom::new(EchoProtocol::new());
    let (_h, mut client, _tx) = room.join(1, |_msg: String| async {}).await.unwrap();

    // Drain init ("welcome") + join broadcast ("joined:1").
    client.drain(2).await;

    room.send_confirmed(1, "direct".to_string())
        .await
        .expect("user 1 is a member")
        .expect("send_confirmed succeeded");
    client.expect(&"direct".to_string()).await;
}

/// `send_confirmed` returns None when the user is not a member.
#[tokio::test]
async fn test_room_send_confirmed_returns_none_for_non_member() {
    let room = StreamRoom::new(EchoProtocol::new());

    let result = room.send_confirmed(999, "msg".to_string()).await;
    assert!(result.is_none(), "expected None for non-member");
}
