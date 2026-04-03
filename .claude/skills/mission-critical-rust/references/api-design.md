# API Design

The public surface of a module is a promise. Every `pub` item is a commitment that
constrains future evolution. Design APIs so correct usage is the path of least
resistance and incorrect usage does not compile.

## Table of Contents

1. [Make Illegal States Unrepresentable](#make-illegal-states-unrepresentable)
2. [Newtype Pattern](#newtype-pattern)
3. [Builder Pattern](#builder-pattern)
4. [Public Surface Rules](#public-surface-rules)
5. [Function Signature Rules](#function-signature-rules)
6. [Anti-Patterns](#anti-patterns)

---

## Make Illegal States Unrepresentable

### Typestate Pattern

Use phantom type parameters to enforce state-machine protocols at compile time.
Use when there is a required ordering of operations and misuse would cause data
corruption, security issues, or hard-to-debug runtime errors.

```rust
use std::marker::PhantomData;

pub struct Unconnected;
pub struct Connected;
pub struct Authenticated;

pub struct Session<State> {
    inner: SessionInner,
    _state: PhantomData<State>,
}

impl Session<Unconnected> {
    pub fn connect(self, addr: SocketAddr) -> Result<Session<Connected>, ConnectError> { ... }
}

impl Session<Connected> {
    pub fn authenticate(self, creds: Credentials) -> Result<Session<Authenticated>, AuthError> { ... }
}

impl Session<Authenticated> {
    pub fn send(&mut self, req: Request) -> Result<Response, SendError> { ... }
}
// Session<Unconnected>::send() does not exist -- compile error.
```

### Enums for Exclusive States

```rust
// BAD: boolean flags with invalid combinations
struct Transfer { pending: bool, completed: bool }  // pending && completed = invalid but representable

// GOOD: exactly the valid states
enum TransferState {
    Pending,
    Completed { timestamp: SystemTime },
    Failed { reason: TransferError },
}
```

### `NonZero*` Types

```rust
use std::num::NonZeroUsize;

// BAD: 0 is invalid but representable
fn spawn_workers(count: usize) { ... }

// GOOD: 0 is unrepresentable
fn spawn_workers(count: NonZeroUsize) { ... }
```

---

## Newtype Pattern

Bare primitives carry no semantic meaning — a function taking `(u64, u64, u64)` for
`(user_id, session_id, timeout_ms)` compiles fine when arguments are swapped, turning
a typo into a production incident. Newtypes make the compiler catch these mistakes.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct UserId(u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct DurationMs(u64);

impl DurationMs {
    pub fn new(ms: u64) -> Self { Self(ms) }
    pub fn as_millis(self) -> u64 { self.0 }
}
```

Use newtypes for: IDs, quantities with units, strings with format constraints,
file descriptors, and handles — anywhere two values of the same primitive type could
be confused. Validate at construction for constrained values:

```rust
pub struct Port(u16);

impl Port {
    /// # Errors
    /// Returns `InvalidPort` if `value` is 0.
    pub fn new(value: u16) -> Result<Self, InvalidPort> {
        if value == 0 { return Err(InvalidPort(value)); }
        Ok(Self(value))
    }
}
```

---

## Builder Pattern

Use when a type has 3+ optional parameters or when some parameter combinations are invalid.

```rust
pub struct ServerConfigBuilder {
    bind_addr: Option<SocketAddr>,
    max_connections: NonZeroUsize,
    tls: Option<TlsConfig>,
}

impl ServerConfigBuilder {
    pub fn new() -> Self {
        Self {
            bind_addr: None,
            // 1024 is a known nonzero constant
            max_connections: NonZeroUsize::new(1024).expect("1024 is nonzero"),
            tls: None,
        }
    }

    pub fn bind(mut self, addr: SocketAddr) -> Self { self.bind_addr = Some(addr); self }
    pub fn tls(mut self, cfg: TlsConfig) -> Self { self.tls = Some(cfg); self }

    /// # Errors
    /// Returns `ConfigError::MissingBindAddr` if `bind` was never called.
    pub fn build(self) -> Result<ServerConfig, ConfigError> {
        Ok(ServerConfig {
            bind_addr: self.bind_addr.ok_or(ConfigError::MissingBindAddr)?,
            max_connections: self.max_connections,
            tls: self.tls,
        })
    }
}
```

Builder methods consume `self` and return `Self` (enabling chained calls). Required
fields return `Err` from `build()` rather than panicking — the caller can recover or
provide a better error message. Provide sensible defaults for optional fields so
common cases require minimal configuration.

---

## Public Surface Rules

### Boolean Parameters -- Forbidden on Public APIs

```rust
// BAD -- what does `true` mean at the call site?
fn flush(force: bool) { ... }

// GOOD -- self-documenting and extensible
pub enum FlushMode { Lazy, Force }
fn flush(mode: FlushMode) { ... }
```

### `#[must_use]` on Results and Handles

Apply to every type whose value the caller must not silently ignore:

```rust
#[must_use = "dropping a JoinHandle detaches the task; call .await or .abort()"]
pub struct TaskHandle<T> { ... }

#[must_use = "the lock may not have been acquired"]
pub fn try_lock(&self) -> Option<Guard<'_>> { ... }
```

### Minimize Exposure

Prefer `pub(crate)` or `pub(super)` over `pub`. If something is truly internal,
make it private. Use `#[doc(hidden)]` sparingly -- prefer true privacy.

### No `#[non_exhaustive]`

This is a binary only, not a sharable library. We control all call sites and can update them together with new enum variants.

### Sealed Traits

Traits used for internal dispatch that must not be implemented by external callers:

```rust
mod private { pub trait Sealed {} }

pub trait Backend: private::Sealed {
    fn execute(&self, query: Query) -> Result<Rows, DbError>;
}

impl private::Sealed for PostgresBackend {}
impl Backend for PostgresBackend { ... }
```

---

## Function Signature Rules

### Input Types: Accept the Most General Form

| Instead of | Accept |
|---|---|
| `String` | `&str` or `impl Into<String>` |
| `Vec<T>` | `&[T]` or `impl IntoIterator<Item = T>` |
| `PathBuf` | `&Path` or `impl AsRef<Path>` |

### Output Types: Return the Most Specific Form

Return concrete types, not `impl Trait`, from constructors. Never return
`Box<dyn Error>` from library code.

### Parameter Count

Beyond 5 parameters, call sites become hard to read and easy to get wrong — especially
when multiple parameters share a type. Use a config struct or builder instead.

### Function Size and Responsibility

A function does one thing. If you need "and" to describe it, split it. This is not
about line counts for their own sake — it is about testability and comprehension. A
function that does one thing has one reason to fail, one set of preconditions, and
one place to add a test.

Target ~30 lines for non-trivial functions, ~10 for pure functions. Functions
exceeding 60 lines deserve scrutiny — they usually contain an extractable subroutine.

Prefer early returns to reduce nesting. Deep indentation (3+ levels) often signals
that a function is handling too many concerns.

---

## Anti-Patterns

| Anti-pattern | Fix |
|---|---|
| `bool` parameter on public API | Dedicated enum |
| Multiple parameters of the same primitive type | Newtypes |
| `fn new() -> Self` that can produce invalid state | Return `Result<Self, E>` |
| `pub` fields on invariant-bearing structs | Private fields + accessor methods |
| Wildcard imports outside test modules | Explicit imports |
| Sentinel values (`-1` for not found, `0` for unset) | `Option<T>` or dedicated variant |
