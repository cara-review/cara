---
status: accepted
---

# ReviewStore persistence: append-only event log

The `ReviewStore` port (ADR-0003) persists dispositions and comments keyed by atom hash (ADR-0004), per review context, surviving sessions. This ADR fixes *how*: an **append-only event log folded to current state on each open**, not a mutable record. It adopts the modelling discipline of event sourcing (facts on stable identity, state derived by projection) and rejects DCB's consistency machinery as overhead for a single local writer.

## Context

ADR-0003 introduces `ReviewStore` and sketches its adapter as "fs JSON (→ sqlite)" without fixing the internal model. ADR-0004 constrains what it may hold: dispositions keyed by atom hash only, never the atom set (which is recomputed live every run). The open question is mutable state vs append-only history.

Marks are already event-shaped: a mark is a fact (`marked` / `unmarked` / `commented`) on a **stable content identity** (the atom hash, ADR-0002), decoupled from line numbers and from the disposable Chapter/Section grouping. Storing those facts append-only rather than as a mutable map is barely more code and yields undo, a history view, and the "audit trail" V2 (concept.md "Out of Scope") nearly for free.

## Decision

The `ReviewStore` adapter is an **append-only event log per context**.

- Event = `{ ts, type, atomHash, payload }`; `type` ∈ `marked` / `unmarked` / `commented`, plus lightweight session markers.
- Live state = a pure `project(events)` fold, recomputed on each open.
- Undo = append a compensating event.

## Considered options

- **Mutable map keyed by atom hash** — *rejected.* Simplest store, but discards history: no undo, no audit trail, and when reviewed lines are edited (h1→h2, atom resurfaces per ADR-0002) the prior `done` on h1 is lost rather than recallable as "you reviewed an earlier version."
- **Append-only event log** — *chosen.* At review scale (hundreds of atoms, low-thousands of events) the whole log folds in memory instantly — **no compaction, ever**. A later sqlite adapter (ADR-0003) keeps the same event shape.
- **Full DCB (tags + dynamic consistency boundary + append conditions)** — *rejected.* DCB's distinguishing machinery exists to arbitrate concurrent writers over overlapping entity sets; clear-diff is single user, single process, one review at a time, so it is pure overhead. Its multi-tag queries also need several stable tags to bite on, but the only durable identity here is the atom hash — Chapters/Sections are disposable and must never enter the log (ADR-0002, ADR-0004). With one stable identity, DCB collapses to a plain atom-keyed log.

## Consequences

- The ADR-0003 adapter is append-only JSONL per context, in per-clone runtime state, surviving sessions (ADR-0002). Not consolidated across contexts — each log stays tiny.
- Holds only dispositions and comments keyed by atom hash, never the atom set (ADR-0004). The set is still recomputed live each run.
- Undo and history come free from the fold; surfacing them in the UI is a separate, deferrable decision.
- Context identity must be stable across runs or marks die between invocations: the head branch (or `base..head`) for a worktree review, the PR number for `--pr N`.
- **Context is resolved by the `DiffSource` adapter, not the application** (added #9, owner-approved). Context identity is source/git knowledge — the head branch is not derivable from the `DiffSpec` shape alone — so it lives behind the port; the domain never computes it. `DiffSource` gains `resolveContext(spec): Promise<ReviewContext>`, and core exports a `reviewContext(string)` smart-constructor the adapter uses to brand the key. `ReviewService.open` reads the context from the adapter.

## Open

- **Surface undo/history in v1?** Cheap given the log, but a UI call, deferrable without changing the format.
- **Multi-atom events.** If one action genuinely relates to several atoms (a comment spanning a hunk boundary; `go` dispatching a batch), an event may carry a list of hashes — still not DCB, just a multi-key event.
