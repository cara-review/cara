---
status: accepted
relates: [0002, 0004, 0005, 0011, 0013]
---

# Repo-wide coverage — cross-context global fact index over a baseline range

Owner greenlit building this in-session (Refs #47), reviewed alongside the code like ADR-0005 / ADR-0013. Realises the **repo-wide coverage** fast-follow ([TN-26-031](../tn/TN-26-031-review-ledger-pivot.md) "the prize"; [TN-26-035](../tn/TN-26-035-ledger-gate-role-coverage.md)). Design: [TN-26-036](../tn/TN-26-036-repo-wide-coverage-and-fact-metadata.md). Signing stays deferred, so repo-wide coverage is **advisory, not proof** (ADR-0013 §Trust).

## Problem

[ADR-0013](0013-coverage-and-gate-semantics.md) gates coverage of **one diff**, against facts from **that diff's context**. The product prize (TN-26-031) is the per-repo readout — "across `main` since adoption: 100% security, 80% architecture, 40% human; here are the never-seen files" — a role map over a whole range, not a single review. Two things block it today:

1. **Facts are partitioned by context.** `ReviewStore.load(context)` returns one review's facts (keyed `contextHash(context)`). A range spanning many reviews sees none of them.
2. **No canonical per-line atom.** Atom identity is `sha256(path + payload)` over a `-U0` hunk (ADR-0002), and hunk boundaries are **diff-relative** — the "atom for a line" depends on which base..head produced it. So there is no diff-independent "the atom that introduced line N".

## Decision

### 1. Coverage of a range's master list, against a cross-context global fact index

Repo-wide coverage is the existing coverage computation with two changes:

- **Denominator** — the master list of a **baseline→target range** (`gate --repo --range <baseline>..<target>`), recomputed live from `DiffSource` exactly as a normal review (ADR-0004). This is the net introduced content since the baseline. Default target is the worktree/HEAD; the baseline is supplied (a release tag, an adoption ref).
- **Numerator** — a **global fact index**: every fact in the ledger, across **all** contexts, folded by atom hash. New port method `ReviewStore.loadAll(): Promise<readonly MarkEvent[]>` returns the whole ledger; the GitLedgerStore reads every fact blob under every `<contextHash>/` (it already lives under one ref).

A master-list atom is "reviewed by role R" iff **some** fact anywhere in the ledger, from role R, addresses that atom hash.

### 2. Crossing the per-context partition is sound — content-addressing makes a hash global

An atom hash is `path + payload` (ADR-0002): the same hash **is** the same content, wherever it was reviewed. So crediting a review of identical content from another context is not a leak — it is the correct answer. A security pass on file F in PR #12 *did* examine exactly the content that the `since-adoption` range still contains; the range view should say so. The per-context partition (ADR-0005) stays a **storage** detail; content identity is the semantic key, and it is global by construction.

### 3. Existence semantics, not last-write-wins

Per-context `reviewProgress` is last-write-wins (the latest disposition is the state). Repo-wide asks a **union-of-attention** question — "did role R *ever* attend to this content" — so the global fold is **existence-based**: per atom hash, the *set* of roles that dispositioned it and the *set* of tiers that commented. New core fold `repoProgress(masterList, allEvents)` produces a `ReviewProgress`-shaped result with existence counts, so the **same** gate predicate evaluator (ADR-0013) runs unchanged — `--require security=100%,human>=50%` means the same thing at repo scale.

### 4. Content-decay is honoured for free (ADR-0002)

Only atoms whose content appears in the target range's master list are in the denominator. A review whose lines were later edited produces a different hash, so it silently drops out of the numerator — coverage **falls automatically** as code changes and rises only when a reviewer re-attends the new content. A stale review never inflates the repo number. This is the TN-26-031 thesis ("a noun that stays", decaying with content) realised at repo scale.

### 5. The dark-matter map: a per-file breakdown

`gate --repo --by-file` groups the master list by path and runs `repoProgress` per file, emitting per-file role coverage plus a **never-seen** list (files with zero facts). Predicates still evaluate on the aggregate; `--by-file` is the readout. This is the "for every file, which roles attended" map TN-26-031 calls the prize.

### 6. Surface

A mode on the existing verb, not a new one: `clear-diff gate --repo [--by-file] [--require …] [--range <baseline>..<target>]`. `--repo` swaps the per-context numerator for the global index; everything else (predicate grammar, exit code, JSON envelope) is ADR-0013 unchanged. Default `gate` (per-context, the current review) is untouched.

## Alternatives considered

- **`git blame` per-line attribution (rejected for v1).** Blame every line at HEAD → introducing commit → recompute that commit's `-U0` hunk → hash → match the ledger. Gives whole-history per-line coverage including pre-adoption code. Rejected now: (a) it credits a review only when its diff produced the *same* hunk as the per-commit diff — squashed-PR reviews rarely match, so the numerator collapses; (b) whole-repo blame + per-commit re-diff is heavy. The range model sidesteps both: the denominator uses the *same* diff machinery reviews use, so hashes match on unchanged content, and "since baseline" is the TN's own pragmatic answer to "forward from adoption vs all history". Blame attribution stays a future refinement for the pre-baseline tail.
- **A new `coverage` verb (rejected).** Repo-wide wants the same predicates, exit code, and envelope as `gate`; a flag keeps one surface and one evaluator.
- **Folding the global index with last-write-wins `project` (rejected).** Cross-context last-write is meaningless (whose "last"? ts collides, contexts are independent). Existence is the only coherent cross-context semantics for "was it ever reviewed".

## Consequences

- The per-repo, per-role, content-pinned readout TN-26-031 calls the prize — gateable in CI (`gate --repo --require security=100%`) and mappable (`--by-file`).
- **Advisory, not proof** until signing (ADR-0013 §Trust) — and **scoped to the baseline range**: pre-baseline content is *out of scope*, not "never seen". Both must be stated wherever the number shows.
- New port surface: `ReviewStore.loadAll()` (read-only). The cross-context read is deliberate and justified by §2; it never writes across contexts and never holds the atom set (ADR-0004 intact).
- `loadAll` walks the whole ledger — O(total facts). Bounded by review activity; acceptable. A large monorepo's whole-history map (blame) remains the deferred, heavier path.
