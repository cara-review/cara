---
status: accepted
relates: [0002, 0004, 0005, 0011]
---

# Coverage + gate semantics — `clear-diff gate` over the committed ledger

Owner greenlit the direction in-session (Refs #47): get the ledger "as close to fully featured (without signing) for role-based agent + human, with clear-diff operating off that." Written alongside the implementation and **review-gated** like ADR-0005 / TN-26-034 (semantics open to revision on owner review). Realises the `cara gate` fast-follow named in [TN-26-031](../tn/TN-26-031-review-ledger-pivot.md) / [TN-26-034](../tn/TN-26-034-cara-ledger-implementation-design.md). **Signing is out of scope** (still deferred), so this gate is advisory, not proof (see §Trust).

## Decision

### 1. The gate is a read-only plumbing verb — the ledger IS the gate

`clear-diff gate [--require …]` is a sixth plumbing verb (LLM-free, no key, like `atoms`/`submit`). It recomputes the live master list, folds the committed ledger (`refs/cara/ledger`) into `ReviewProgress`, evaluates `--require` predicates, and **emits one JSON report on stdout regardless of outcome**. A met bar exits 0; an unmet bar exits non-zero (a `UserFacingError`, reason on stderr) so CI gates on it. It replaces the marker-file hack (an agent writes "I reviewed" to a file) with a content-pinned, role-attributed fact.

### 2. The denominator is the canonical master list (the bijection)

Coverage is `met / total` over the master list recomputed live from `DiffSource` (ADR-0004) — never the agent's grouping, never a stored atom set. So coverage **decays with the content** (ADR-0002): edit a reviewed line and its atom's hash changes, dropping it from `addressed` until a reviewer re-looks. The bijection's integrity *is* the metric's credibility.

### 3. Roles a predicate may name

| role | numerator (over `total`) |
|---|---|
| `addressed` | atoms with any disposition (done/skipped) |
| `accounted` | atoms dispositioned **or** commented |
| `human` / `agent` | that tier's accounted footprint (per-tier, not a partition — TN-26-029) |
| `<label>` | atoms a labelled reviewer dispositioned (`byReviewer`, last-writer attribution) |

All four already exist in `ReviewProgress`; the gate adds no new core metric.

### 4. Predicate language

`--require <role>{=|>=}<percent>%`, comma-separated (e.g. `security=100%,human>=50%`). Both operators mean **"at least"** — a gate is a minimum bar. Comparison is exact integer ratio (`met*100 ≥ threshold*total`), never a rounded percent, so a 99.6% never false-passes a 100% bar. An **empty diff is vacuously met** (nothing to review). No `--require` → a coverage readout that never fails.

### 5. Trust gradient — advisory until signing

`signed-human > attributed-agent-role > unseen` (TN-26-031). Until signing lands, **every fact is attributed, not authenticated** — any writer with ref access can plant a tier (cf. ADR-0005). The gate's role coverage is therefore **advisory**: it proves what writers *claimed*, not who approved. `gate-defaults-to-verified` (the gate preferring signed facts, treating unsigned as a lower tier) is the invariant for when signing arrives; stated here, **not built**.

## Deferred (fast-follow)

- **Signing + a `signed-human` predicate** — the irreducible "proof" core (TN-26-031 §B).
- **Scrutiny predicates** — `accounted − commented` (a bare-disposition sweep) is recorded in `progress.scrutiny` and surfaced, but not yet gateable; the anti-rubber-stamp predicate (e.g. `agent:commented>=50%`) is the obvious next step.
- **Repo-wide coverage** — per-diff first (this ADR); the blame-attributed dark-matter map is later (TN-26-031).
- **Fact metadata** (model, thinking-mode) — descriptive, never gate-trusted.

## Consequences

- CI can gate on per-diff role coverage today, off a fact that cannot go stale.
- It is **per-diff only** and **advisory** (unsigned) — both must be stated wherever the number is shown, never sold as proof.
- No core change: the verb is policy (predicates + exit code) over the existing `ReviewProgress`; coverage semantics stay in the domain, gating stays at the CLI adapter.
