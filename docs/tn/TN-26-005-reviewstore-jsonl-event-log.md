---
number: 26-005
title: Adapter — ReviewStore append-only JSONL event log
kind: plan
status: active
issue: "#7"
tags: [node, adapter, persistence, marks, event-log]
---

# TN-26-005: ReviewStore JSONL adapter

Wave 2, parallel-safe. `packages/node` only. Implements the `ReviewStore` port (ADR-0003) as an **append-only JSONL event log per review context** (ADR-0005), holding only MarkEvents keyed by atom hash, never the atom set (ADR-0004).

## Scope

- `JsonlReviewStore implements ReviewStore` — `load(context)` / `append(context, event)`.
- No new core types, no port changes. Builds against the seam as-is.

## Design

`packages/node/src/review-store.ts`:

- **One file per context.** Filename = `sha256hex(context)` + `.jsonl`. The context string is already stable across runs (head branch / `base..head` / PR number — `model.ts`); hashing makes it filesystem-safe regardless of slashes in branch names or `..` in ranges, and stable so marks survive sessions (ADR-0005).
- **`append`** — `mkdir -p` the root, then `appendFile` one `JSON.stringify(event) + "\n"`. Append-only; undo is a compensating event, never a rewrite.
- **`load`** — read file (missing → `[]`), split on `\n`, drop blanks, `JSON.parse` each line, narrow via `isMarkEvent`, return `MarkEvent[]` in append order. A corrupt line throws.
- Current state is **not** this adapter's concern — callers fold with core's `project` (ADR-0005). The store is dumb persistence.

### Storage location

The adapter takes a `rootDir` in its constructor — it owns *file layout*, not *policy on where*. The composition root passes per-clone runtime state under `.agent-state/reviews/` (gitignored, ADR-0005). Constructor injection keeps tests on a fresh `mkdtemp` dir and leaves the OS-dir-vs-repo-dir question to the wiring task.

### Leakage (CLAUDE.md / ADR-0003)

All persistence concerns — base dir, context→filename derivation, JSONL framing, `node:crypto`/`node:fs` — stay in this adapter. Core sees only `MarkEvent` and `ReviewContext`; nothing about files or lines leaks back.

## Tests (`review-store.test.ts`)

- append → load round-trip preserves event order;
- fold correctness through core's `project` (marked/unmarked/commented);
- context isolation (marks don't bleed between contexts; unknown context → `[]`);
- stable filename across `JsonlReviewStore` instances (survives sessions);
- on-disk format is newline-framed JSON carrying only hashes — no atom payload.

## Out of scope

Composition-root wiring, sqlite migration (same event shape, ADR-0005), surfacing undo/history in the UI.
