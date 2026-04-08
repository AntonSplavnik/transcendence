# Concurrency

Race conditions are design bugs that manifest at runtime. The only reliable prevention
is designing abstractions whose correct use is enforced by ownership and the type system.

## Table of Contents

1. [Hierarchy of Preferred Designs](#hierarchy-of-preferred-designs)
2. [Lock Discipline](#lock-discipline)
3. [Async Safety](#async-safety)
4. [Channels](#channels)
5. [Atomics](#atomics)
6. [Send and Sync](#send-and-sync)
7. [Anti-Patterns Checklist](#anti-patterns-checklist)

---

## Hierarchy of Preferred Designs

Prefer designs higher in this list. Each step down requires a comment justifying
why the safer option was insufficient.

```
Ownership transfer (move semantics)          <- always prefer
Message passing (mpsc / broadcast channels)
Immutable shared state (Arc<T>, no Mutex)
Read-heavy shared state (Arc<RwLock<T>>)
Mutex-guarded shared state (Arc<Mutex<T>>)
Atomics (complex correctness proofs)
unsafe + raw synchronization               <- last resort
```

---

## Lock Discipline

### Lock Ordering

Deadlocks occur when two threads acquire the same locks in different orders.
Prevention: assign every lock a numeric level and always acquire in ascending order.

**Every crate with more than one mutex must document its lock order at the top
of `lib.rs` or `main.rs`:**

```rust
//! # Lock Ordering
//!
//! Locks must always be acquired in ascending level order.
//! If you hold a lock at level N, you may only acquire locks at level N+1 or higher.
//! Acquiring a lock at a level equal to or lower than any currently-held lock
//! is a deadlock hazard and must be treated as a bug.
//!
//! 1. `Registry::lock`
//! 2. `Session::state_lock`
//! 3. `Connection::write_lock`
```

At every acquisition site, comment what is currently held:

```rust
// Holding: Registry (level 1). Acquiring: Session (level 2). Order OK.
let session = self.session.state_lock.lock()
    .expect("session lock poisoned -- prior panic corrupted state");
```

### Document What the Mutex Protects

```rust
/// Shared pool of idle worker threads.
///
/// # Invariants (enforced by this lock)
/// - Contains only threads in `ThreadState::Idle`.
/// - `workers.len()` never exceeds `max_workers`.
///
/// # Lock Order: Level 1
workers: Mutex<Vec<WorkerHandle>>,
```

### Minimize Lock Scope

Hold locks for the shortest possible duration. Never call I/O, external functions,
or user callbacks while holding a lock.

```rust
// BAD: I/O inside lock
let guard = self.cache.lock().expect("cache lock poisoned");
let result = expensive_network_call().await; // lock held across I/O
guard.update(result);

// GOOD: read under lock, release, do work, re-acquire
let snapshot = {
    let guard = self.cache.lock().expect("cache lock poisoned");
    guard.snapshot()
}; // guard dropped
let result = expensive_network_call_with(snapshot).await;
{
    let mut guard = self.cache.lock().expect("cache lock poisoned");
    guard.update(result);
}
```

### Poisoned Mutexes

Decide explicitly how to handle poison:

```rust
// Option A: treat as fatal (appropriate for most cases)
let guard = self.state.lock()
    .expect("state lock poisoned -- prior panic left state inconsistent");

// Option B: recover (only when data is known to be consistent despite panic)
let guard = self.state.lock().unwrap_or_else(|poisoned| {
    tracing::warn!("state lock poisoned, recovering");
    poisoned.into_inner()
});
```

Bare `.unwrap()` on a lock hides the reason you believe it cannot be poisoned. Use
`.expect("reason")` to document that reasoning — when a future maintainer sees a
poisoned lock panic, the message tells them what assumption broke.

---

## Async Safety

### Never Hold a Sync Lock Across `.await`

A `std::sync::MutexGuard` held across `.await` blocks the executor thread.

```rust
// BAD: sync lock held across await
async fn bad(state: Arc<Mutex<State>>) {
    let guard = state.lock().expect("poisoned");
    do_io().await;  // executor blocked
    guard.update();
}

// GOOD: drop guard before await
async fn good(state: Arc<Mutex<State>>) {
    let snapshot = {
        let guard = state.lock().expect("poisoned");
        guard.read_value()
    }; // guard dropped
    do_io_with(snapshot).await;
}

// GOOD: use tokio::sync::Mutex for async contexts
async fn good_async(state: Arc<tokio::sync::Mutex<State>>) {
    let mut guard = state.lock().await;
    do_io().await;  // tokio Mutex is safe across await
    guard.update();
}
```

### Blocking Work Off the Runtime

Never call blocking I/O or CPU-heavy work on an async executor thread.

```rust
// BAD: blocks tokio thread pool
async fn bad() -> Result<Vec<u8>, io::Error> { std::fs::read("data.bin") }

// GOOD: offload to blocking thread pool
async fn good() -> Result<Vec<u8>, io::Error> {
    tokio::task::spawn_blocking(|| std::fs::read("data.bin"))
        .await
        .expect("blocking task panicked")
}
```

### Spawned Task Contracts

Every `tokio::spawn` must document: what the task owns, how it terminates,
and how it is cancelled or joined.

```rust
/// Spawns a heartbeat sender.
///
/// Runs until `shutdown` is cancelled. Holds `Arc<Connection>` (no shared mutation).
/// The returned `JoinHandle` must be awaited on shutdown.
fn spawn_heartbeat(
    conn: Arc<Connection>,
    interval: Duration,
    shutdown: CancellationToken,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = tokio::time::sleep(interval) => {
                    if let Err(e) = conn.send_ping().await {
                        tracing::error!("heartbeat failed: {e}");
                        break;
                    }
                }
                _ = shutdown.cancelled() => break,
            }
        }
    })
}
```

Every `JoinHandle` must be awaited, stored, or explicitly dropped with a comment.
Fire-and-forget tasks that panic will silently swallow the panic.

### Cancellation Safety

`tokio::select!` cancels the losing branches. If a future is not cancellation-safe,
cancelling it mid-operation can corrupt state.

```rust
// NOT cancellation-safe: partial write corrupts the stream
async fn send_msg(stream: &mut TcpStream, msg: &Message) -> io::Result<()> {
    stream.write_all(&msg.header).await?;
    // cancellation here = half-written message
    stream.write_all(&msg.body).await?;
    Ok(())
}

// Cancellation-safe: buffer atomically, single write
async fn send_msg_safe(stream: &mut TcpStream, msg: &Message) -> io::Result<()> {
    let mut buf = msg.header.to_vec();
    buf.extend_from_slice(&msg.body);
    stream.write_all(&buf).await
}
```

Document cancellation safety on every public async function:

```rust
/// # Cancel Safety
///
/// This function is cancel-safe. If dropped before completion, no bytes
/// are written and internal state is unchanged.
pub async fn send(&mut self, msg: Message) -> Result<(), SendError> { ... }
```

### Pin and Self-Referential Futures

`Pin<P>` guarantees the pointee will not move in memory. This matters for
self-referential types generated by `async fn` state machines.

**When you need Pin:**
- Manual `Future` or `Stream` implementations
- Storing futures in collections
- Intrusive data structures

**When you don't:** Most code using `async fn` and `.await` -- the compiler handles
pinning automatically.

For safe field projection on pinned structs, use `pin_project`:

```rust
use pin_project::pin_project;

#[pin_project]
struct TimedFuture<F> {
    #[pin]
    inner: F,       // pinned -- this future may be self-referential
    deadline: Instant,  // not pinned -- plain data
}
```

Stack pinning: `std::pin::pin!()` (Rust 1.68+). Heap pinning: `Box::pin()`.
Never move a value after pinning it -- this is undefined behavior with `unsafe` pin.

---

## Channels

### Choose the Right Semantics

| Type | Use case |
|---|---|
| `tokio::sync::mpsc` | Work queues, task delegation (most common) |
| `tokio::sync::broadcast` | Event fan-out to multiple consumers |
| `tokio::sync::watch` | Shared latest-value (config updates, health) |
| `tokio::sync::oneshot` | Single request-response |

Unbounded channels are memory leaks under load — if the producer outpaces the consumer,
the queue grows without limit until the process is OOM-killed. Use bounded channels
with an explicit capacity, and only reach for unbounded if you can concretely argue
why backpressure is impossible in your scenario.

Document buffer size rationale:

```rust
// Capacity: ~100ms of peak throughput at 10k items/s.
// Senders experience backpressure beyond this -- intentional.
const QUEUE_CAPACITY: usize = 1_000;
let (tx, rx) = tokio::sync::mpsc::channel::<Work>(QUEUE_CAPACITY);
```

### Shutdown Signalling

Use `CancellationToken` (from `tokio_util`) or `tokio::sync::watch` for shutdown.
A bare `AtomicBool` looks simple but requires careful memory ordering to avoid missed
signals and does not integrate with `tokio::select!`. `CancellationToken` handles
these concerns correctly and composes naturally with async code.

```rust
use tokio_util::sync::CancellationToken;

let token = CancellationToken::new();
let worker_token = token.clone();

tokio::spawn(async move {
    tokio::select! {
        _ = worker_token.cancelled() => { /* graceful shutdown */ }
        result = do_work() => { handle(result); }
    }
});

// Trigger shutdown:
token.cancel();
```

---

## Atomics

Use atomics only when the operation is provably independent. If the result of one
atomic informs the next, you need a mutex (that's a logical dependency, not atomic
at the operation level).

```rust
// CORRECT: independent counter, no ordering needed
static REQUEST_COUNT: AtomicU64 = AtomicU64::new(0);
REQUEST_COUNT.fetch_add(1, Ordering::Relaxed);

// WRONG: two operations are not atomically composed -- TOCTOU race
if flag.load(Ordering::Acquire) {
    data.store(new_value, Ordering::Release); // another thread can change flag here
}
// Fix: use Mutex or compare_exchange
```

### Memory Ordering

| Ordering | When |
|---|---|
| `Relaxed` | Independent counters/stats, no cross-thread synchronization |
| `Acquire` | Load side of a publish pattern (pairs with `Release`) |
| `Release` | Store side of a publish pattern (pairs with `Acquire`) |
| `AcqRel` | Read-modify-write that synchronizes both sides |
| `SeqCst` | Only when you need total global order and cannot prove weaker is correct |

Default to `Acquire`/`Release`. Use `SeqCst` only with a comment explaining why
weaker orderings are insufficient. Always document your ordering choice.

### TOCTOU

Time-of-check to time-of-use: state changes between check and action.

```rust
// BAD: TOCTOU race
if map.contains_key(&key) { map.insert(key, value); }

// GOOD: atomic check-and-act
map.entry(key).or_insert(value);
```

Rule: **Never check state and act on it without holding the same lock for both.**

---

## Send and Sync

- `T: Send` -- safe to move to another thread.
- `T: Sync` -- safe to share `&T` across threads.

Manual implementations of `Send`/`Sync` bypass the compiler's safety analysis. A
wrong impl can introduce undefined behavior that no amount of testing will reliably
catch. Write the proof first, then the `unsafe impl`:

```rust
// SAFETY: `MyHandle` contains a raw pointer that is exclusively owned by this
// struct. The pointer is never aliased outside `&mut self` methods. No interior
// mutation is accessible through `&self`.
unsafe impl Send for MyHandle {}
unsafe impl Sync for MyHandle {}
```

Types like `Rc<T>` and `RefCell<T>` are `!Send`. They cannot cross `.await` in
multi-threaded runtimes. Do not fight the compiler -- redesign to use `Arc<Mutex<T>>`
or restructure ownership.

---

## Anti-Patterns Checklist

| Anti-pattern | Fix |
|---|---|
| `Arc<Mutex<T>>` without justification | Channel-based design or owned data |
| `.unwrap()` on `lock()` | `.expect("reason")` or explicit poison handling |
| Sync lock held across `.await` | `tokio::sync::Mutex` or drop before await |
| Unbounded channels | Bounded with documented capacity |
| `Arc<RefCell<T>>` for cross-thread sharing | `Arc<Mutex<T>>` or channels |
| Two atomic ops for one logical operation | `compare_exchange` or Mutex |
| `SeqCst` without justification | Minimal sufficient ordering |
| No lock ordering documentation | Document at struct definition and crate root |
| Fire-and-forget `tokio::spawn` | Await or store the `JoinHandle` |
| Bare `AtomicBool` for shutdown | `CancellationToken` or `watch` |
