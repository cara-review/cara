---
number: 26-022
title: Chat pane — chapter-level Q&A with the agent
kind: proposal
status: draft
issue: "#15"
tags: [chat, agent, ports, protocol, qa, hexagonal, security]
---

# TN-26-022: Chat pane — chapter-level Q&A with the agent

Wire the existing chat-pane chrome (`apps/web/src/ui/chat-pane.ts`, currently a disabled placeholder) to real Q&A: the reviewer asks free-form questions scoped to the focused Chapter ("is this backwards compatible?") and the agent answers. Ephemeral, distinct from durable line comments. Background for **ADR-0009** (status: proposed). **Both await owner approval before any implementation** (CLAUDE.md › Architecture policy).

## Why this is an architecture gate, not a feature

The feature cannot be built on existing seams. It needs **three new boundary crossings**, and one of them reverses a ratified security invariant:

1. **New agent capability — and the agent must read the diff for the first time.** `AgentPort` today is `proposeGrouping` only: the agent is handed atom **ids** and returns ids + titles + summaries, with **no channel to the diff content** (ADR-0004: "The diff is never agent-touched … so it has no channel to alter a single line"). Answering "is this backwards compatible?" requires the agent to **read the actual changed code**. That inverts the central guarantee of ADR-0004. It is a deliberate, owner-only decision, not an extension.
2. **New inbound use-case** on `ReviewService` (e.g. `ask(ctx, chapter, question)`).
3. **New cross-boundary WS RPC method** (e.g. `ask`) in the web↔node protocol (ADR-0003).

Each of these alone trips the CLAUDE.md gate (new port capability / layer use-case / cross-boundary channel). Combined with the ADR-0004 reversal, this is a hard stop: **do not code around it.**

## Context

- Chrome exists; composer is `disabled`, messaging deferred to this issue (see the file's own header comment).
- Q&A is **ephemeral** — visually distinct from durable comments, not persisted via `ReviewStore` (ADR-0005). It is a transient conversation, not a review artefact.
- Scope is the **visible focused Chapter** (ADR-0002 vocabulary), so the question + the agent's view are bounded to that Chapter's atoms.
- Agent answers are **untrusted text** (ADR-0004): render with `textContent`, never `innerHTML`; never let an answer drive an action.

## Proposal (sketch — details ratified in ADR-0009)

### 1. Q&A agent capability

Add a Q&A seam reachable over a port. Two options for the owner to choose:

- **(a) Extend `AgentPort`** with `answer(request) → unknown`.
- **(b) New sibling port** (e.g. `AgentChat`), keeping `AgentPort` grouping-only and structure-only.

Lean: **(b) a sibling port.** ADR-0004 makes `AgentPort` deliberately diff-blind; bolting a diff-reading method onto it muddies that contract. A separate port names the new trust posture explicitly: *this* port reads code, *that* one never does.

The request carries the Chapter's atoms **including their diff lines** + the question; the result is answer prose. Output is `unknown`, validated at the boundary, treated as untrusted overlay text.

### 2. `ReviewService.ask`

`ask(ctx, chapterIndex, question): Promise<{ answer: string }>` — resolves the Chapter's atoms from the current review, calls the Q&A port, returns the answer. No snapshot mutation (Q&A changes no review state).

### 3. WS protocol — `ask` method

Add to `RequestParams` / `ResultMap` (both `protocol.ts` mirrors):
- `ask: { context, chapterIndex, question }` → `{ answer: string }`.
- Validated in `dispatch.ts` like every other inbound message (untrusted boundary).

## Boundary — domain vs adapter

| Concern | Side |
|---|---|
| Q&A use-case (`ask`), question/answer shapes, Chapter scoping | **domain** |
| Q&A port interface + request/result types | **domain** |
| Which LLM, prompt shape, response parsing | **adapter** (Anthropic Q&A; Fake for tests) |
| Chat widget, dictation, ephemeral message list rendering | **adapter** (web) |
| WS framing of `ask` | **adapter** (node server / web rpc) |

No LLM/HTTP/WS concept may appear in the domain. The agent's answer-shape must not leak into domain types.

## The decision for the owner (ADR-0009)

1. **Approve the ADR-0004 reversal?** The agent gaining read access to diff content is the load-bearing call. ADR-0004's invariant is *agent never sees the diff*; Q&A requires it to. Acceptable because answers are untrusted overlay (never define/edit the change, never drive an action) — but it must be ratified, not assumed.
2. **Extend `AgentPort` (a) or add a sibling port (b)?** Lean (b).
3. **Ephemeral confirmed?** Q&A not persisted, not an egress artefact (contrast ADR-0007 `CommentSink`).

Until approval lands, the agent **stops**. No implementation, no workaround.

## Rejected / deferred

- **Reusing `proposeGrouping`** — structure-only and diff-blind by design; cannot answer a question.
- **Persisting Q&A via `ReviewStore`** — Q&A is ephemeral; the store is for durable dispositions/comments (ADR-0005).
- **Multi-Chapter / whole-review scope** — out of scope; question is Chapter-scoped per issue #15.
