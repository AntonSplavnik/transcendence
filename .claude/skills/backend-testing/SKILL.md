---
name: backend-testing
description: Write integration and unit tests for the Transcendence Rust backend (Salvo + Diesel SQLite). Use when asked to create, extend, audit, or fix backend tests, or when reviewing backend code for correctness and security. Covers the mock infrastructure (Server, ApiClient, User typestate), test conventions, mandatory coverage rules, and code audit workflow.
---

# Backend Testing

Write integration and unit tests for a Rust backend built on Salvo and Diesel
(SQLite). The project has a custom mock layer in `crate::utils::mock` that wraps
Salvo's test API with cookie management, user typestates, and per-test DB
isolation. Read the mock source code (`src/utils/mock/`) before writing your
first test.

## Workflow

1. Run `cargo test` — read existing test names, structure, and gaps.
2. Read the code you are about to test **thoroughly**.
3. While reading, **audit** the code ([see below](#code-audit)).
4. Write tests following the rules in this document.
5. Run `cargo test` — every test must pass.

---

## Integration tests

Integration tests exercise HTTP endpoints through the real router with an
in-memory database. They live under the relevant module's `tests/` sub-folder
(e.g. `src/auth/tests/`, `src/avatar/tests/`), one file per concern.

### Mock module imports

Always import the module, never glob:

```rust
use crate::utils::mock;
// then: mock::Server, mock::User, mock::Registered, etc.
```

This prevents name collisions with production types (e.g. `models::User`).

### Server setup

Each test creates its own isolated server (in-memory SQLite + full router):

```rust
let server = mock::Server::default();
```

### User typestate

```
User<Unregistered>  ──register()──▸  User<Registered>
```

`register()` consumes the unregistered user and returns a registered one whose
`ApiClient` already holds valid session + JWT cookies.

### Ergonomic method convention

For every tested endpoint, add **two** `impl` methods on `mock::User`:

| Variant | Purpose | Naming |
|---------|---------|--------|
| **asserting** | Asserts 200, deserializes into the real response struct, returns it | verb/noun: `me()`, `logout()` |
| **non-asserting** | Returns raw `salvo::Response` for error-path tests | `try_` prefix: `try_me()`, `try_logout()` |

Place the `impl` block in the **same test file** as the endpoint's tests. In
Rust the impl is visible crate-wide; co-location is a readability convention.

### Standard preamble

```rust
use crate::utils::mock;
use salvo::http::StatusCode;
use salvo::test::ResponseExt; // if using .take_json() / .take_string()
```

### File layout

```rust
// ── Ergonomic helpers on mock::User ───────────────────────────────
impl mock::User<mock::Registered> { … }

// ── Helpers ───────────────────────────────────────────────────────
fn helper_fn() { … }

// ── Tests ─────────────────────────────────────────────────────────
#[tokio::test]
async fn happy_path() { … }
// error / edge-case tests, ordered least → most complex
```

### Test module placement

| Source layout | Where tests go |
|---------------|----------------|
| Module folder (e.g. `auth/`) | `auth/tests/` sub-folder with `mod.rs` + one file per concern. Parent `mod.rs` adds `#[cfg(test)] mod tests;`. |
| Single file (e.g. `validate.rs`) | `#[cfg(test)] mod tests { … }` at the file bottom. |

### `ApiClient` cookie handling

`send()` automatically merges `Set-Cookie` deltas back into the client's jar,
so subsequent requests carry updated cookies. Use `client.unauthenticated()`
for a cookie-free clone on the same server.

---

## Mandatory coverage (integration tests)

Every endpoint **must** have at least:

| Test category | When it applies |
|---------------|-----------------|
| Happy path | Always |
| Unauthenticated → 401 | Behind an auth guard |
| Wrong password → 401 | Accepts a password field |
| MFA interaction | Calls `check_password_and_mfa_if_enabled` |
| Validation boundaries | Validates input fields |
| Invalid state transitions | State-dependent logic |
| Sensitive field leakage | Returns user data |

If an endpoint exists in the router but has **zero** tests, that is a bug.
Add tests in the same PR as the endpoint.

### Unauthenticated access

```rust
user.assert_requires_auth(|c| c.get("/api/user/me")).await;
```

Sends from a fresh unauthenticated client, asserts 401.

### Wrong password

Supply a fully valid request except `password` is wrong. Assert 401.

### MFA interaction (when 2FA is enabled)

For every endpoint that verifies MFA:
- Missing `mfa_code` → 401
- Wrong `mfa_code` → 401
- Valid `mfa_code` → success

### Validation boundaries

For fields with min/max constraints:

```
value = below_min → 400
value = exact_min → 200
value = exact_max → 200
value = above_max → 400
```

Also cover format violations, empty values, and disallowed characters.
One test per distinct validation rule.

### Invalid state transitions

Test that impossible states are rejected:
- Enabling something already enabled → error
- Confirming without starting → error
- Disabling something not enabled → error
- Double-logout → 401

### Sensitive field leakage

Verify `#[serde(skip)]` fields don't appear in responses:

```rust
assert!(!body.contains("password_hash"), "must not leak password_hash");
```

### Mutation side-effect verification

Verify the effect **and its inverse** via follow-up requests:
- After password change: new password works, old one fails.
- After logout: protected endpoints return 401.

---

## Request / response typing

**Always use production structs**, never `serde_json::json!{}`:

```rust
// ✅
let body = SomeInput { field: value };
let req = client.post(path).json(&body);

// ❌
let body = serde_json::json!({ "field": value });
```

Add `#[derive(Serialize)]` to input structs if missing.

Deserialize responses via `res.take_json::<T>()` into the real response struct.
Never parse into `serde_json::Value`.

> **Why?** When a struct gains a field or is renamed, `json!` tests silently
> send stale payloads. The compiler catches mismatches with real structs.

---

## Status code assertions

Compare with the `StatusCode` enum, never raw integers. Always include a
descriptive message explaining the **business rule**:

```rust
assert_eq!(res.status_code, Some(StatusCode::CONFLICT),
    "duplicate email must be rejected with 409");
```

---

## Test naming

Pattern: **`<noun>_<scenario>[_<outcome>]`**

| Category | Example |
|----------|---------|
| Happy path | `register_succeeds` |
| Rejection | `register_short_password_rejected` |
| Auth failure | `login_wrong_password_unauthorized` |
| Edge case | `recovery_code_single_use` |

Suffixes mirror the expected outcome: `_succeeds`, `_rejected`, `_unauthorized`,
`_conflict`, etc. No `test_` prefix.

---

## Unit tests

Target **pure or near-pure functions** that don't need a database or HTTP
server.

### Placement

`#[cfg(test)] mod tests { … }` at the bottom of the source file. Do **not**
create separate test files for unit tests.

### `#[test]`, not `#[tokio::test]`

Unit tests are synchronous. Reserve `#[tokio::test]` for integration tests.

### One assertion per logical scenario

Multiple `assert!` calls are fine for facets of the same outcome, but split
separate scenarios into separate tests.

### Boundary values

Same pattern as integration tests: below-min, exact-min, exact-max, above-max,
typical valid.

### Round-trip tests

For encode/decode, encrypt/decrypt, serialize/deserialize pairs — always write
a round-trip test. Also test that cross-user / cross-key decryption fails.

### Randomness

Assert on properties (length, uniqueness, valid encoding), not exact values.

### Edge cases for parsers / validators

Include: empty input, all-whitespace, unicode/non-ASCII, extremely long input,
embedded null bytes.

### Security-sensitive negative tests

For cryptographic / auth logic, explicitly test rejection of: wrong key, wrong
user-id, tampered ciphertext, wrong password hash, expired tokens.

### Descriptive assertions

```rust
assert_eq!(result, expected, "description of what failed");
```

### No side effects

No filesystem, no network, no test-order dependency. Only exception:
`std::sync::Once` for one-time env setup (e.g. encryption keys).

### Priority order

1. Security-critical (encryption, hashing, token validation)
2. Complex pure logic (multi-branch validators, codec framing)
3. Data type invariants (round-trips, length enforcement)
4. Utility functions (buffers, caches)

Skip: one-liner pass-throughs, anything needing `DbConn` or Salvo handlers
(use integration tests).

---

## 2FA test setup

TOTP encryption requires the `TOTP_ENC_KEY` env var. A `ensure_totp_key()`
helper (using `std::sync::Once`) exists in the 2FA test module — call it
before invoking any 2FA endpoint. Use `generate_totp_code(base32_secret)`
to generate valid codes.

---

## Code audit

Writing tests requires reading code in depth — **audit simultaneously.**

| Check for | Examples |
|-----------|----------|
| Logic errors | Off-by-one, wrong operator, missing branch |
| Security | Missing auth guard, unsanitized input, leaked secrets |
| Missing validation | Nonsensical input accepted, unbounded collections |
| Error handling | Swallowed errors, generic 500s, panics on user input |
| Performance | N+1 queries, unbounded `.load()`, missing indices |
| UX | Confusing error messages, inconsistent status codes |
| Code quality | Dead code, duplicated logic, unclear naming |
| Design issues | Tight coupling, leaky abstractions, missing encapsulation |

**Minor** findings → note and continue writing tests.
**Significant** findings → stop and report to the user before proceeding.

---

## General principles

- **Be thorough.** Cover happy paths, validation rejections, auth failures,
  duplicate-resource conflicts, and cross-session interactions.
- **Prefer composition.** Call ergonomic methods from other test modules
  (`register()`, `login()`, etc.) rather than duplicating request construction.
- **Keep assertions precise.** Assert on status codes *and* typed response
  payloads.
- **No test interdependence.** Every test must be self-contained and runnable
  in any order or in parallel.
