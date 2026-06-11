---
number: 26-034
title: CARA ledger — implementation design (git-committed ReviewStore over refs/cara/ledger)
kind: proposal
status: active
issue: "#47"
tags: [cara, ledger, persistence, adapter, git-notes, implementation, plan]
---

# TN-26-034: CARA ledger — implementation design

Owner-approved direction (in-session): build the CARA audit ledger as a **committed git store**
and rewire clear-diff so the browser (and CLI) review path persists there instead of the local
gitignored JSONL. ADRs written **alongside** code (owner greenlit the shape; review-gated).
Lands on the **`feat/cara-ledger`** branch, **not main**.

Scope this batch (from [TN-26-031](TN-26-031-review-ledger-pivot.md) /
[TN-26-033](TN-26-033-ai-review-gate-market-scan.md)): **ledger persistence + UI writes to it,
attributed facts.** Signing, the `cara gate`/coverage verbs, repo-wide blame, and fact metadata
are explicit **fast-follow** (§Deferred).

## The key insight — no domain change, no new port

The review fact already exists: a `MarkEvent` (`marks.ts`) carrying `atomHash`, `author`
(`{ tier: human|agent, reviewer: string|null }`, channel-inferred — ADR-0011 §5/§6), and `ts`.
It is persisted through the `ReviewStore` port (`load`/`append`), implemented today by
`JsonlReviewStore` writing gitignored JSONL under `.agent-state/`.

**CARA-ledger-this-batch = a second `ReviewStore` adapter that writes to git instead of a local
file, swapped in at the composition root (`compose.ts:68`).** Nothing in core changes. Because
facts stay **attributed** (no signature this batch), the architect's CRITICALs about a
crypto-bearing domain fact / `verify` returning tier / wire-format-as-core-contract **do not
bite** — there is no new port and no domain type change. They return when signing lands.

Carried invariant ([ADR-0004](../adr/0004-agent-untrusted-master-list.md)): the ledger holds
**facts keyed by `atomHash` only, never the atom set** — the master list is recomputed live from
`DiffSource` every run. The new adapter must preserve this exactly as `JsonlReviewStore` does.

## Storage — `refs/cara/ledger`

An **orphan ref** (outside the working tree, outside normal history), holding a tree of
content-addressed fact blobs:

```
refs/cara/ledger  (orphan commit chain)
└── <contextHash>/            # per ReviewContext (same key JsonlReviewStore derives)
    └── <factId>.json         # one MarkEvent; factId = hash of the canonical fact
```

- **Working tree untouched.** Manipulate the ref via git **plumbing** (`hash-object`,
  `commit-tree`/`mktree` or an index, `update-ref`) — never check the ledger out. A review fact
  about a change must not itself appear as a working-tree change.
- **`append` = one commit** on `refs/cara/ledger` (parent = current tip) adding one blob.
- **Content-addressed `factId`** dedupes identical facts and keeps concurrent writes on
  **disjoint paths** → git's tree merge is a clean union (the concurrent-reviewer story).
- **`load(context)`** reads the blobs under `<contextHash>/`.

### The one real wrinkle — event order

The fold (`project`, `marks.ts`) is **order-dependent**: marks are last-write-wins and
`commentId` is the **ordinal** among `commented` events. A content-addressed blob tree has **no
inherent order**, and `ts` collides under a fixed clock (the code notes this). So the adapter
**must reconstruct append order** — derive it from the **commit topology** of `refs/cara/ledger`
(one commit per append → first-parent walk = total append order), not from blob names or `ts`.
This is the load-bearing detail the adapter issue must get right; an order-losing implementation
silently corrupts comment ids and last-write-wins.

### Travel

The ledger rides git but needs an explicit refspec to push/fetch (notes-like): configure
`refs/cara/*`. Out-of-scope to auto-configure this batch beyond a documented one-liner; the
adapter just reads/writes the local ref.

## Composition rewire

`compose.ts` constructs `new JsonlReviewStore(config.stateDir)` and injects it into
`createReviewService`. Replace with `new GitLedgerStore(config.cwd)`. The browser path
(`ReviewService.mark/comment/...`) is unchanged, so **"the UI writes to the CARA ledger"** is
that one swap plus the adapter. Both tiers (human via browser, agent via CLI) then persist to the
ledger through the same port.

Decision for the team: **replace** `JsonlReviewStore` outright (owner: "instead of whatever it
was doing"), keeping the class only if a test seam needs it. No dual-write, no migration of
existing local logs (they are disposable runtime state, ADR-0005).

## ADR work (alongside, review-gated)

- **Rewrite [ADR-0005](../adr/0005-review-store-event-log.md)** — persistence model:
  local-isolated gitignored JSONL → **committed orphan-ref ledger** (`refs/cara/ledger`). Keep
  the append-only event-log discipline and the fold; change only *where bytes live* and that they
  are now shared/committed. Record the order-from-commit-topology decision and the still-holding
  ADR-0004 constraint. Flag the **privacy** consequence (per-person review activity becomes a
  committed record) as an open follow-up, and note **gate-defaults-to-verified** as the invariant
  for when signing/gating arrive (not built here).

## Deferred — explicit fast-follow

- **Signing** (human-signed vs attributed-agent facts; the `Attestation` port; offline verify).
  This is where the architect's domain-fact-stays-crypto-free guidance applies — design then.
- **`cara gate` / coverage verbs** (and the gate-defaults-to-verified default).
- **Repo-wide coverage** via blame (TN-26-031 / TN-26-033).
- **Fact metadata** (model, thinking-mode, etc. — descriptive, never gate-trusted).

## Issue breakdown

1. **ADR-0005 rewrite + this design** — the architecture record; owner-review-gated. (Small.)
2. **`GitLedgerStore` adapter** — implements `ReviewStore` over `refs/cara/ledger`: plumbing-based
   append-as-commit (working tree untouched), `<contextHash>/<factId>.json` layout, **order from
   commit topology**, ADR-0004 constraint, reuse the `isMarkEvent`/author-tier validation. Unit
   tests including order-preservation and concurrent disjoint-append merge. (Medium.)
3. **Composition rewire + e2e** — swap the store in `compose.ts`; an e2e proving a browser mark
   lands as a fact in `refs/cara/ledger` and reloads identically across a fresh process; document
   the `refs/cara/*` refspec. (Medium.)

Dependency: (1) settles contracts → (2) and (3) parallelise after, (3) consumes (2)'s adapter.

## Delivery

- All work lands on **`feat/cara-ledger`** (worktrees branch off it, merge back to it) — **never
  main**. Pre-push hook is the quality gate; **never `--no-verify`**.
- No rename — stays clear-diff; the ledger is a new capability behind the existing port.
