---
status: superseded
superseded-by: 0011
---

# Chapter Q&A: a diff-reading agent capability over a sibling port

> **Superseded by [ADR-0011](0011-cli-agent-protocol.md) (TN-26-026, Refs #47).** The
> pivot removes the in-process LLM and the chat surface entirely. There is no `AgentChat`
> driven port, no chat pane, no `ask` use-case or WS method. **Q&A is now a comment
> answer:** the reviewer comments freeform; the answer routes back to the caller and renders
> inline at the atom. The substance survives — answering still requires *reading* the diff,
> still produces untrusted overlay text, still never defines or changes the review (the
> ADR-0004 master-list invariant, as amended by ADR-0011, holds). Only the mechanism is
> gone: the capability moves outside the boundary to the single LLM porcelain. The
> sanitized-markdown rendering of answers (ADR-0010) carries forward, now applied to the
> inline answer instead of a chat pane.

Background: TN-26-022. Approved by owner 2026-06-06, delegated to coordinator (CLAUDE.md › Architecture policy).

The chat pane (issue #15) lets a reviewer ask free-form questions scoped to the focused Chapter ("is this backwards compatible?") and have the agent answer. Answering requires the agent to **read the changed code** — which ADR-0004 currently forbids. This ADR ratifies that reversal under tight constraints, adds a Q&A capability behind a new sibling port, an inbound `ask` use-case, and an `ask` WS method.

## Context

- `AgentPort.proposeGrouping` is deliberately **diff-blind**: handed atom ids, returns ids + titles + summaries (ADR-0004). That guarantees the agent "has no channel to alter a single line."
- Q&A is the first feature where the agent must **read** diff content. Reading ≠ defining: the master list (ADR-0004) still owns *what is in the review*; the agent still cannot add, remove, hide, or edit an atom. The new capability is **read-for-answer**, not write.
- Q&A is **ephemeral** — a transient conversation, not a durable review artefact (contrast comments, ADR-0005).

## Decision

### 1. The ADR-0004 invariant is refined, not broken

ADR-0004 stands: **the agent never *defines or changes* the change.** Counts and completion still derive from the master list; the grouping path stays diff-blind. This ADR adds one narrow exception: a **separate, read-only Q&A capability** may receive Chapter-scoped diff content to answer questions. Its output is untrusted overlay text — display-only, never authoritative, never drives an action — exactly the posture of agent summaries.

### 2. `AgentChat` sibling port (not an extension of `AgentPort`)

Add a driven port distinct from `AgentPort`, so the grouping contract stays diff-blind and the new trust posture is named explicitly:

| Port | Responsibility | Reads diff? | Adapter(s) |
|---|---|---|---|
| `AgentPort` | propose grouping (structure only) | **no** | Anthropic, Fake |
| `AgentChat` | answer a Chapter-scoped question | **yes (read-only)** | Anthropic, Fake |

- `answer(request): Promise<unknown>` — `request = { atoms, question, instructions }`, where `atoms` carry their diff `lines`. Result is `unknown`, validated at the boundary to `{ answer: string }`.
- Output is untrusted: escape on render, `textContent` never `innerHTML`, never interpreted as markup or action.

### 3. `ReviewService.ask` inbound use-case

`ask(ctx, chapterIndex, question): Promise<{ answer: string }>` — resolve the Chapter's atoms from the live review, call `AgentChat.answer`, return the prose. No snapshot mutation; Q&A changes no review state.

### 4. `ask` WS method

Add to the ADR-0003 contract (`packages/node/src/server/protocol.ts` + the `apps/web/src/protocol.ts` mirror):
- `RequestParams.ask = { context, chapterIndex, question }`; `ResultMap.ask = { answer: string }`.
- Validated in `dispatch.ts` as an untrusted message: `chapterIndex` a non-negative integer in range, `question` a non-empty string.

## What crosses the boundary

- **Out (`AgentChat`):** Chapter atoms (domain `Atom`s, git-verbatim lines) + question + instructions. The core does not know which LLM, prompt, or wire shape.
- **In (chat pane):** a question string → `ReviewService.ask`. The answer returns as plain domain data.

No LLM/HTTP/WS concept appears in domain types or names. If the core could tell which agent or transport it's talking to, the boundary has leaked (CLAUDE.md › no adapter-concept leakage).

## Consequences

- One new driven port, one inbound method, one WS method. Q&A testable against a `FakeAgentChat`.
- The agent gains **read** access to Chapter diff content — a genuine, ratified relaxation of ADR-0004, bounded to a read-only, untrusted-overlay capability that cannot alter the change.
- Q&A is ephemeral: nothing persisted, no egress artefact, no `ReviewStore` involvement.
- The grouping path remains diff-blind; ADR-0004's master-list invariant is untouched.

## Rejected

- **Extend `AgentPort` with `answer`** — contaminates the deliberately diff-blind grouping contract; a reader of `AgentPort` could no longer assume it never sees the diff. A sibling port keeps each trust posture legible.
- **Keep the agent diff-blind, answer from grouping summaries** — summaries can't answer "is this backwards compatible?"; the question needs the code.
- **Persist Q&A via `ReviewStore`** — Q&A is ephemeral; the store is for durable dispositions/comments (ADR-0005).
- **Let Q&A mutate review state / counts** — answers are overlay text; the master list stays canonical (ADR-0004).
