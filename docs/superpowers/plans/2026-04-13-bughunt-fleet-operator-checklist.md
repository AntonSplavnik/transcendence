# Bug Hunt Fleet Operator Checklist

Use this checklist before handing the orchestration plan to a fresh LLM.

- Confirm you are using `docs/superpowers/plans/2026-04-13-bughunt-fleet-orchestration.md` (latest edited version).
- Tell the orchestrator this is analysis-only: no source edits, no git actions, no PR/merge flow, no `finishing-a-development-branch`.
- Require Phase 2 to use asymmetric roles per domain: **Investigator A = Hunter**, **Investigator B = Skeptic**.
- Require two-tier domain output: **Hard Findings** + **Concrete Leads (not yet proven)**.
- Require strict no-hard-findings format: use `NO HARD FINDINGS` plus at least 3 **Eliminated candidates** with code quotes.
- Enforce anti-false-positive rules unchanged: no OOM/hardware/style/hypothetical-only claims, and race claims need mutex-gap proof.
- Ensure sequential domain processing with two parallel subagents per domain (no cross-domain parallelization).
- Ensure durable output files are produced under `docs/superpowers/reports/`: domains, findings, and final report.
