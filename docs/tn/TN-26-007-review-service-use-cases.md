---
number: 26-007
title: Application — ReviewService use-cases
kind: plan
status: active
issue: "#9"
tags: [core, application, hexagonal, use-cases]
---

# TN-26-007: ReviewService use-cases

Wave 2, parallel-safe. `packages/core` application layer: the concrete `ReviewService` (the single inbound port, ADR-0003) that orchestrates the driven ports into use-cases. Depends only on port interfaces + domain — builds and tests against in-memory fakes, no git/fs/LLM. Implements ADR-0004 (canonical master list, agent-untrusted grouping) and ADR-0005 (event-log marks) by composing the already-landed pure domain.

## Module

`packages/core/src/review-service.ts` — `createReviewService(deps): ReviewService` (factory + closure, matching the repo's functional style; no class, no DI framework). `ReviewServiceDeps` is the manual-injection seam.

## Ports orchestrated

`DiffSource`, `ReviewStore`, `AgentPort`, `InstructionsSource`, `EditorPort`, `ClockPort`. Not needed by these use-cases, so not injected: `WorkspaceReader`/`ConfigPort` (UI reads evidence and the editor adapter reads config at the composition root).

## Use-cases

- **`open(spec)`** — `diff → buildMasterList` (canonical, agent-free) → `agent.proposeGrouping({atoms, instructions})` → `repairGrouping` (bijection, ADR-0004) → `diffSource.resolveContext(spec)` → assemble snapshot. Master list and grouping cached in memory per context.
- **`mark` / `unmark` / `comment`** — append a `MarkEvent` (ts from `ClockPort`) via `ReviewStore`, then rebuild the snapshot from the live log. No re-diff, no re-group.
- **`openInEditor(path, line)`** — delegate to `EditorPort`.

## Snapshot assembly

`project(store.load(context))` → marks + comments; `reviewProgress(masterList, marks)` → counts (from the canonical list, never the grouping, ADR-0004). Snapshot is plain arrays/records (JSON-friendly for WS, ADR-0003).

## State model

- Marks: durable in `ReviewStore` (append-only log, ADR-0005). Re-folded live on every snapshot, so the snapshot always reflects the log.
- Computed `Review` (master list + disposable grouping): cached in memory per context so mutations skip re-diff/re-group (ADR-0004 "grouping is disposable, cached"). Mutating a context never opened throws — no silent no-op.

## ReviewContext resolution (owner-approved, #9)

Context identity is git/source knowledge — the worktree head branch is not derivable from the `DiffSpec` shape alone — so the **adapter owns it**, not the application. `DiffSource` gains `resolveContext(spec): Promise<ReviewContext>` (worktree → head branch, range → `base..head`, pr → `pr/N`); core exports a `reviewContext(string)` smart-constructor (trims, rejects empty, brands) the adapter uses. `open` reads the context from `resolveContext`. This satisfies ADR-0005 and removes the earlier app-layer derivation (an adapter-concept leak). ADR-0005 + ADR-0003 amended accordingly.

## Leakage

Application stays adapter-neutral: only port interfaces + domain types, no git/fs/HTTP/LLM specifics. Context derivation deliberately does **not** live here — it would have meant the app knowing git branch semantics; it sits behind `DiffSource` instead.

## Tests (`node --test`, in-memory fakes for every port)

open (counts, context from adapter, empty-diff degrades, good-proposal bijection, garbage→"Other changes" floor, instructions passed, resume from persisted marks); mark/unmark/comment (append + fresh snapshot, skip counts as addressed, comment leaves progress untouched, clock stamps ts, agent called once per open, re-open refreshes cache + preserves marks); context isolation across adapter-resolved contexts; `openInEditor` delegation; unopened-context guard; `reviewContext` constructor (trim + reject empty).

## Out of scope

Adapter implementations (git, fs store, Anthropic agent), HTTP/WS server, CLI, UI, the master-set-hash grouping cache across opens (premature).
