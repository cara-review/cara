---
number: 26-035
title: Ledger gate + role coverage (no signing) — cara operating off the committed ledger
kind: plan
status: active
issue: "#47"
tags: [cara, ledger, gate, coverage, role, cli]
---

# TN-26-035: Ledger gate + role coverage (no signing)

Owner directive (in-session, Refs #47): take the CARA ledger "as close to fully featured (without
signing) for role-based agent + human, with cara operating off that." Builds directly on the
landed ledger ([TN-26-034](TN-26-034-cara-ledger-implementation-design.md)); realises the `cara gate`
fast-follow from [TN-26-031](TN-26-031-review-ledger-pivot.md). Decision record: [ADR-0013](../adr/0013-coverage-and-gate-semantics.md).

## Delivered

A sixth plumbing verb, `cara gate [--require …]` — LLM-free, read-only:

- Recomputes the live master list (the bijection, ADR-0004) and folds the committed ledger into
  `ReviewProgress`; coverage decays with content (ADR-0002).
- `--require <role>{=|>=}<percent>%`, comma-separated (e.g. `security=100%,human>=50%`). Roles:
  `addressed`, `accounted`, the tiers `human`/`agent`, `<tier>:commented` (substance over a sweep —
  the anti-rubber-stamp lever), or a reviewer label. Exact-ratio comparison; empty diff vacuously
  met; no `--require` is a readout that never fails.
- Emits a JSON report on stdout regardless; a met bar exits 0, an unmet bar exits non-zero (reason on
  stderr) so CI gates on it. Replaces the marker-file hack.

**Role-based agent + human already hold:** every mark carries a channel-inferred `author`
(`tier: human|agent`, optional `reviewer` label, ADR-0011) — unforgeable, persisted to the ledger.
The gate is the read-side that aggregates by role.

Tests: verb contract + parser grammar (unit), and a 5-atom two-reviewer e2e (security 2 / quality 3)
asserting per-role coverage, a met bar (exit 0), an unmet `human` bar (exit non-zero, report still
emitted), and a bare readout.

## Not built (still fast-follow)

- **Signing** — so the gate stays **advisory, not proof** (every fact attributed-not-authenticated; ADR-0013 §Trust). `gate-defaults-to-verified` is stated, not built.
- **Per-label scrutiny** (`security:commented`) — needs `byReviewer` to carry comment counts; `<tier>:commented` already ships.
- **Repo-wide coverage** via blame; **fact metadata** (model, thinking-mode).
- **Travel** stays a documented `refs/cara/*` refspec one-liner (TN-26-034 §Travel); not auto-configured.
