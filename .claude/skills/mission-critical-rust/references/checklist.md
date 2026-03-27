# Pre-Submission Checklist

Run through every item before presenting code. A checked item is one you have
**verified**, not one you assume is true. An unchecked item is a known gap — flag
it explicitly so the reviewer knows what still needs attention.

---

## API Surface

- [ ] No `bool` parameters on public APIs -- use enums.
- [ ] No multiple parameters of the same primitive type -- use newtypes.
- [ ] All fallible constructors return `Result`, not a silently invalid value.
- [ ] `#[must_use]` on all types and functions whose return value must not be ignored.
- [ ] Public surface is minimal -- `pub(crate)` or `pub(super)` preferred over `pub`.
- [ ] Builder pattern for types with 3+ optional fields.
- [ ] Typestate pattern considered for any protocol with ordered steps.
- [ ] `#[non_exhaustive]` on public enums and structs that may evolve.
- [ ] No function with more than 5 parameters -- use a config struct or builder.

## Invariants

- [ ] Every struct with a validity constraint has private fields and a validated constructor.
- [ ] Every invariant is documented in a `# Invariants` doc section.
- [ ] No `Default` impl produces a logically invalid value.
- [ ] State machines use enums, not boolean flags.
- [ ] Validation at the boundary; trusted types are not re-validated internally.

## Concurrency

- [ ] No `std::sync::MutexGuard` held across an `.await` point.
- [ ] Lock ordering documented on every struct with multiple locks and at crate root.
- [ ] No unbounded channels without explicit justification.
- [ ] Every atomic operation uses the minimal sufficient memory ordering, documented.
- [ ] No two atomic operations composing one logical transaction -- use a mutex.
- [ ] Cancellation safety documented for async functions modifying shared state.
- [ ] No `Arc<RefCell<T>>` for cross-thread sharing.
- [ ] Every `.lock()` uses `.expect("reason")` or handles poison explicitly.
- [ ] Every `JoinHandle` is awaited, stored, or dropped with a comment.
- [ ] Shutdown uses `CancellationToken` or `watch`, not bare `AtomicBool`.
- [ ] Blocking I/O and CPU-heavy work offloaded via `spawn_blocking`, not run on the async runtime.
- [ ] Every `tokio::spawn` documents: what the task owns, how it terminates, how it is joined.

## Error Handling

- [ ] No `.unwrap()` outside of tests.
- [ ] Every `.expect()` message explains *why* the invariant holds, not what failed.
- [ ] Every error variant is actionable -- the caller can respond differently per variant.
- [ ] Library code: `thiserror` with structured error enums.
- [ ] Application code: `anyhow` with `.context()` at every `?` site.
- [ ] No silently swallowed errors -- `let _ = fallible()` has a comment.
- [ ] No double-logging -- errors logged at the boundary, not at every level.
- [ ] `?` operator used instead of manual `match`-and-rewrap where applicable.

## Unsafe and FFI

- [ ] Every `unsafe` block has a `// SAFETY:` comment (a proof, not a description).
- [ ] Every `unsafe fn` has a `# Safety` doc section with caller obligations.
- [ ] Every `unsafe impl` has a `# Safety` doc section proving soundness.
- [ ] Minimal code inside each `unsafe` block.
- [ ] `unsafe` not used as a performance shortcut where a safe alternative exists.
- [ ] Every `extern "C"` function wraps its body in `catch_unwind`.
- [ ] All FFI structs use `#[repr(C)]` or `#[repr(transparent)]`.
- [ ] No Rust-specific types (`String`, `Vec`, `Result`) cross the FFI boundary.
- [ ] `CString` outlives any pointer derived from it.

## Testing

- [ ] Every public function has tests, including documented error cases.
- [ ] Every documented invariant has at least one test exercising the boundary.
- [ ] Concurrent code tested under contention, not just sequentially.
- [ ] `unsafe` code tested under `miri` (where possible).
- [ ] Cancellation paths tested -- dropped futures leave consistent state.
- [ ] Test names follow `test_<unit>_<scenario>_<expected_outcome>`.
- [ ] Tests are isolated -- no shared global state.

## Documentation

- [ ] Every `pub` item has a doc comment.
- [ ] Every function returning `Result` has a `# Errors` section.
- [ ] Every function that can panic has a `# Panics` section.
- [ ] Every `unsafe fn` has a `# Safety` section.
- [ ] Every type with non-obvious invariants has a `# Invariants` section.
- [ ] Every module has `//!` documentation explaining its purpose.
- [ ] Lock ordering documented on all structs with multiple locks.
- [ ] Examples present for non-trivial public APIs (doc tests pass `cargo test`).

## Code Quality

- [ ] `cargo clippy --all-targets --all-features` passes with zero warnings.
- [ ] `cargo fmt` applied.
- [ ] No `#[allow(...)]` without a comment explaining why.
- [ ] No commented-out code.
- [ ] No `println!` / `eprintln!` outside tests and main -- use `tracing::*`.
- [ ] Sensitive values not logged or included in `Debug` impls.
- [ ] No wildcard imports except `use super::*` in test modules.

## Type System Hygiene

- [ ] Bare primitives not used for domain values where newtypes prevent confusion.
- [ ] `Option<bool>` not used where a three-variant enum is clearer.
- [ ] Error types do not use `String` in library code.
- [ ] `From` / `TryFrom` implemented for newtypes at their validation boundary.
- [ ] No `clone()` in hot paths without a comment.
- [ ] `Arc::clone(&x)` spelling used instead of `x.clone()` on `Arc` values.

## Resource Management

- [ ] Drop order is correct and documented when it matters.
- [ ] Resources requiring cleanup are wrapped in types implementing `Drop` (RAII).
- [ ] No manual cleanup that the caller must remember to call.
