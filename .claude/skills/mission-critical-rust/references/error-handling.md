# Error Handling

In mission-critical systems, errors are normal operation. Every error must be typed,
actionable, propagated without information loss, and handled at the correct layer.

---

## The `unwrap` / `expect` Rule

```
unwrap()     -- not used in non-test code. An unwrap that fails in production gives
                the operator zero context about what went wrong or why it was
                assumed safe. Use expect() with a reason instead.
expect(msg)  -- for invariant violations that represent programmer error (not runtime
                error). The message explains WHY the condition is guaranteed to hold,
                so a future reader understands the assumption without tracing the logic.
?            -- default propagation. Add .context() when the call site adds useful
                information that the error itself does not carry.
match        -- when you need per-variant handling.
```

```rust
// BAD: no information on failure
let val = map.get(&key).unwrap();

// BAD: describes what, not why
let val = map.get(&key).expect("key must exist");

// GOOD: explains the invariant
let val = map.get(&key)
    .expect("'key' is inserted during init in Config::new and the map is never mutated");

// GOOD: propagation with context
let val = map.get(&key)
    .ok_or_else(|| anyhow!("expected '{key}' in config map"))
    .context("loading session configuration")?;
```

---

## Error Type Design

### Library Code: `thiserror`

```rust
#[derive(Debug, thiserror::Error)]
pub enum ConnectionError {
    #[error("connection refused by {addr}")]
    Refused { addr: SocketAddr },

    #[error("TLS handshake failed: {reason}")]
    TlsHandshake { reason: String },

    #[error("timeout after {elapsed:?}")]
    Timeout { elapsed: Duration },

    #[error("I/O error")]
    Io(#[from] io::Error),
}
```

Design rules:
- Every variant should be **actionable** — the caller can respond differently per variant.
  If all variants result in the same handler, they are not providing useful discrimination
  and should be merged.
- Include context in the error (address, duration, missing key) so the operator can
  diagnose problems from logs alone, without a debugger.
- Avoid `String` as an error type in library code — it destroys the caller's ability to
  pattern-match and handle errors programmatically.
- Use `#[from]` sparingly — automatic conversion erases the context of where and why the
  error occurred. Named fields that wrap the source preserve that context.
- Avoid `Box<dyn Error>` in library public APIs — callers lose the ability to match on
  specific error variants, which forces them into string-parsing or catch-all handling.

### Application Code: `anyhow`

```rust
use anyhow::{Context, Result};

fn load_config(path: &Path) -> Result<Config> {
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read config at {}", path.display()))?;
    let config: Config = toml::from_str(&text)
        .with_context(|| format!("failed to parse config at {}", path.display()))?;
    Ok(config)
}
```

Use `.context()` to add a human-readable layer. Use `.with_context(|| ...)` when the
context string is expensive to produce (it avoids allocation on the success path).

Keep `anyhow` for application code (binaries, CLI tools, top-level orchestration).
Library code should use `thiserror` with structured enums instead, because library
callers need to match on specific variants — `anyhow::Error` strips that capability.

---

## Error Propagation

### Prefer `?` Over Manual Matching

```rust
// VERBOSE: manual re-wrapping
fn process(path: &Path) -> Result<Data, ProcessError> {
    match std::fs::read(path) {
        Ok(bytes) => match parse(&bytes) {
            Ok(data) => Ok(data),
            Err(e) => Err(ProcessError::Parse(e)),
        },
        Err(e) => Err(ProcessError::Io(e)),
    }
}

// CORRECT: let From impls and ? do the work
fn process(path: &Path) -> Result<Data, ProcessError> {
    let bytes = std::fs::read(path)?;
    let data = parse(&bytes)?;
    Ok(data)
}
```

### Don't Swallow Errors

Every `Err` must be returned, logged, or explicitly handled. Never silently discard:

```rust
// BAD: error silently ignored
let _ = cleanup_temp_files();

// GOOD: if intentionally discarded, log and comment
if let Err(e) = cleanup_temp_files() {
    tracing::warn!("failed to clean up temp files: {e:#}");
}

// GOOD: if truly fire-and-forget, comment why
// Failure to send is non-fatal; the log buffer will flush at shutdown.
let _ = log_tx.try_send(LogEvent::RequestReceived { id });
```

### Recoverable vs Non-Recoverable

Every `?` is a decision: "this failure is unrecoverable at this level." Verify that
is true. If you can recover locally, do not propagate.

```rust
// BAD: cache miss terminates the whole operation
let data = read_cache(key)?;

// GOOD: cache miss is recoverable
let data = match read_cache(key) {
    Ok(d) => d,
    Err(CacheError::Miss) => fetch_from_origin(key).await?,
    Err(e) => return Err(e.into()),
};
```

---

## Error Boundaries

Define clear layers for where errors are handled vs propagated:

| Layer | Strategy |
|---|---|
| Core library / domain logic | Structured enums (`thiserror`), propagate with `?` |
| Service layer | Wrap domain errors, add request context |
| RPC / HTTP handler | Convert to status codes / error responses; log the original |
| Main / top-level | `anyhow::Error`, human-readable output, set exit code |

Never handle a recoverable error at the wrong layer. A `ConnectionError::Timeout`
should be retried at the service layer, not logged-and-ignored at the domain layer.

---

## Panic Discipline

Panics are for **programmer errors** — violated invariants that should never occur
if the code is correct. They are not for runtime errors (network failure, bad input,
resource exhaustion), because runtime errors are expected in production and callers
need a chance to recover.

Acceptable panics:
- Mutex poison (prior panic corrupted state — unrecoverable).
- `expect()` on compile-time-known values (`NonZeroUsize::new(1024).expect("nonzero")`).
- Initialization that truly cannot proceed (missing required config at startup).

In library code, panicking on malformed input is a correctness and security risk — the
caller has no way to recover, and an attacker who controls the input controls the crash.
Return `Result` instead.

Only catch panics (`catch_unwind`) at true isolation boundaries: task runners,
FFI boundaries, test harnesses. Using `catch_unwind` to paper over your own bugs
masks the root cause and often leaves state inconsistent.

---

## Logging Errors

Use `tracing` for structured logging. Never log the same error at multiple levels.

```rust
// BAD: logged here AND at the caller -- double-logging
fn fetch_data(id: u64) -> Result<Data, FetchError> {
    let result = db.query(id);
    if let Err(ref e) = result { tracing::error!("fetch failed: {e}"); }
    result
}

// GOOD: propagate with context; let the boundary layer log
fn fetch_data(id: u64) -> Result<Data, FetchError> {
    db.query(id).map_err(|e| FetchError::Database { id, source: e })
}

// At the boundary:
match fetch_data(id) {
    Ok(data) => handle(data),
    Err(e) => {
        tracing::error!(request_id = %req_id, error = %e, "fetch failed");
        return Err(to_response_error(e));
    }
}
```

Use `{e:#}` (alternate format) to print the full error chain with `.source()` causes.

---

## Documentation

Every public fallible function must document its errors:

```rust
/// Loads configuration from the given path.
///
/// # Errors
///
/// - `ConfigError::NotFound` -- file does not exist.
/// - `ConfigError::PermissionDenied` -- cannot read file.
/// - `ConfigError::ParseError` -- invalid TOML.
/// - `ConfigError::ValidationFailed` -- required field missing or out of range.
pub fn load(path: &Path) -> Result<Config, ConfigError> { ... }
```

Functions that can panic must have a `# Panics` section. See `unsafe-and-ffi.md`
for `# Safety` documentation requirements.
