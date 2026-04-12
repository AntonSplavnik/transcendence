# Invariants

An invariant is a condition that must hold at all times for the system to be correct.
In mission-critical code, every invariant must be documented at its enforcement site
and, where possible, encoded in the type system.

---

## The Golden Rule

> **Validate at the boundary. Trust inside.**

Data from the outside (network, disk, IPC, FFI, user input) is untrusted. Validate
it before converting into internal types. Once inside the type system, never
re-validate what the type already guarantees.

---

## Documenting Struct Invariants

Every struct with correctness constraints must have a `# Invariants` doc section
and private fields.

```rust
/// A non-empty, null-byte-free byte buffer for use as a Redis key.
///
/// # Invariants
///
/// - `inner` is never empty (`inner.len() >= 1`).
/// - `inner` contains no null bytes (`0x00`).
///
/// Established in [`RedisKey::try_from`], maintained by private fields
/// and controlled mutators.
pub struct RedisKey {
    inner: Bytes,  // private -- no external mutation
}

impl TryFrom<Bytes> for RedisKey {
    type Error = RedisKeyError;

    fn try_from(b: Bytes) -> Result<Self, Self::Error> {
        if b.is_empty() { return Err(RedisKeyError::Empty); }
        if b.contains(&0x00) { return Err(RedisKeyError::ContainsNullByte); }
        Ok(RedisKey { inner: b })
    }
}
```

Rules:
- Fields are **private**. The invariant holds because no outside code can mutate them.
- Constructors return `Result`, never panic on invalid input.
- Do not implement `Default` if the default value would violate an invariant.

---

## State Machines -- Enums, Not Flags

Model states as enum variants, not boolean flags. Flags create invalid
combinations; enums make them unrepresentable.

```rust
// BAD: 2^3 = 8 combinations, only 4 are valid
struct Connection { is_connected: bool, is_authenticated: bool, is_tls: bool }

// GOOD: exactly the valid states
enum ConnectionState {
    Disconnected,
    Connected { peer_addr: SocketAddr },
    Authenticated { peer_addr: SocketAddr, principal: Principal },
    Secured { peer_addr: SocketAddr, principal: Principal, cert: Certificate },
}
```

For state machines with distinct method sets per state, combine with the typestate
pattern from `api-design.md`.

---

## Validity vs Well-Formedness

Distinguish two levels:

- **Well-formed**: Structural constraints (non-empty, positive, no null bytes).
  Checked at construction, encoded in the type. `UserId(42)` is well-formed.
- **Valid**: Semantically correct in context (user 42 exists in the database).
  Checked via fallible operations, never assumed by the type.

Keep validity constraints out of the type constructor — whether user 42 exists is a
database concern, not a type concern. Mixing the two makes construction require I/O,
which breaks testability and creates circular dependencies.

---

## Preserving Invariants Across Mutations

If a struct has invariants and needs mutation, use controlled mutators:

```rust
impl RedisKey {
    /// Appends `suffix` to this key.
    ///
    /// # Errors
    /// Returns `RedisKeyError::ContainsNullByte` if `suffix` contains `0x00`.
    pub fn append_suffix(&mut self, suffix: &[u8]) -> Result<(), RedisKeyError> {
        if suffix.contains(&0x00) { return Err(RedisKeyError::ContainsNullByte); }
        self.inner.extend_from_slice(suffix);
        Ok(())
    }
}
```

Never expose `&mut inner_field` directly. All mutation goes through methods that
re-validate the invariant.

---

## `debug_assert!` for Expensive Checks

Expensive invariant checks belong in `debug_assert!` -- they run in debug builds
and tests but vanish in release:

```rust
pub fn merge(&mut self, other: &Self) {
    debug_assert!(self.is_valid(), "merge called with invalid self: {self:?}");
    debug_assert!(other.is_valid(), "merge called with invalid other: {other:?}");
    // ... merge logic ...
    debug_assert!(self.is_valid(), "merge produced invalid result");
}
```

---

## Inline Invariant Comments

When the correctness of a statement depends on a non-obvious invariant, use
`// INVARIANT:` to distinguish from `// SAFETY:` (which is for `unsafe`):

```rust
fn get_head(&self) -> &T {
    // INVARIANT: `self.items` is non-empty; guaranteed by the constructor
    // (requires non-empty slice) and maintained by `push` (adds) and
    // `pop` (returns None before becoming empty).
    &self.items[0]
}
```

---

## Anti-Patterns

| Anti-pattern | Fix |
|---|---|
| `fn new() -> Self` that can produce invalid state | Return `Result<Self, E>` |
| `pub` fields on invariant-bearing structs | Private fields + accessors |
| `Default` producing a logically invalid "zero" state | Named constructor or no `Default` |
| Re-validating already-typed data inside business logic | Trust the type; validate at boundaries only |
| Storing "raw" and "validated" in the same type | Separate types: `RawInput` vs `ValidatedInput` |
| `is_started: bool, is_ready: bool` | Enum with explicit states |
