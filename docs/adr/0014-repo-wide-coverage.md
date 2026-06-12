---
status: accepted
relates: [0002, 0004, 0005, 0011, 0013]
---

# Repo-wide coverage — cross-context fact union over a baseline range

Owner greenlit building this in-session (Refs #47), reviewed alongside the code like ADR-0005 / ADR-0013 (semantics open to revision on owner review). Realises the **repo-wide coverage** fast-follow ([TN-26-031](../tn/TN-26-031-review-ledger-pivot.md) "the prize"; [TN-26-035](../tn/TN-26-035-ledger-gate-role-coverage.md)). Design + review trail: [TN-26-036](../tn/TN-26-036-repo-wide-coverage-and-fact-metadata.md). Signing stays deferred, so repo-wide coverage is **advisory, not proof** — and at repo scale that caveat is load-bearing (§7).

## Problem

[ADR-0013](0013-coverage-and-gate-semantics.md) gates coverage of **one diff**, against facts from **that diff's context**. The product prize (TN-26-031) is the per-repo readout — "across `main` since adoption: 100% security-attributed, 80% architecture, 40% human; here are the unseen files" — a role map over a whole range, not a single review. Two things block it:

1. **Facts are partitioned by context.** `ReviewStore.load(context)` returns one review's facts (keyed `contextHash(context)`). A range spanning many reviews sees none of them.
2. **No canonical per-line atom.** Atom identity is `sha256(path + payload)` over a `-U0` hunk (ADR-0002, `identity.ts`), and hunk boundaries are **diff-relative** — the "atom for a line" depends on which base..head produced it. There is no diff-independent "atom that introduced line N".

## Decision

### 1. Coverage of a range's master list, against a cross-context fact union

Repo-wide coverage is the existing coverage computation with two changes:

- **Denominator** — the master list of a **baseline→target range**, recomputed live from `DiffSource` exactly as a normal review (ADR-0004). It is an ordinary `DiffSpec` range: `--range <baseline>..<target>` maps to `{ kind: "range", base: baseline, head: target }`; `base` = the adoption/release baseline, `head` = the target (default worktree/HEAD). This is the net introduced content since the baseline.
- **Numerator** — the **union of all facts in the ledger, folded by atom hash**, regardless of context. New port method `ReviewStore.loadAll(): Promise<readonly MarkEvent[]>` returns every fact (see §2 for its contract).

A master-list atom is "reviewed by role R" iff **some** fact anywhere in the ledger, from role R, addresses that atom hash.

### 2. `loadAll()` — a deliberately *unordered* read

`load(context)` returns a **per-context ordered** stream: order is load-bearing (ADR-0005 — `commentId` ordinals and last-write-wins are reconstructed from the first-parent commit walk). `loadAll()` unions facts across **all** contexts, where **no global order exists** (independent commit topologies; a fixed clock collides `ts`). So the contract is explicit and part of the seam:

> `loadAll()` returns every fact with **no ordering guarantee**. It is consumable **only** by order-independent folds (`repoProgress`, §3); it must **never** be passed to `project()`. That ordering difference from `load()` is the whole reason it is a distinct method, not `load()` over a synthetic all-context key.

A grouped `Map<ReviewContext, …>` return was considered and rejected: the ledger stores only `contextHash` (the context string is one-way hashed, ADR-0005), so the adapter *cannot* recover `ReviewContext` keys, and grouping by `contextHash` would leak the storage layout into the port. Flat-and-unordered is the only domain-neutral shape.

*(Adapter — GitLedgerStore.)* `loadAll` walks the first-parent commit chain once and reads every added fact across all storage prefixes — O(total facts). The domain sees only `MarkEvent[]`; the per-context tree layout (ADR-0005) never reaches core.

### 3. The fold is existence-based — `repoProgress`

Per-context `reviewProgress` is last-write-wins (the latest disposition is the state). Repo-wide asks a **union-of-attention** question — "did role R *ever* attend to this content" — so `repoProgress(masterList, allFacts)` folds by **existence**: per atom hash, the *set* of tiers/labels that dispositioned it and the *set* of tiers that commented. Every per-context-ordered field is re-derived as a set-fold, in lockstep:

- `addressed` — atoms with ≥ 1 disposition from any fact.
- `byReviewer[label]` — atoms a label dispositioned, credited iff **some** fact under that label addresses the atom (**not** last-writer, which is meaningless cross-context). This is the field every "100% security" example rides on; its *meaning* shifts from last-writer to existence, exactly like `addressed`/`scrutiny`.
- `scrutiny[tier]` — per-tier accounted/commented as existence sets.

`repoProgress` returns a `ReviewProgress`-shaped value, so the gate predicate evaluator (`gate.ts roleCount`, ADR-0013) runs **unchanged** — `--require security=100%,human>=50%` resolves through the same fields. Only the fold strategy differs; the output contract is identical.

### 4. Content-decay is honoured for free — but credit is content *and path* (ADR-0002)

Only atoms whose content appears in the target range's master list are in the denominator. The hash is `path + payload` (`identity.ts`), so a review credits the range iff its hunk's **path and payload** still match. Two consequences, both consistent with ADR-0002:

- An **edit** to reviewed lines changes the payload → new hash → the prior review drops out. Coverage falls automatically as code changes, rises only when a reviewer re-attends. A stale review never inflates the number.
- A **rename** across the baseline changes `path` → new hash → the prior review also drops out, even though the *content* is byte-identical. "Reviewed identical content" is scoped to identical path too. Whole-history rename-following is the deferred blame path (§Alternatives), not a v1 promise.

### 5. The dark-matter map — `--by-file`

`gate --repo --by-file` groups the master list by path and runs `repoProgress` per file, emitting per-file role coverage plus an **unseen** list (files with zero facts) — the "for every file, which roles attended" map TN-26-031 calls the prize. This is a **readout**, not a gate: predicates still evaluate on the aggregate and own the exit code; `--by-file` only adds the per-file artefact to the envelope.

### 6. Surface

A mode on the existing verb: `clear-diff gate --repo [--by-file] [--require …] [--range <baseline>..<target>]`. `--repo` swaps the per-context numerator for the cross-context union; everything else (predicate grammar, JSON envelope, exit code) is ADR-0013 unchanged. Default `gate` (per-context, the current review) is untouched.

### 7. Trust at repo scale — advisory, with two hard rules

The cross-context union **multiplies the forgery blast radius** of the already-conceded "attributed-not-authenticated" gap (ADR-0013 §Trust, M1). Pre-`--repo`, a forged `security` fact under a throwaway context credited only that context's gate. Post-`--repo`, one forged fact under **any** context credits its content across **every** range gate, repo-wide, until that content changes. Content-addressing globalises *what was examined*, never *who is trusted to claim it* — §2's cross-context credit is sound for **content identity**, not for **trust**. So:

- The `--repo` JSON envelope carries `"trust": "advisory-unsigned"`, and every percent is emitted with its scope+trust caveat in the **machine** output, not only docs — so a CI consumer can branch on it. `--repo` **must not be the sole merge gate** while facts are unsigned; `gate-defaults-to-verified` (ADR-0013 §5) is the precondition for it to gate anything load-bearing.
- An **empty net range is `indeterminate`, never a vacuous pass** (a distinct, non-zero, non-failure exit code). A zero-atom denominator repo-wide almost always means a misconfigured baseline/target, not "nothing to review" — so unlike the per-diff vacuous-met rule (ADR-0013 §4, unchanged), `--repo` refuses to report a silent green over an empty set. *(Owner-ratify: this deliberately diverges from ADR-0013 §4.)*

## Alternatives considered

- **`git blame` per-line attribution (deferred).** Blame each line at HEAD → introducing commit → recompute that commit's `-U0` hunk → hash → match the ledger; gives whole-history per-line coverage including pre-baseline and rename-following. Deferred: it credits a review only when its diff produced the *same* hunk as the per-commit diff (squashed-PR reviews rarely match → numerator collapses), and whole-repo blame + per-commit re-diff is heavy. The range model uses the *same* diff machinery reviews use, so hashes match on unchanged content, and "since baseline" is the TN's own answer to "forward from adoption vs all history".
- **A separate `map`/`coverage` verb for `--by-file` (deferred, flagged).** The per-file map is reporting, not gating — arguably it belongs on its own read-only verb, leaving `gate` purely pass/fail. Kept on `gate` for v1 to avoid a second surface; **if the map grows** (severity, history, JSON-for-tooling) it earns its own verb. *(Owner-ratify: gating vs reporting on one verb.)*
- **A new `coverage` verb instead of a `--repo` flag (rejected).** Same predicates, exit code, and envelope as `gate` → a flag keeps one surface and one evaluator.
- **Last-write-wins `project` over the union (rejected).** Cross-context last-write is meaningless (whose "last"? `ts` collides; contexts are independent). Existence is the only coherent cross-context semantics.

## Consequences

- The per-repo, per-role, content-pinned readout TN-26-031 calls the prize — informational in CI (`gate --repo --require …`) and mappable (`--by-file`).
- **Advisory, not proof, and baseline-scoped.** Until signing: forgeable (§7), and pre-baseline content is *out of scope*, not "unseen". Both caveats ship in the machine output, never just docs.
- New port surface: `ReviewStore.loadAll()` (read-only, unordered §2). The cross-context read is deliberate (§2); it never writes across contexts and never holds the atom set (ADR-0004 intact). `meta` (ADR-0015) collapses to one existence bit per (atom hash, role) here — it can never inflate a coverage number.
- **Cost: `loadAll` is O(total facts) on the CI hot path** (every `--repo` run re-walks the ledger). The existence fold lets `loadAll` stream rather than materialise; because the ledger is append-only, a follow-up may snapshot the union keyed by ledger-tip SHA (a tip-keyed cache is sound). The unbounded-history walk is a known, tracked cost — and review activity is agent-appendable (ADR-0005 has no rate limit), so it is not a hard bound.
