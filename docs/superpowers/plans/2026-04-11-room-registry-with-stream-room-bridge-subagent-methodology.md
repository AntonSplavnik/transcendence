# Room Registry With StreamRoom Bridge Subagent Methodology Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. This plan is for subagent-only execution. Do not implement inline in the controller session. Every code change, test change, rustdoc change, and review must come from fresh subagent tasks. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the room registry and `StreamRoom` bridge from `docs/superpowers/specs/2026-04-11-room-registry-spec-with-bridge.md` with correct concurrency behavior, identity safety under ULID reuse, and documentation that lets a reader understand the invariants directly from the code.

**Architecture:** Keep registry ownership, loading/publication logic, claim/finalization logic, reservation flows, identity machinery, and the concrete `RegistryLink` in `backend/src/stream/room_registry.rs`. Keep `LeaveDispatcher`, `LeaveReason`, `LeaveDisposition`, `MemberLeftResult`, `RoomProtocol` contract changes, and post-lock dispatch wiring in `backend/src/stream/stream_room.rs`. Preserve the spec boundary that the registry stays room-agnostic and `StreamRoom` stays registry-agnostic except for the `LeaveDispatcher` trait object.

**Tech Stack:** Rust 2024, Tokio, parking_lot, ahash, smallvec, ulid, thiserror, anyhow, existing `stream` tests under `backend/src/stream/tests/`.

---

## Scope Lock

- Source of truth is the spec at `docs/superpowers/specs/2026-04-11-room-registry-spec-with-bridge.md`.
- This plan defines execution methodology only. The executor must pull behavior from the spec itself, not from memory and not from prior draft plans.
- If an older draft plan exists and conflicts with this plan, the spec and this plan win.
- Do not add behavior that is outside the spec, even if it looks convenient while implementing.
- If the spec and the existing code conflict in a way that changes product behavior or leaves an ambiguity, stop and ask the user before proceeding.

## Read-First Context

- Read the full spec once before dispatching any implementation work.
- Read these repo files before decomposing tasks so prompts reference existing patterns instead of guesses:
- `backend/src/stream/stream_room.rs`
- `backend/src/stream/cancel.rs`
- `backend/src/stream/mod.rs`
- `backend/src/stream/tests/room.rs`
- `backend/src/stream/tests/test_utils.rs`
- Keep `docs/superpowers/specs/2026-04-11-room-registry-spec-with-bridge.md` open while coordinating work. Every implementer and reviewer prompt must receive the exact spec sections relevant to the current task.

## File Map

- Create `backend/src/stream/room_registry.rs`
- Modify `backend/src/stream/stream_room.rs`
- Modify `backend/src/stream/mod.rs`
- Modify `backend/src/stream/tests/mod.rs`
- Create `backend/src/stream/tests/room_registry.rs`
- Create `backend/src/stream/tests/bridge_integration.rs`
- Modify `backend/src/stream/tests/room.rs`

## High-Risk Areas

- Do not let the registry call into room code or hold the registry lock while room locks are held. The spec's no-lock-nesting rule is load-bearing, not advisory.
- Do not let stale captured work mutate a new incarnation of the same ULID. `ClaimGuard`, `RegistryLink`, and every delayed registry mutation must use captured incarnations and `_if_matches` methods where the spec requires them.
- Do not conflate real leave paths with join rollback paths. `on_member_left` is for real leaves only. `on_join_rollback` is room-local undo only and must not dispatch to the registry.
- Do not accidentally widen the `StreamRoom` generic surface. The bridge must be an `Option<Box<dyn LeaveDispatcher>>`, not a new room type parameter.
- Do not leak unpublished rooms. Loader-created `Arc<R>` values must not escape before registry publication succeeds.
- Do not treat documentation as cleanup. Missing or weak rustdoc is a major defect because the code is expected to read like the spec.
- Do not trust implementer success reports without independent verification from the controller and review subagents.

## Controller Contract

- [ ] Create an isolated worktree with `superpowers:using-git-worktrees` before touching implementation.
- [ ] Run a fresh baseline `cargo test` in `backend/` before dispatching Task 1.
- [ ] If baseline fails for unrelated reasons, stop and ask whether to fix baseline first or proceed on top of it.
- [ ] Create a todo list covering Tasks 0-8 from this plan before dispatching the first implementer.
- [ ] Keep exactly one implementation task in progress at a time.
- [ ] The controller must not make manual code edits during execution. All production code, tests, rustdoc, and inline explanatory comments must come from implementer subagents.
- [ ] Every implementer subagent must be instructed to use `superpowers:test-driven-development`.
- [ ] Every implementer subagent touching Rust logic must also be instructed to use `superpowers:mission-critical-rust`.
- [ ] Any subagent that writes or edits tests must also be instructed to use `superpowers:backend-testing`.
- [ ] Test work is never done inline by the controller. It must come from subagents only.
- [ ] Every implementer prompt must include: the full current task text, the exact spec sections for that task, the exact files in scope, the relevant repo reference files, the documentation requirements from this plan, and the verification commands the subagent is expected to run.
- [ ] If an implementer returns `NEEDS_CONTEXT` or `BLOCKED`, answer with exact spec excerpts or repo context. Do not let the subagent guess.
- [ ] If a task grows too large for one subagent pass, split it into smaller sub-tasks that still preserve the order in this plan.
- [ ] After each implementer and test-improver cycle, the controller must inspect the diff and run the listed verification commands itself before asking reviewers for approval.
- [ ] After controller verification, dispatch a spec-compliance reviewer first.
- [ ] Only after the spec reviewer reports no major findings, dispatch a documentation/code-quality reviewer.
- [ ] If either reviewer reports a major finding, redispatch the implementer with those findings and repeat the verification and review loop.
- [ ] Do not move to the next task while a major finding is still open.

## Documentation Standard

- Public modules must explain purpose, boundaries, and concurrency model.
- Public structs and enums that encode correctness constraints must have a `# Invariants` section.
- Async methods and any API whose correctness depends on drop behavior must have a `# Cancel Safety` section.
- Fallible public methods must have a `# Errors` section.
- Unchecked variants must explicitly warn when they are safe to call and point readers to the identity-safe alternatives.
- Load-bearing branches need short inline comments that explain why the branch exists, especially around incarnation mismatch no-ops, rollback branches, pending-marker revalidation, and post-lock dispatch ordering.
- Doc-comments should explain behavior in code-facing language, not merely restate field names.

## Test Placement And Test-Subagent Rules

- All tests for this implementation must live under `backend/src/stream/tests/` and be wired through `backend/src/stream/tests/mod.rs`.
- Do not add inline `#[cfg(test)] mod tests` blocks to production files for this feature.
- The dedicated test-improver subagent may edit only files in `backend/src/stream/tests/` unless it explicitly returns a request for a production-side test seam that must be handled by an implementer subagent in the next cycle.
- The dedicated test-improver subagent must run in every loop cycle, even when the implementer already added tests via TDD.
- The dedicated test-improver subagent must load `superpowers:backend-testing`, audit the current diff against the cited spec sections, strengthen weak assertions, and add missing tests it can justify from the spec.
- The dedicated test-improver subagent must prefer improving existing test modules in the `tests` directory over inventing ad hoc new layouts.

## Review Loop

- [ ] Implementer subagent writes the smallest relevant failing tests first, then minimal production code, then rustdoc and explanatory comments, then reruns targeted tests.
- [ ] Dedicated test-improver subagent runs after each implementer pass, loads `superpowers:backend-testing`, and improves or extends tests in `backend/src/stream/tests/` for the current task.
- [ ] Controller runs `cargo fmt`, `cargo check`, and `cargo test` in `backend/` at least once in every loop cycle and reads the actual output.
- [ ] Controller independently reruns any task-specific targeted verification in addition to the regular `cargo fmt`, `cargo check`, and `cargo test` cycle.
- [ ] Spec reviewer checks only the current task's diff against the cited spec sections.
- [ ] Documentation/code-quality reviewer checks readability, rustdoc completeness, naming, and whether the code makes the concurrency model understandable without rereading the spec.
- [ ] If the task touches lock ordering, drop behavior, identity checks, or dispatch ordering, reviewers must treat any uncertainty as a major finding.
- [ ] A task is complete only when both reviewers and the dedicated test-improver report no major findings.

## Review Failure Conditions

- Spec reviewer must fail on stale-capable work that uses unchecked APIs where the spec requires `_if_matches`.
- Spec reviewer must fail on any room-lock and registry-lock nesting or any post-lock ordering mismatch with section `6.3`.
- Spec reviewer must fail on missing tests for a changed behavior or a changed invariant.
- Spec reviewer must fail on incorrect `ClaimGuard::commit()` or `Drop` behavior, including any path that could falsely report success after destroy or reload.
- Documentation/code-quality reviewer must fail on missing rustdoc for new public APIs.
- Documentation/code-quality reviewer must fail on missing `# Invariants`, `# Cancel Safety`, or `# Errors` sections where they apply.
- Documentation/code-quality reviewer must fail on weak explanations for `RegistryLink`, `ClaimGuard`, unchecked methods, and bridge call sites.
- Documentation/code-quality reviewer must fail on comments that explain only what the syntax does instead of why the behavior exists.
- Test-improver subagent must flag any missing coverage for the current task's spec sections, any tests written inline in production files, and any weak or non-deterministic concurrency tests.

## Task 0: Preflight And Traceability Setup

**Spec:** sections `2`, `3`, `6`, `12`, `13`

**Files:** planning only, plus read-only inspection of the repo files listed above.

- [ ] Read the full spec and extract a per-task section map before dispatching any implementer.
- [ ] Record a short traceability note for each task: which spec sections it owns, which files it may touch, and which tests should prove it.
- [ ] Establish baseline verification with a fresh `cargo test` in `backend/`.
- [ ] Create todo items for Tasks 1-8.
- [ ] Decide any further sub-splitting up front for tasks that would otherwise span too many independent concerns.
- [ ] Do not begin implementation until this traceability map exists.

## Task 1: Registry Surface, Slot Types, And Read-Only APIs

**Spec:** sections `5.1`, `5.1a`, `5.1b`, `5.2`, `7.1`, `7.6`, `7.7`, `7.8`, `7.9`, `13.1`, `13.5`

**Files:**
- `backend/src/stream/room_registry.rs`
- `backend/src/stream/mod.rs`
- `backend/src/stream/tests/mod.rs`
- `backend/src/stream/tests/room_registry.rs`

- [ ] Dispatch an implementer to create the new registry module, the public slot/index types, the read-only registry surface, and the module exports.
- [ ] Require the implementer to start with small failing tests for slot behavior and read-only registry queries, with those tests placed in `backend/src/stream/tests/room_registry.rs`.
- [ ] Require rustdoc from the start for the module, the public types, and the read-only methods so later tasks extend existing documentation instead of leaving it until the end.
- [ ] Keep this task scoped to structural types and read-only behavior. Do not yet wire bridge behavior or full claim/rejoin logic unless a minimal scaffold is required for compilation.
- [ ] Verify targeted tests for the new registry test module, then rerun broader `stream` tests if public exports changed.
- [ ] Spec review focus: the zero-overhead `SingleSlot` and `UnlimitedSlot<N>` boundary, counter initialization at `1`, and read-only semantics that never inspect `R`.
- [ ] Documentation review focus: module-level concurrency explanation, `UserSlot` contract clarity, and docs that distinguish structural capacity from runtime policy.

## Task 2: Identity Machinery, Error Surfaces, And ClaimGuard Semantics

**Spec:** sections `3.5`, `5.3`, `5.4`, `5.5`, `5.5b`, `6.1` especially `INV-5`, `7.2`, `7.3`, `9.1`, `9.2`, `9.3`, `13.3` steps `2-3`

**Files:**
- `backend/src/stream/room_registry.rs`
- `backend/src/stream/tests/room_registry.rs`

- [ ] Dispatch an implementer to add incarnation tracking, `LoaderContext`, `ClaimGuard`, commit/finalization errors, and the cancel-safe rollback model.
- [ ] Require failing tests in `backend/src/stream/tests/room_registry.rs` that prove loaders do not run twice, loading can abort cleanly, and stale or destroyed claims fail safely instead of reporting success.
- [ ] Require the implementer to keep `ClaimGuard::commit()` explicitly fallible and to document the caller contract that commit and armed-drop happen after room locks are released.
- [ ] Require docs to explain unpublished versus published room state, what `LoaderContext` is allowed to do, and why mismatch paths are no-ops or `ClaimLost` instead of panics.
- [ ] Verify targeted loading, cancellation, and finalization tests before review.
- [ ] Spec review focus: publication rule, loader-context ownership, `ClaimGuard` rollback branches, and no-op behavior when the registry has been dropped or the incarnation no longer matches.
- [ ] Documentation review focus: `# Cancel Safety` on async methods and guard behavior, plus clear explanation of why stale finalization must fail rather than succeed into a ghost room.

## Task 3: Core Registry Operations And Destroy Semantics

**Spec:** sections `7.2`, `7.3`, `7.4`, `7.5`, `7.5x`, `6.1` `INV-1` through `INV-4`, `6.2`, `8` scenarios `A-H`, `13.3` steps `4-5`

**Files:**
- `backend/src/stream/room_registry.rs`
- `backend/src/stream/tests/room_registry.rs`

- [ ] Dispatch an implementer to finish `ensure_and_claim`, `ensure_room`, unchecked `leave`, unchecked `destroy`, and any helper logic needed to keep slots and index entries consistent.
- [ ] Require failing tests in `backend/src/stream/tests/room_registry.rs` for duplicate loads, same-user structural rejection, destroy-during-loading, idempotent destroy, and the soft-consistency windows that the spec expects.
- [ ] Require the implementer to keep the registry room-agnostic and to avoid any call into room internals.
- [ ] Require docs on unchecked methods to explain exactly why they are unchecked and when callers must prefer `_if_matches` alternatives.
- [ ] Verify targeted concurrency tests and the full `room_registry` suite after implementation.
- [ ] Spec review focus: no lock nesting, atomic remove of slot plus index entries during destroy, and correct behavior when loaders or claims race with destroy.
- [ ] Documentation review focus: warnings on unchecked methods, destroy semantics for active versus loading slots, and readability of the helper methods that collect and remove index entries.

## Task 4: Reservation, Rejoin, And Identity-Safe Mutation Paths

**Spec:** sections `2.2` requirements `R8-R9`, `5.3`, `6.1` `INV-4` and `INV-5`, `7.4a`, `7.4b`, `7.4c`, `7.4x`, `7.4y`, `7.5x`, `8` scenarios `K-R`, `12.8`, `13.3` steps `4` and `6`

**Files:**
- `backend/src/stream/room_registry.rs`
- `backend/src/stream/tests/room_registry.rs`

- [ ] Dispatch an implementer to add reservation and rejoin flows plus the identity-safe `_if_matches` mutations.
- [ ] Require failing tests in `backend/src/stream/tests/room_registry.rs` for `mark_reserved`, `claim_reserved`, wrong-generation failures, reserved-capacity accounting, destroy-versus-rejoin races, and stale guard rollback across destroy plus reload.
- [ ] Require the implementer to treat reserved entries as capacity-consuming and to keep generation and incarnation responsibilities distinct in code and docs.
- [ ] Require rustdoc that clearly separates unchecked and identity-safe APIs so a reader cannot accidentally pick the wrong one.
- [ ] Verify the rejoin and stale-identity tests before review.
- [ ] Spec review focus: ABA safety, reserved entries pointing only to active slots, destroy invalidating in-flight rejoins, and mismatch behavior remaining a no-op.
- [ ] Documentation review focus: generation versus incarnation terminology, `ClaimGuard` behavior for FreshJoin versus Rejoin, and clear explanation of why reserved entries stay in the index.

## Task 5: StreamRoom API Migration And Protocol Contract Update

**Spec:** sections `5.6`, `5.7`, `6.3`, `13.1`, `13.4`, `13.5`

**Files:**
- `backend/src/stream/stream_room.rs`
- `backend/src/stream/mod.rs`
- `backend/src/stream/tests/room.rs`

- [ ] Dispatch an implementer to add `LeaveDispatcher`, `LeaveReason`, `LeaveDisposition`, `MemberLeftResult`, `on_join_rollback`, the optional dispatcher field, and the `with_dispatcher` constructor while preserving `StreamRoom::new` for non-registry rooms.
- [ ] Require failing tests in `backend/src/stream/tests/room.rs` that force all existing `RoomProtocol` implementers and room tests to migrate to the new contract.
- [ ] Require docs that make the split between real leave and join rollback unmistakable.
- [ ] Require the implementer to preserve the no-new-type-parameter design and to document why the dispatcher is trait-object based.
- [ ] Verify the updated room test suite and any compilation fallout in other `stream` users.
- [ ] Spec review focus: `StreamRoom::new` remains transparent when no dispatcher exists, `on_member_left` no longer returns a bare broadcast, and `on_join_rollback` never dispatches to the registry.
- [ ] Documentation review focus: trait contract clarity, behavior of standalone rooms, and explicit warnings against blocking, I/O, or lock nesting inside callbacks.

## Task 6: Bridge Wiring, RegistryLink, And Post-Lock Cleanup Ordering

**Spec:** sections `3.5`, `5.6`, `5.7`, `6.3`, `7.4x`, `7.4y`, `7.5x`, `7.10`, `8` scenarios `P-Q-R`, `12.9`, `13.3` step `7`

**Files:**
- `backend/src/stream/room_registry.rs`
- `backend/src/stream/stream_room.rs`
- `backend/src/stream/mod.rs`
- `backend/src/stream/tests/mod.rs`
- `backend/src/stream/tests/bridge_integration.rs`
- `backend/src/stream/tests/room.rs`

- [ ] Dispatch an implementer to wire the three real-leave call sites in `stream_room.rs`: cleanup task, live-handle `remove(user_id)`, and stale-handle self-heal in `reserve_pending`.
- [ ] Require the implementer to add pending-marker revalidation before activation and to ensure pending-only `remove(user_id)` is a silent authoritative cancellation path.
- [ ] Require the implementer to add `RegistryLink` in `room_registry.rs` and route all stale-capable dispatches through `_if_matches` methods.
- [ ] Require failing integration tests in `backend/src/stream/tests/bridge_integration.rs` before wiring each risky path, especially post-lock dispatch ordering, stale dispatch across ULID reuse, and destroy-after ordering where `dispatch_leave` must happen before `dispatch_destroy`.
- [ ] Require docs on `RegistryLink` that explain why it holds `Weak<RoomRegistry>`, why it captures `room_id` and `incarnation`, and why `Arc::ptr_eq` through `Weak<StreamRoom>` was rejected.
- [ ] Verify `bridge_integration` tests and the updated `room` tests before review.
- [ ] Spec review focus: all three call-site orderings from section `6.3`, silent pending-only cancellation, identity-safe no-ops on stale dispatch, and preservation of no-lock-nesting.
- [ ] Documentation review focus: readability of the bridge flow, doc-comments on `RegistryLink`, and clear explanation of the live-handle versus pending-only `remove` paths.

## Task 7: Coverage Expansion, Regression Hardening, And Documentation Completion

**Spec:** sections `8`, `9`, `12.1` through `12.9`, `13.5`

**Files:**
- `backend/src/stream/tests/room_registry.rs`
- `backend/src/stream/tests/bridge_integration.rs`
- `backend/src/stream/tests/room.rs`
- Any touched production files with missing rustdoc or missing explanatory comments uncovered by reviewers

- [ ] Dispatch implementers in sub-slices if needed. This task is expected to be too large for one blind pass.
- [ ] Cover the bridge integration matrix first because it exercises the highest-risk end-to-end behavior.
- [ ] Then cover the remaining registry cases in section `12` that are not already proven by earlier tasks, using the spec's test IDs as a checklist.
- [ ] Require deterministic concurrency orchestration for race-sensitive tests rather than probabilistic timing.
- [ ] Keep all new or expanded tests in `backend/src/stream/tests/`; do not move coverage inline into production modules.
- [ ] Require the controller to maintain a coverage checklist keyed by the spec's test IDs so no scenario is silently skipped.
- [ ] Use reviewer findings to drive documentation completion in production files immediately; do not defer rustdoc gaps to a later cleanup pass.
- [ ] Verify targeted suites during each sub-slice and rerun full `cargo test` in `backend/` once Task 7 is believed to be complete.
- [ ] Spec review focus: missing scenarios from section `12`, especially stale identity, destroy races, pre-activation cancellation, and join rollback behavior.
- [ ] Documentation review focus: whether the final public API surface explains the concurrency model well enough that a new reader can understand it without bouncing constantly back to the spec.

## Task 8: Branch-Wide Convergence Loop

**Spec:** entire document, with special attention to sections `2.2`, `3.5`, `6`, `8`, `9`, `12`, and `13.5`

**Files:** every touched file in the branch

- [ ] Run a full-controller pass over the final diff and map every requirement and every named test scenario in the spec to evidence in code or tests.
- [ ] Run fresh `cargo fmt`, `cargo check`, and `cargo test` in `backend/` after the last change and read the actual output before claiming success.
- [ ] Dispatch a whole-branch spec reviewer with the full diff, the whole spec, and explicit instructions to find overbuild, underbuild, incorrect ordering, stale-identity holes, and missing tests.
- [ ] If the branch-level spec review finds major issues, create focused fix tasks and loop back through implementer then reviewers.
- [ ] Dispatch a whole-branch test-improver subagent with the full diff and the whole spec to find missing coverage, weak assertions, and any tests that still belong in `backend/src/stream/tests/` but are not there yet.
- [ ] If the whole-branch test-improver adds tests or reports major gaps, rerun `cargo fmt`, `cargo check`, and `cargo test`, then loop back through reviewers.
- [ ] After spec review is clear, dispatch a whole-branch documentation/code-quality reviewer focused on rustdoc completeness, terminology consistency, comment quality, and whether the public surface teaches the invariants.
- [ ] If documentation review finds major issues, create focused fix tasks and loop again.
- [ ] After both branch-level reviewers are clear, dispatch one final general code-review subagent over the whole branch to catch integration issues that are not obvious from per-task reviews.
- [ ] If the final reviewer finds major issues, create focused fix tasks and repeat the same loop until there are no major findings.
- [ ] The branch is not done until the implementation is usable, the reviewers and the test-improver have no major findings, and the final verification commands have been rerun after the last fix.

## Completion Gate

- [ ] No open major findings from any reviewer.
- [ ] No open major findings from the dedicated test-improver subagent.
- [ ] Fresh `cargo fmt`, `cargo check`, and `cargo test` in `backend/` after the last code change.
- [ ] All new public APIs and changed public APIs have rustdoc.
- [ ] New invariants, cancellation contracts, and error surfaces are documented where they are declared.
- [ ] The code explains the critical concurrency behavior without forcing the reader to reverse-engineer it from tests alone.
- [ ] The final handoff summarizes which spec sections were implemented, which tests prove them, and whether any non-major follow-ups remain.
