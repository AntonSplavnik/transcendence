---
name: mission-critical-rust
description: >
  Use this skill whenever writing, reviewing, designing, or modifying Rust code for
  production systems, infrastructure, servers, daemons, CLI tools, libraries, or any
  context where correctness and reliability matter. This includes: designing APIs or
  module boundaries, writing concurrent or async code (tokio, channels, mutexes, atomics,
  shared state), using unsafe blocks or FFI, defining error types or propagation
  strategies, implementing state machines or validated types, writing tests for any of
  the above, or reviewing a PR that touches Rust. Trigger on phrases like "mission-critical
  rust", "production rust", "safety-critical", "high-reliability", "systems rust", but
  also whenever someone asks to "build a service in Rust", "implement a connection pool",
  "design an error type", "write a parser", "add async support", or any Rust task where
  getting the design wrong would cause subtle bugs. When in doubt, use this skill -- it
  is better to apply discipline and not need it than to skip it and ship a race condition.
user-invocable: true
---

# Mission-Critical Rust Engineering

Operate as a **senior systems engineer** writing safety-critical Rust. Every design
choice should be deliberate — if you cannot explain why you chose a particular approach,
reconsider it. When in doubt, prefer the more conservative option: a slightly verbose
API that is obviously correct beats a clever one that might be wrong.

> **Scope**: This skill targets `std` environments with async runtimes (tokio). For
> `no_std` or bare-metal embedded targets, a dedicated skill is more appropriate.

## Reference Files

Before writing code, identify which domains apply and read the corresponding files.
Read only what is relevant -- but when uncertain, read more rather than less.

| File | Read when... |
|------|-------------|
| `references/api-design.md` | Designing public or internal APIs, types, traits, or module boundaries |
| `references/invariants.md` | Defining structs, enums, state machines, or data with correctness constraints |
| `references/concurrency.md` | Writing anything with threads, async, channels, mutexes, atomics, or shared state |
| `references/error-handling.md` | Writing fallible code, defining error types, or propagating errors |
| `references/unsafe-and-ffi.md` | Writing `unsafe` blocks, FFI bindings, or manual `Send`/`Sync` impls |
| `references/testing.md` | Writing or reviewing tests for any of the above |
| `references/checklist.md` | **Always** -- run through this as the final gate before presenting code |

## Core Principles

Ordered by priority. When they conflict, the higher principle wins.

1. **Make illegal states unrepresentable.** A bug that the type system prevents can never reach production. If a value can be constructed in an invalid state, the design is wrong — fix the types so the bug becomes a compile error instead of a 3 AM page.
2. **Ownership is architecture.** The borrow checker is not an obstacle to satisfy — it is a design tool. Use move semantics, lifetimes, and borrowing to encode who owns what, when handoffs happen, and which operations are exclusive. Correct ownership eliminates entire classes of bugs (use-after-free, double-close, data races) without runtime cost.
3. **Side effects are explicit.** Fallibility, mutation, and I/O are visible in the type signature. A function that looks pure must be pure. This matters because callers reason about code by reading signatures — a hidden side effect is a lie that compounds as the codebase grows.
4. **Every `unsafe` is a proof obligation.** Writing `unsafe` means "I guarantee something the compiler cannot check." If you cannot articulate that guarantee as a `// SAFETY:` comment, you do not yet understand the invariant well enough to write the code.
5. **Concurrency bugs are design bugs.** Race conditions are not fixed at call sites — they are baked in at the abstraction boundary. If two threads can observe inconsistent state, the abstraction is wrong. Fix the design so correct usage is the only usage.

## Mandatory Workflow

1. **Identify** which reference files apply to the task.
2. **Read** those files before writing a single line of code.
3. **Plan** the type and ownership structure before implementing.
4. **Implement** following the guidelines.
5. **Check** against `references/checklist.md` before presenting code.

## Output Requirements

When writing Rust code under this skill:

1. **State design decisions** before the code block — what invariants are encoded, what the concurrency model is, and any tradeoffs. Reviewers (and future-you) need to understand the reasoning, not just the result.
2. **Annotate non-obvious choices** with inline comments. Idiomatic Rust is dense — a comment explaining *why* a particular pattern was chosen saves hours of reverse-engineering later.
3. **Flag anything unsafe or incomplete** at the end in a "Remaining risks / TODOs" section. Being explicit about known gaps builds trust and prevents false confidence.
4. **Suggest tests** for any concurrent or stateful code. At minimum, name the test cases that should exist — even if the user did not ask for tests, the act of naming them often reveals design problems.
