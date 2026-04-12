# Testing

In mission-critical systems, untested code is untrustworthy code. Tests are not
afterthoughts — they verify that invariants hold, error paths are correct, and
concurrent code behaves under contention.

## Table of Contents

1. [What Must Be Tested](#what-must-be-tested)
2. [Naming Convention](#naming-convention)
3. [Test Isolation](#test-isolation)
4. [Concurrency Testing with loom](#concurrency-testing-with-loom)
5. [Undefined Behavior Detection with miri](#undefined-behavior-detection-with-miri)
6. [Property-Based Testing with proptest](#property-based-testing-with-proptest)
7. [Fuzzing with cargo-fuzz](#fuzzing-with-cargo-fuzz)
8. [Cancellation Testing](#cancellation-testing)
9. [Doc Tests as Specifications](#doc-tests-as-specifications)
10. [Compiler and Lint Configuration](#compiler-and-lint-configuration)

---

## What Must Be Tested

- Every public function, including all documented error cases.
- Every documented invariant -- at least one test that exercises the boundary.
- Every `unsafe` block -- test the boundary conditions of the safety contract.
- Every concurrent primitive -- test under contention, not just sequentially.
- Cancellation paths -- ensure cancelled futures leave state consistent.
- FFI functions -- test with valid and invalid inputs from the C perspective.

---

## Naming Convention

A good test name tells you what broke without opening the file. When a CI run fails
at 2 AM, `test_pool_acquire_when_exhausted_blocks_until_release` points you straight
to the problem; `test_pool_3` does not.

```
test_<unit>_<scenario>_<expected_outcome>
```

```rust
#[test]
fn test_pool_acquire_when_exhausted_blocks_until_release() { ... }

#[test]
fn test_connection_send_after_close_returns_error() { ... }

#[test]
fn test_config_load_missing_required_field_returns_validation_error() { ... }

#[test]
fn test_redis_key_try_from_empty_bytes_returns_empty_error() { ... }
```

The name must tell you what failed without reading the test body.

---

## Test Isolation

Tests that share global state produce flaky results — they pass when run alone but
fail (or worse, silently corrupt) when run in parallel. Each test should own its
own resources.

```rust
#[tokio::test]
async fn test_session_expires_after_ttl() {
    tokio::time::pause(); // deterministic time
    let session = Session::new(Duration::from_secs(60));
    assert!(session.is_valid());
    tokio::time::advance(Duration::from_secs(61)).await;
    assert!(!session.is_valid());
}
```

Rules:
- Use `tokio::test` for async tests (single-threaded runtime unless explicitly
  testing multi-threaded behavior).
- Use `tokio::time::pause()` for timing-dependent tests -- never `thread::sleep`.
- Use `tempfile::tempdir()` for filesystem tests.
- No shared `static` test state. If unavoidable, use `std::sync::Once` or a mutex.

---

## Concurrency Testing with `loom`

`loom` exhaustively explores all possible thread interleavings. Essential for
lock-free algorithms and custom synchronization primitives.

```rust
#[cfg(loom)]
mod loom_tests {
    use loom::sync::Arc;
    use loom::sync::atomic::{AtomicUsize, Ordering};
    use loom::thread;

    #[test]
    fn test_counter_is_linearizable() {
        loom::model(|| {
            let counter = Arc::new(AtomicUsize::new(0));
            let c1 = Arc::clone(&counter);
            let c2 = Arc::clone(&counter);

            let t1 = thread::spawn(move || { c1.fetch_add(1, Ordering::SeqCst); });
            let t2 = thread::spawn(move || { c2.fetch_add(1, Ordering::SeqCst); });

            t1.join().expect("t1 panicked");
            t2.join().expect("t2 panicked");
            assert_eq!(counter.load(Ordering::SeqCst), 2);
        });
    }
}
```

Use `loom` for: atomic operations, lock-free queues, custom mutexes, any
hand-rolled synchronization. Not needed for standard `Mutex`/`channel` usage.

---

## Undefined Behavior Detection with `miri`

Run `cargo +nightly miri test` on any crate containing `unsafe` code. Miri
detects: use-after-free, uninitialized reads, out-of-bounds access, invalid
pointer arithmetic, and violations of Stacked Borrows.

```bash
# Run all tests under miri
cargo +nightly miri test

# Run a specific test
cargo +nightly miri test test_header_from_bytes
```

Miri limitations: no FFI, no inline assembly, no filesystem I/O. Structure
unsafe code so the core logic can be tested under miri even if the FFI wrapper
cannot.

---

## Property-Based Testing with `proptest`

For invariant-bearing types, generate random inputs and verify the invariant holds:

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn bounded_window_invariant_holds_after_push(
        values in prop::collection::vec(0.0f64..1000.0, 1..100),
        new_value in 0.0f64..1000.0,
    ) {
        let capacity = NonZeroUsize::new(50).expect("50 is nonzero");
        let mut window = BoundedWindow::new(&values[..values.len().min(50)], capacity)
            .expect("values are finite and non-empty");
        window.push(new_value).expect("new_value is finite");
        // Invariant: sum equals actual sum of values
        let actual_sum: f64 = window.values().sum();
        prop_assert!((window.sum() - actual_sum).abs() < f64::EPSILON * 100.0);
        // Invariant: length <= capacity
        prop_assert!(window.len() <= capacity.get());
    }
}
```

Use `proptest` for: newtypes with validation, serialization round-trips,
algebraic properties (commutativity, associativity), state machine models.

---

## Fuzzing with `cargo-fuzz`

For parsers, deserializers, and any code that processes untrusted input:

```bash
cargo install cargo-fuzz
cargo fuzz init
cargo fuzz add parse_message
```

```rust
// fuzz/fuzz_targets/parse_message.rs
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // Must not panic on any input. Errors are fine.
    let _ = my_crate::parse_message(data);
});
```

Run for at least a few minutes before declaring "no issues found."

---

## Cancellation Testing

Verify that dropping a future mid-operation does not corrupt state:

```rust
#[tokio::test]
async fn test_send_message_cancel_safety() {
    let (mut client, mut server) = tokio::io::duplex(1024);

    let msg = Message::new(b"test payload");

    // Cancel after a short timeout -- simulates select! cancellation
    let result = tokio::time::timeout(
        Duration::from_millis(1),
        send_message(&mut client, &msg),
    ).await;

    // Whether it completed or timed out, the stream must not be corrupted.
    // Verify by sending another message successfully.
    let msg2 = Message::new(b"follow-up");
    send_message(&mut client, &msg2).await
        .expect("stream must not be corrupted after cancellation");
}
```

---

## Doc Tests as Specifications

Doc examples compile and run via `cargo test`. They are both documentation and
regression tests.

```rust
/// Parses a comma-separated list of non-negative integers.
///
/// # Errors
///
/// - `ParseError::Empty` if `input` is empty.
/// - `ParseError::InvalidInteger` if any token is not a valid `u64`.
///
/// # Examples
///
/// ```
/// # use mylib::parse_list;
/// let result = parse_list("1,2,3").unwrap();
/// assert_eq!(result, vec![1, 2, 3]);
///
/// assert!(parse_list("").is_err());
/// assert!(parse_list("1,abc,3").is_err());
/// ```
pub fn parse_list(input: &str) -> Result<Vec<u64>, ParseError> { ... }
```

Write doc examples for all non-trivial public APIs. A failing doc test is both
a documentation bug and a code bug.

---

## Compiler and Lint Configuration

```rust
#![deny(warnings)]
#![deny(clippy::all)]
#![deny(clippy::pedantic)]
#![allow(clippy::must_use_candidate)]     // too noisy for internal fns
#![allow(clippy::missing_errors_doc)]     // enforce manually in public API review
```

- `cargo clippy --all-targets --all-features` must pass with zero warnings.
- `cargo fmt` is always applied. No manual formatting deviations.
- Never use `#[allow(...)]` without a comment explaining why the lint is wrong here.
- No `println!` or `eprintln!` in non-test, non-main code -- use `tracing::*`.
- Sensitive values (tokens, passwords, keys) must not appear in `Debug` impls.
