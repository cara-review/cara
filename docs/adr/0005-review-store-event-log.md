---
status: accepted
---

# ReviewStore persistence: append-only event log on a committed ledger

The `ReviewStore` port (ADR-0003) persists dispositions and comments keyed by atom hash (ADR-0004), per review context, surviving sessions. This ADR fixes *how*: an **append-only event log folded to current state on each open**, stored as a **committed orphan-ref ledger** (`refs/cara/ledger`). It adopts the modelling discipline of event sourcing (facts on stable identity, state derived by projection) and rejects DCB's consistency machinery as overhead for a single local writer.

The event-log model and the `project` fold are unchanged. What the CARA pivot changed (TN-26-031, TN-26-034, owner-approved): *where the bytes live* — gitignored per-clone JSONL → a **shared, committed git ledger** — and the consequences of that move (order, travel, privacy).

## Context

ADR-0003 introduces `ReviewStore` and sketches its adapter as "fs JSON (→ sqlite)" without fixing the internal model. ADR-0004 constrains what it may hold: dispositions keyed by atom hash only, never the atom set (recomputed live every run). Two questions follow: mutable state vs append-only history, and where the bytes live.

Marks are already event-shaped: a mark is a fact (`marked` / `unmarked` / `commented`) on a **stable content identity** (the atom hash, ADR-0002), decoupled from line numbers and from the disposable Chapter/Section grouping, carrying a channel-inferred author tier (`human` | `agent`, ADR-0011). Storing those facts append-only rather than as a mutable map is barely more code and yields undo, history, and the audit trail nearly for free.

The CARA pivot reframes a review as a **durable repo fact**, not disposable local state: a committed ledger others can fetch, verify (later), and gate on. The fact shape (`MarkEvent`) and the port (`load`/`append`) are unchanged — only the adapter and its storage move.

## Decision

The `ReviewStore` is an **append-only event log per context, persisted on the committed orphan ref `refs/cara/ledger`**.

- Event = a `MarkEvent` (`atomHash`, `author`, `payload`, `ts`); `type` ∈ `marked` / `unmarked` / `commented`.
- Live state = a pure `project(events)` fold, recomputed on each open.
- Undo = append a compensating event.
- **Storage:** an orphan commit chain holding a tree of content-addressed fact blobs, `<contextHash>/<factId>.json`. Manipulated via git **plumbing only** (`hash-object`, `commit-tree`/`mktree`, `update-ref`) — **never checked out**: a fact *about* a change must not appear as a working-tree change. One `append` = one commit (parent = current tip).

### Order comes from commit topology, not blobs

The fold is **order-dependent**: marks are last-write-wins and `commentId` is the **ordinal** among `commented` events. A content-addressed blob tree has **no inherent order**, and `ts` collides under a fixed clock. So append order is **reconstructed from the ref's first-parent commit walk** (one commit per append ⇒ first-parent walk = total append order) — never from blob names or `ts`. This is load-bearing: an order-losing read silently corrupts comment ids and last-write-wins.

### Concurrency and travel

- **Content-addressed `factId`** dedupes identical facts and keeps concurrent writes on **disjoint tree paths**, so git's tree merge is a clean union — the concurrent-reviewer story.
- The ledger rides git but needs an explicit refspec to push/fetch (notes-like): configure `refs/cara/*`. Auto-configuring travel is out of scope this batch beyond a documented one-liner; the adapter reads/writes the local ref.

## Considered options

- **Mutable map keyed by atom hash** — *rejected.* Simplest store, but discards history: no undo, no audit trail, and when reviewed lines are edited (h1→h2, atom resurfaces per ADR-0002) the prior disposition on h1 is lost rather than recallable as "you reviewed an earlier version."
- **Append-only event log** — *chosen.* At review scale (hundreds of atoms, low-thousands of events) the whole log folds in memory instantly — **no compaction, ever**.
- **Gitignored per-clone JSONL** (the original adapter) — *superseded.* Correct while a review was disposable local state, but it cannot be shared, fetched, or gated on. The CARA pivot needs the review committed; JSONL survives only as a test seam if one is needed. No migration of existing local logs — they were disposable runtime state.
- **Full DCB (tags + dynamic consistency boundary + append conditions)** — *rejected.* DCB's machinery arbitrates concurrent writers over overlapping entity sets; here writes land on disjoint content-addressed paths and merge cleanly, so it is pure overhead. Multi-tag queries also need several stable tags to bite, but the only durable identity is the atom hash — Chapters/Sections are disposable and must never enter the log (ADR-0002, ADR-0004). With one stable identity, DCB collapses to a plain atom-keyed log.

## Consequences

- **ADR-0004 still holds, exactly.** The ledger holds only dispositions and comments **keyed by `atomHash`, never the atom set** — the master list is recomputed live from `DiffSource` every run. The new adapter preserves this as the JSONL adapter did.
- **A review becomes a committed, shared record.** Both tiers (human via browser, agent via CLI) persist through the same port to the same ledger. The browser path is unchanged — "the UI writes to the CARA ledger" is one composition-root swap plus the adapter.
- **Privacy follow-up (open).** Per-person review activity is now a committed repo fact, not local-only state. Read access, redaction, and aggregation need a stance — see Open.
- **gate-defaults-to-verified** is the standing invariant for when signing/gating arrive: a gate trusts only verified facts. **Not built this batch** — signing is deferred; facts are **attributed-only** now (channel-inferred tier, no signature). Recorded here so the gate is designed against it later (TN-26-034 §Deferred).
- Undo and history come free from the fold; surfacing them in the UI is a separate, deferrable decision.
- Context identity must be stable across runs or marks die between invocations: the head branch (or `base..head`) for a worktree review, the PR number for `--pr N`. **Context is resolved by the `DiffSource` adapter, not the application** — context identity is source/git knowledge, so it lives behind the port; the domain never computes it. `DiffSource` exposes `resolveContext(spec): Promise<ReviewContext>`, core exports a `reviewContext(string)` smart-constructor to brand the key, and `ReviewService.open` reads the context from the adapter.
- A later sqlite or other adapter keeps the same `MarkEvent` shape behind the port.

## Open

- **Privacy of the committed ledger.** A committed per-person review record needs a stance on read access, redaction, and aggregation. Fast-follow.
- **Surface undo/history in v1?** Cheap given the log, but a UI call, deferrable without changing the format.
- **Multi-atom events.** If one action genuinely relates to several atoms (a comment spanning a hunk boundary; a batch dispatch), an event may carry a list of hashes — still not DCB, just a multi-key event.
