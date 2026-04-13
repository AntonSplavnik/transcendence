# Bug Hunt Fleet Orchestration Plan

> **For the orchestrating LLM:** This is your mission brief. You are running in a clean clone of the project — you have no prior chat history, so everything you need is in this document. Your job is to coordinate a fleet of subagents that hunt for a specific real-world crash in the C++ game-core code. You do almost no code reading yourself — you dispatch, receive, filter, and aggregate.
>
> You should be Claude Code (or equivalent) with an `Agent` / subagent-dispatch tool available. The prompts below are copy-paste ready. Do not paraphrase them — the phrasing is load-bearing, especially the anti-false-positive rules.

---

## Mission

Find the **real, current, reproducible-in-production root cause** of an intermittent crash in the C++ `game-core` library (path: `game-core/src/`) that takes down the whole Rust backend process.

You will:
1. **Phase 1** — Dispatch ONE subagent to partition the C++ codebase into 7–15 bug-hunt domains.
2. **Phase 2** — For each domain, **sequentially** dispatch **two subagents in parallel** that independently investigate the same domain. Wait for both before moving to the next domain.
3. **Phase 3** — Aggregate all findings from all domains into one ranked report.

You are operating in a read-only mode. **Do not let any subagent modify files.** You do not modify files either.

This is an analysis-only workflow for local investigation.
- **Do NOT use `finishing-a-development-branch` skill.**
- **Do NOT do any git workflow actions** (no branch management, no commits, no PR flow, no merge/push/discard flow).
- Stop after producing the three report files in `docs/superpowers/reports/`.

---

## Bug Profile (cold-start briefing)

The project is a multiplayer arena-combat game with a Rust backend (Salvo framework) that owns a C++ game-core library through a `cxx::bridge` FFI layer.

**Architecture facts you need:**
- Rust spawns one dedicated OS thread per game lobby at `backend/src/game/manager.rs:595` and runs the C++ game loop there via a safe wrapper.
- The C++ `GameBridge` struct (`game-core/src/cxx_bridge.hpp:46`) is only accessed through a Rust-side `Mutex`. Comment at `backend/src/game/ffi.rs:153-155`: *"GameBridge is only accessed through a Mutex, ensuring exclusive access. The raw C++ object is never aliased across threads."* **You should verify this claim holds in practice** — if the mutex is released between `set_player_input` and `update` calls, C++ state can mutate between FFI calls even without a data race.
- The game uses the EnTT entity-component-system library. All systems run on one thread per tick.
- WebTransport streams deliver inputs from N players asynchronously; each input reaches the game thread via the FFI `set_player_input` call.
- Existing Rust panic handler at `manager.rs:605` wraps the loop in `catch_unwind`. Rust panics are caught. **C++ segfaults / aborts / failed asserts are not** — they kill the whole backend process, which is what we are observing.

**Observed bug signature (what the humans reported):**
- Happens only with **3 or more players actively sending inputs**. Never reproduced in local 1v1 testing despite the game having been dev-tested for months.
- Hit rate is **~3 out of 10 games**, then **zero out of 30+ games** immediately after — classic timing-sensitive intermittent bug.
- Two occurrences happened several minutes into a match. One happened within seconds of match start.
- No Rust panic in logs, no backtrace, no crash dump — the process exits uncleanly. This is consistent with SIGSEGV or `std::abort` from C++.
- **No player died or disconnected** in any of the observed crashes. Players were all alive and actively inputting at the moment of crash.

**Suspicion ordering (priors only — do not let subagents treat this as ground truth):**
1. Input-handling path for concurrent players (multiple `set_player_input` calls between ticks, or state reads from a partially-updated component).
2. Attack chain / combat logic (a recent Rust-side commit `987414d7` fixed "buffered attack empty chain" — this area has known recent fragility).
3. Entity-lifecycle edges — iterator invalidation, reads of stale entity handles, despawn-during-iteration.
4. Event queue writes racing with `take_events` drains (but both happen on the game thread per the mutex invariant, so this is a long shot).
5. Collision system indexing / spatial data-structure corruption.

---

## Absolute Anti-False-Positive Rules

**Every subagent MUST follow these rules.** The rules are repeated verbatim in the subagent prompts below. If a subagent violates them, discard the finding.

1. **Real, current bugs only.** We care about what crashes the current code today. Not "this would be unsafe if refactored," not "a future change could break this," not "this isn't defensive enough."

2. **No theoretical failure modes.** Reject all findings that rely on:
   - `malloc` / `new` returning null (OOM)
   - Hardware faults, cosmic rays, disk full, power loss
   - Another process sending spurious signals
   - The OS thread scheduler violating POSIX guarantees
   - Stack overflow from unbounded recursion *unless* a concrete recursive path exists
   - `std::terminate` from an exception the code genuinely doesn't throw

3. **Must match the bug profile.** A valid finding must plausibly explain:
   - Only triggers with ≥3 concurrent player inputs.
   - Is intermittent (timing-sensitive, not deterministic).
   - Does not require any player to die, disconnect, or leave.
   - Manifests as a process-killing crash (segfault / abort), not a silent wrong-behavior.
   A finding that can only cause wrong gameplay, wrong scores, missed hits, or visual glitches is **not the bug we want**. Flag it separately if encountered but do not include it in the primary report.

4. **Must be concrete.** A valid finding names:
   - A specific file and line range.
   - A step-by-step scenario — "Player A sends input at tick N while player B's attack chain is in state X, causing the update at line Y to dereference Z which is null/dangling because..."
   - A mechanism for the crash (UAF, null deref, OOB read, double-free, torn read of non-atomic state that violates an invariant assumed downstream).
   - The exact code that proves it, quoted from the file.

5. **No style, no lints, no nits.** Missing `const`, unclear naming, absent error handling that would only matter "if X were different," suggestions to add more asserts — these are not bugs. Reject them.

6. **No hypothetical concurrency unless you can prove the Mutex claim is violated.** The Rust side claims the `GameBridge` is accessed single-threaded via a `Mutex`. If a subagent invokes a race condition as the mechanism, they must first demonstrate — by pointing at a specific call site in `backend/src/game/ffi.rs` or `backend/src/game/manager.rs` — that the mutex is either not held or released between dependent operations. Unsubstantiated "this might race" is invalid.

7. **Confidence must be honest.** If a finding describes a plausible mechanism but the reporter can't trace the exact state that triggers it, the finding is `medium`. If they can construct the full trigger sequence from code, it's `high`. Never claim `high` without a complete trace.

---

## Phase 1 — Domain Identification (ONE subagent)

**Dispatch this prompt to a single subagent.** Wait for the result. Do not proceed until you have the domain list.

### Phase 1 subagent prompt (copy verbatim)

```
You are part of a bug-hunt on a multiplayer game. Your single task is to
partition the C++ game-core codebase into 7–15 investigation domains so
that other agents can sweep each domain for a specific real crash bug.

REPO ROOT: the current working directory (this is a clean clone of the
project). The code we care about is entirely under `game-core/src/`. The
Rust FFI boundary lives at `backend/src/game/ffi.rs` and
`backend/src/game/manager.rs` — read these *only* to understand how C++
is invoked, not as investigation targets themselves.

Before picking domains, read:
- `game-core/src/cxx_bridge.hpp` and `game-core/src/cxx_bridge.cpp`
- `game-core/src/ArenaGame.hpp`
- `game-core/src/core/World.hpp`
- `ls game-core/src/systems/` and glance at each header to know what
  each system does
- `ls game-core/src/components/` and `ls game-core/src/events/`

A "domain" is a cohesive slice of functionality that can be investigated
in isolation by someone who has not read the rest of the codebase. Good
domains are things like:
  - "Attack chain and combat damage application"
  - "Entity spawn/despawn lifecycle and iterator safety"
  - "GameBridge FFI boundary — cxx type conversion and ownership"
  - "Event queue: write path in systems, drain path in take_events"
  - "CharacterControllerSystem input processing"
Bad domains:
  - "systems/" (too broad)
  - "CombatSystem::fixedUpdate line 45" (too narrow)
  - "code quality" (not a domain)

Target 7–15 domains. Fewer is fine if the code naturally has fewer
surfaces. More than 15 is too granular — merge related slices.

For each domain output exactly this block:

## Domain N — <short name>
**Scope:** <1–2 sentence description of what is and isn't in scope>
**Primary files:**
- `path/to/file.hpp`
- `path/to/other.cpp`
**Secondary files (read for context):**
- `path/to/adjacent.hpp`
**Key functions / entry points to trace:**
- `ClassName::method_name` in `path:line`
- `free_function` in `path:line`
**Why this domain matters for the bug:**
<1–3 sentences tying this domain to the bug profile below. If a domain
is being included for completeness but seems unlikely given the profile,
say so honestly.>

BUG PROFILE (use this to judge which domains matter):
- Crash only with ≥3 players actively sending inputs.
- Intermittent: 3/10 one session, 0/30 the next. Timing-sensitive.
- No player died / disconnected / left in any observed crash.
- Manifests as a process-killing crash with no Rust panic — i.e. C++
  segfault or std::abort.
- Not reproducible in 1v1 local testing.

HARD CONSTRAINTS:
- Do NOT list a domain for "memory allocation failure" or other
  theoretical failure modes.
- Do NOT list "general code quality" as a domain.
- Do NOT propose refactors or cleanups.
- Do NOT modify any files.
- Output ONLY the domain list in the format above, plus a one-paragraph
  "Domains I deliberately did NOT include and why" section at the end.
  Keep under 2000 words.

Read the files and produce the list now.
```

### After Phase 1 returns

- Verify the output has between 7 and 15 domain blocks.
- Verify every domain names concrete files and functions.
- If the subagent violated the format or returned fewer than 7 or more than 15 domains, send one corrective follow-up explaining the gap and ask for a revised list. Do not accept a second bad response — fall back to manually splitting one of the domains yourself if needed.
- Save the final domain list to `docs/superpowers/reports/2026-04-13-bughunt-domains.md` in the clone. This file is your source of truth for Phase 2.

---

## Phase 2 — Sequential Dual Investigation (two subagents per domain, in parallel)

**Process:** Walk the domain list in order. For each domain, spawn **two** investigator subagents **in parallel** (a single message containing two `Agent` tool calls). Wait for both. Reconcile (see below). Log the reconciled findings. Move to the next domain. Do **not** parallelize across domains — we want the orchestrator's context to stay manageable and we want sequential observability into the fleet's progress.

The two agents per domain are **asymmetric by role**:
- **Investigator A (Hunter):** maximize recall of concrete crash candidates and concrete leads.
- **Investigator B (Skeptic):** aggressively falsify weak candidates and enforce anti-FP rules.

This asymmetry is intentional to reduce correlated blind spots from identical prompts.

### Phase 2 per-domain subagent prompt A (Hunter) (copy verbatim, substitute `{{DOMAIN_BLOCK}}`)

```
You are Investigator A (HUNTER) of two independent investigators auditing
the same slice of a C++ game engine for a specific, real,
currently-present crash bug.
Another agent (Investigator B, SKEPTIC) is reading the same code right
now. Do not coordinate.

Your role: maximize recall while staying concrete. You should actively
surface both:
1) hard findings (fully proven crash paths), and
2) concrete leads (not fully proven yet, but mechanically plausible with
   code evidence and a clearly stated missing link).

REPO ROOT: current working directory. Code under `game-core/src/`.
Rust FFI: `backend/src/game/ffi.rs`, `backend/src/game/manager.rs`.

YOUR DOMAIN:

{{DOMAIN_BLOCK}}

BUG PROFILE you are hunting for:
- Crash only manifests with ≥3 players actively sending inputs.
- Intermittent. 3/10 one session, 0/30 the next. Timing-sensitive.
- No player died / disconnected / left in any observed crash — all
  players were alive and inputting at the moment of crash.
- Manifests as a process-killing crash with no Rust panic. Strongly
  suggests C++ segfault, std::abort, or similar.
- Not reproducible in 1v1 local testing.

WHAT YOU ARE LOOKING FOR:
Concrete, currently-present bugs in the files of your domain that could
plausibly cause a crash matching the profile above. Think specifically
about:
- Use-after-free: an entity/component handle stored or captured that
  outlives the thing it points to. Does EnTT have any `get<T>` that
  returns a reference stored across a removal?
- Null pointer dereference: a `registry.get<T>(entity)` where `entity`
  might not have `T`, or a `registry.try_get<T>(entity)` whose null
  return is not checked.
- Iterator invalidation: adding or removing components or entities
  during a view/group iteration in the same system.
- Stale entity handles: an `entt::entity` cached from a previous tick
  that was destroyed in between.
- Unchecked array / vector indexing with an index derived from player
  input or player count.
- Reinterpret-cast / pointer punning on values that can come from the
  FFI boundary.
- Invariant violations: a comment, assert, or implicit assumption that
  can be violated by a specific input sequence from a second player
  arriving between two other operations.
- Unsafe mutable state crossing the Mutex boundary: the Rust side
  claims the C++ GameBridge is accessed single-threaded under a Mutex
  (see `backend/src/game/ffi.rs:153-155`). If you propose a race, you
  MUST first demonstrate that the mutex is released between the two
  operations you claim race, by citing the specific call site in
  `backend/src/game/manager.rs` or `ffi.rs`.

WHAT YOU ARE NOT LOOKING FOR (reject findings that fit these):
- "malloc could fail" / OOM scenarios. Not the bug.
- "a future refactor could break this" / defensive hardening. Not bugs.
- Missing const / unclear naming / style / "add more comments". Not bugs.
- Anything whose worst outcome is "wrong gameplay" / "wrong score" /
  "missed attack" / "visual glitch" — we want CRASHES only.
- Theoretical races that contradict the Mutex invariant without proof.
- Anything in the Rust side. The Rust side has a catch_unwind that
  would produce a visible panic if the bug were there; we observed no
  panic, so the bug is on the C++ side.
- Hardware, OS, or external-process failure modes.

OUTPUT FORMAT — emit exactly this, nothing else:

## Hard Findings for Domain: <domain name>

### Finding 1
**Location:** `path/to/file.hpp:123-145`
**What happens (step-by-step):**
1. Player A sends input causing <specific C++ path> ...
2. Before the next step, player B's input causes <other path> ...
3. At <line>, the code <does thing> assuming <invariant>.
4. Invariant is violated because <reason>; the line now <dereferences
   null / reads freed memory / indexes OOB / etc>.
**Crash mechanism:** <null deref | UAF | OOB read | OOB write |
double-free | torn read of non-atomic causing later invariant violation
| abort-on-assert>
**Match with bug profile:**
- Requires ≥3 players? <yes/no + why>
- Intermittent (depends on timing)? <yes/no + why>
- Players alive at crash? <yes/no + why>
- Consistent with process-kill-no-panic? <yes/no + why>
**Evidence (quoted code):**
```cpp
// paste 5–20 lines from the file showing the actual bug
```
**Confidence:** high | medium | low
  - high = you can construct the full trigger sequence from code alone
  - medium = plausible mechanism, missing some state-trace links
  - low = suspicious pattern, can't prove trigger
**What would disprove this finding:** <one sentence — what check would
rule this out? this discipline keeps you honest>

### Finding 2
...

---

If you find no hard finding that meets the bar, set the hard-findings
section to this exact marker:

## Hard Findings for Domain: <domain name>

NO HARD FINDINGS.

Then continue with concrete leads and eliminated candidates below.

## Concrete Leads (not yet proven)

### Lead 1
**Location:** `path/to/file.hpp:123-145`
**Suspected crash mechanism:** <null deref | UAF | OOB read | OOB write |
abort-on-assert | other>
**Why plausible:** <2-4 sentences tied to >=3-player intermittent profile>
**Missing link:** <one specific thing you cannot prove yet>
**Evidence (quoted code):**
```cpp
// paste 5–20 lines from the file supporting this lead
```
**How to prove/disprove quickly:** <one concrete runtime or code check>

### Lead 2
...

## Eliminated candidates (must be concrete)

- **Candidate 1:** `path:line` — ruled out because <reason>
  **Evidence:**
  ```cpp
  // 3–12 lines showing why this candidate is invalid
  ```
- **Candidate 2:** ...
- **Candidate 3:** ...

---

HARD RULES:
- Hard findings: minimum 0, maximum 5.
- Concrete leads: minimum 1, maximum 5.
- If you emit `NO HARD FINDINGS`, you MUST provide at least 3 eliminated
  candidates with quoted code evidence.
- Do NOT modify any files.
- Do NOT invent code that isn't there. Every quoted snippet must
  actually exist in the file you cite at the line range you cite.
- Do NOT report anything you cannot back with a code quote.
- Every finding must have a concrete mechanism. "Might crash under
  heavy load" is not a mechanism.
- You may not output only a vague paragraph. Sections above are mandatory.

Begin investigation now.
```

### Phase 2 per-domain subagent prompt B (Skeptic) (copy verbatim, substitute `{{DOMAIN_BLOCK}}`)

```
You are Investigator B (SKEPTIC) of two independent investigators auditing
the same slice of a C++ game engine for a specific, real,
currently-present crash bug.
Another agent (Investigator A, HUNTER) is reading the same code right
now. Do not coordinate.

Your role: aggressively falsify weak claims and enforce anti-false-positive
rules. You must still report hard findings if proven, and concrete leads
if plausible, but your default posture is adversarial verification.

REPO ROOT: current working directory. Code under `game-core/src/`.
Rust FFI: `backend/src/game/ffi.rs`, `backend/src/game/manager.rs`.

YOUR DOMAIN:

{{DOMAIN_BLOCK}}

BUG PROFILE you are hunting for:
- Crash only manifests with ≥3 players actively sending inputs.
- Intermittent. 3/10 one session, 0/30 the next. Timing-sensitive.
- No player died / disconnected / left in any observed crash — all
  players were alive and inputting at the moment of crash.
- Manifests as a process-killing crash with no Rust panic. Strongly
  suggests C++ segfault, std::abort, or similar.
- Not reproducible in 1v1 local testing.

WHAT YOU ARE LOOKING FOR:
Concrete, currently-present bugs in the files of your domain that could
plausibly cause a crash matching the profile above. Think specifically
about:
- Use-after-free: an entity/component handle stored or captured that
  outlives the thing it points to. Does EnTT have any `get<T>` that
  returns a reference stored across a removal?
- Null pointer dereference: a `registry.get<T>(entity)` where `entity`
  might not have `T`, or a `registry.try_get<T>(entity)` whose null
  return is not checked.
- Iterator invalidation: adding or removing components or entities
  during a view/group iteration in the same system.
- Stale entity handles: an `entt::entity` cached from a previous tick
  that was destroyed in between.
- Unchecked array / vector indexing with an index derived from player
  input or player count.
- Reinterpret-cast / pointer punning on values that can come from the
  FFI boundary.
- Invariant violations: a comment, assert, or implicit assumption that
  can be violated by a specific input sequence from a second player
  arriving between two other operations.
- Unsafe mutable state crossing the Mutex boundary: the Rust side
  claims the C++ GameBridge is accessed single-threaded under a Mutex
  (see `backend/src/game/ffi.rs:153-155`). If you propose a race, you
  MUST first demonstrate that the mutex is released between the two
  operations you claim race, by citing the specific call site in
  `backend/src/game/manager.rs` or `ffi.rs`.

WHAT YOU ARE NOT LOOKING FOR (reject findings that fit these):
- "malloc could fail" / OOM scenarios. Not the bug.
- "a future refactor could break this" / defensive hardening. Not bugs.
- Missing const / unclear naming / style / "add more comments". Not bugs.
- Anything whose worst outcome is "wrong gameplay" / "wrong score" /
  "missed attack" / "visual glitch" — we want CRASHES only.
- Theoretical races that contradict the Mutex invariant without proof.
- Anything in the Rust side. The Rust side has a catch_unwind that
  would produce a visible panic if the bug were there; we observed no
  panic, so the bug is on the C++ side.
- Hardware, OS, or external-process failure modes.

OUTPUT FORMAT — emit exactly this, nothing else:

## Hard Findings for Domain: <domain name>

### Finding 1
**Location:** `path/to/file.hpp:123-145`
**What happens (step-by-step):**
1. Player A sends input causing <specific C++ path> ...
2. Before the next step, player B's input causes <other path> ...
3. At <line>, the code <does thing> assuming <invariant>.
4. Invariant is violated because <reason>; the line now <dereferences
   null / reads freed memory / indexes OOB / etc>.
**Crash mechanism:** <null deref | UAF | OOB read | OOB write |
double-free | torn read of non-atomic causing later invariant violation
| abort-on-assert>
**Match with bug profile:**
- Requires ≥3 players? <yes/no + why>
- Intermittent (depends on timing)? <yes/no + why>
- Players alive at crash? <yes/no + why>
- Consistent with process-kill-no-panic? <yes/no + why>
**Evidence (quoted code):**
```cpp
// paste 5–20 lines from the file showing the actual bug
```
**Confidence:** high | medium | low
  - high = you can construct the full trigger sequence from code alone
  - medium = plausible mechanism, missing some state-trace links
  - low = suspicious pattern, can't prove trigger
**What would disprove this finding:** <one sentence — what check would
rule this out? this discipline keeps you honest>

### Finding 2
...

---

If you find no hard finding that meets the bar, set the hard-findings
section to this exact marker:

## Hard Findings for Domain: <domain name>

NO HARD FINDINGS.

Then continue with concrete leads and eliminated candidates below.

## Concrete Leads (not yet proven)

### Lead 1
**Location:** `path/to/file.hpp:123-145`
**Suspected crash mechanism:** <null deref | UAF | OOB read | OOB write |
abort-on-assert | other>
**Why plausible:** <2-4 sentences tied to >=3-player intermittent profile>
**Missing link:** <one specific thing you cannot prove yet>
**Evidence (quoted code):**
```cpp
// paste 5–20 lines from the file supporting this lead
```
**How to prove/disprove quickly:** <one concrete runtime or code check>

### Lead 2
...

## Eliminated candidates (must be concrete)

- **Candidate 1:** `path:line` — ruled out because <reason>
  **Evidence:**
  ```cpp
  // 3–12 lines showing why this candidate is invalid
  ```
- **Candidate 2:** ...
- **Candidate 3:** ...

---

HARD RULES:
- Hard findings: minimum 0, maximum 5.
- Concrete leads: minimum 1, maximum 5.
- If you emit `NO HARD FINDINGS`, you MUST provide at least 3 eliminated
  candidates with quoted code evidence.
- Do NOT modify any files.
- Do NOT invent code that isn't there. Every quoted snippet must
  actually exist in the file you cite at the line range you cite.
- Do NOT report anything you cannot back with a code quote.
- Every finding must have a concrete mechanism. "Might crash under
  heavy load" is not a mechanism.
- You may not output only a vague paragraph. Sections above are mandatory.

Begin investigation now.
```

### Dispatching the pair

For each domain in order, send a single message to the harness containing two `Agent` tool calls:
- Investigator A uses the **Hunter** prompt above.
- Investigator B uses the **Skeptic** prompt above.

Use the same `{{DOMAIN_BLOCK}}` in both prompts. Give the two agents distinct short descriptions like `"Domain N hunter"` and `"Domain N skeptic"`. Run them in the foreground (not background) — you need both results before moving on.

### Reconciling the pair

Once both agents return for a domain, apply this reconciliation:

1. **Both agents report the same hard finding** (same file + overlapping line range + same mechanism) → mark the finding **corroborated**. Use the more detailed of the two writeups as the canonical text.

2. **Only one agent reports a hard finding** → mark it **unconfirmed**. Keep it in the report but note that the sibling agent did not flag it. Do NOT automatically discard — the other agent may have missed it. Only discard if the reported finding violates the anti-FP rules in Section "Absolute Anti-False-Positive Rules" above.

3. **Agents contradict each other** (one says "bug here," the other specifically says "this is fine because X") → mark as **disputed**. Include both positions verbatim in the final report. Do not try to resolve it yourself — the human reviewer will.

4. **Both agents say NO HARD FINDINGS** → record the domain as hard-clean, but still reconcile and retain their concrete leads and eliminated-candidate evidence.

5. **Anti-FP filtering applied AFTER reconciliation**: drop any hard finding (even corroborated ones) that:
   - Is predicated on malloc failure, OOM, hardware fault, or OS misbehavior.
   - Has no concrete step-by-step trigger sequence.
   - Claims a race without citing the specific unlocked FFI call site.
   - Is about code quality, style, or hypothetical future changes.
   - Would manifest as wrong gameplay rather than process death.

6. **Lead reconciliation**:
   - If both agents report the same concrete lead (same mechanism + overlapping file/line) → mark lead **corroborated-lead**.
   - If only one agent reports a lead → mark **unconfirmed-lead**.
   - If skeptic explicitly refutes hunter's lead with code evidence → mark **disputed-lead** and include both sides.

Append each domain's reconciled hard findings and leads to `docs/superpowers/reports/2026-04-13-bughunt-findings.md` immediately after processing, so progress is durable even if the orchestration session is interrupted.

---

## Phase 3 — Final Aggregated Report

After the last domain is processed, produce `docs/superpowers/reports/2026-04-13-bughunt-final.md` with this structure:

```
# Bug Hunt Final Report — 2026-04-13

## Bug we were hunting
<one paragraph restating the profile>

## Top suspects (ranked)
### Suspect 1 — <short name>
**Domain:** N — <domain name>
**Status:** corroborated | unconfirmed | disputed
**Finding:** <canonical text from reconciled finding>
**Why this is a strong candidate:** <half-paragraph>
**How to verify in code execution:** <one paragraph — what logging, what
bot scenario, what gdb checkpoint would confirm or refute this>

### Suspect 2 — ...
(continue for up to 10 top suspects)

## Top concrete leads (ranked)
### Lead 1 — <short name>
**Domain:** N — <domain name>
**Status:** corroborated-lead | unconfirmed-lead | disputed-lead
**Lead:** <canonical text from reconciled lead>
**Missing proof link:** <what is still unknown>
**How to verify in code execution:** <one paragraph>

### Lead 2 — ...

## All other findings and leads (full list, lower priority)
<every non-dropped hard finding and lead not in the top sections, grouped by domain>

## Clean domains
<list of domains both agents marked NO HARD FINDINGS, with a sentence each on
why the coverage was adequate>

## Gaps / domains needing a second pass
<any domain where the orchestrator reconciliation noted disputed
findings/leads, sibling disagreement, or low coverage, plus a one-line
recommendation for follow-up>

## Rules that were enforced
- Real, current bugs only (no theoretical failure modes)
- No malloc-fail, OOM, hardware-fault findings
- Bug must match profile: ≥3 players, intermittent, no deaths/DCs,
  process-kill without Rust panic
- Every finding backed by a concrete code quote
```

**Ranking rule for "top suspects":** order by this tuple, descending —
`(status == corroborated, confidence == high, matches_all_four_profile_checks, file_is_in_priors_1_or_2)`. Ties broken by the orchestrator's judgment, but never fabricate evidence.

**Ranking rule for "top concrete leads":** order by this tuple, descending —
`(status == corroborated-lead, mechanism_specificity, has_direct_code_quote, file_is_in_priors_1_or_2)`.

---

## Orchestrator Discipline

- **You do not read C++ yourself.** You dispatch, receive, reconcile, write reports. Reading subagent results is your main source of information.
- **You do not rescue weak findings.** If a finding fails the anti-FP rules, it's out. Do not soften the rules to keep interesting-looking leads.
- **You do not silently merge corroborated findings that actually disagree.** "Both agents flagged `CombatSystem::fixedUpdate`" is not corroboration if one is talking about the attack chain and the other is talking about stamina regen. Check the mechanism, not just the file.
- **You do not summarize away detail.** Quoted code, file:line citations, and the step-by-step trigger sequences must survive into the final report verbatim. Humans read those, not your prose.
- **You do not spawn extra agents.** One for Phase 1, two per domain in Phase 2. That's it. No "cleanup passes," no "meta-review agents," no self-critique. If the plan seems to need it, it means the prompts above are wrong — write your concerns at the top of the final report and let a human decide.
- **You do not modify source files.** Ever. Not to "add a comment." Not to "test a hypothesis." The investigation is read-only.
- **You do write to the `docs/superpowers/reports/` directory** — this is where the three report files live. Create the directory if it doesn't exist.
- **You do not run git workflows and do not invoke `finishing-a-development-branch`** for this plan; this is analysis-only.

---

## Budget & Expected Cost

- Phase 1: 1 agent, moderate context (reads ~20 small headers + one FFI file). Expect ~1 round.
- Phase 2: 7–15 domains × 2 agents = 14–30 agents total. Each agent reads 2–6 files deeply. Sequential pacing means the orchestrator session sees ~15 rounds of tool output.
- Phase 3: orchestrator-only file write.

If an agent returns an empty or malformed response, retry **once** with a short clarification prefix. If the second attempt also fails, record that domain as `coverage: partial` in the gaps section and move on. Do not burn budget on a third retry.

---

## Starting Checklist for the Orchestrator

Before dispatching Phase 1, confirm:
- [ ] Working directory is the project root (contains `game-core/`, `backend/`, `bot/`).
- [ ] `game-core/src/cxx_bridge.hpp` exists and is readable.
- [ ] `backend/src/game/ffi.rs` exists and is readable.
- [ ] `docs/superpowers/reports/` directory exists, or is created now.
- [ ] You have reviewed the anti-FP rules section (Section "Absolute Anti-False-Positive Rules") and understand that your job is to enforce them, not relax them.

When all five boxes are checked, send the Phase 1 prompt.

---

## Self-Review of this Plan (for the human who is about to hand it off)

**Spec coverage:** The human asked for (1) one subagent to identify 7–15 domains, (2) sequential iteration over domains with two simultaneous subagents per domain, (3) clear briefing on context + expected output, (4) anti-false-positive framing to reject theoretical bugs + nits + malloc failures. All four are present.

**Failure modes in this plan that I explicitly accept:**
- If the Phase 1 agent picks bad domain boundaries, the Phase 2 agents inherit those boundaries. Mitigation: the corrective retry step and the `unconfirmed` status for single-reporter findings create some redundancy.
- The dual-agent-per-domain pattern assumes two independent good-faith investigators converge on the same real bug. If the bug is truly subtle, both may miss it — in which case the `NO HARD FINDINGS + concrete leads + eliminated candidates` output documents what was checked and what remains plausible.
- The orchestrator's job description asks for discipline it cannot fully self-enforce. If it fails, the final report will include false positives; the human reviewer catches those. This plan prioritizes recall over precision — a missed real bug is much worse than a few extra suspects to read.

**Known gaps to mention to the human on handoff:**
- This plan does not include dynamic analysis (ASan / UBSan / TSan / valgrind). If the hunt yields nothing, the next pass should be instrumented builds + the bot from the sibling plan `2026-04-13-bug-hunt.md`, not more static review.
- This plan does not cover the Rust FFI wrappers as investigation targets, because the bug profile (no panic) rules them out. If the first pass finds nothing and the humans lose confidence in the "no panic = not Rust" assumption, add one more domain covering `backend/src/game/ffi.rs` + `manager.rs` in a rerun.

**This plan is ready to hand to the orchestrator.**
