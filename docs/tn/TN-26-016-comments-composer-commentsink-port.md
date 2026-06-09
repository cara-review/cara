---
number: 26-016
title: Comments, composer, CommentSink port, and Go dispatch
kind: proposal
status: superseded
superseded-by: 26-026
issue: "#14"
tags: [comments, composer, ports, dispatch, hexagonal]
---

# TN-26-016: Comments, composer, CommentSink port, and Go dispatch

> **Superseded by [TN-26-026](TN-26-026-cli-agent-protocol-pivot.md) / [ADR-0011](../adr/0011-cli-agent-protocol.md).** The `CommentSink` port, `ReviewDispatch`/`CommentRecord`/`DispatchReceipt`, and the MarkdownCommentSink leave the core (ADR-0007 superseded-in-part). The **`dispatch` verb is the sole egress**; the UI **Go** control becomes **markComplete**; file/PR export moves to the porcelain, composed from `dispatch` output. The comment model, composer, and atom-hash anchoring survive.

Line commenting end-to-end plus the dispatch target. Proposes a 9th driven port (`CommentSink`) and the composer UI. Background for **ADR-0007** (status: accepted) — approved by owner 2026-06-06 (delegated to coordinator).

## Context

- Comments already exist as a domain concept: `ReviewService.comment(ctx, atom, body)` and the `commented` event (ADR-0005), persisted by `ReviewStore` keyed by atom hash (ADR-0002/0004).
- What's missing: (a) the **composer** to author a comment in the user's voice, (b) **inline anchoring** of comments to the diff surface, (c) **dispatch** — pushing the accumulated comments *out* to a downstream actor (`Go`).
- `ReviewStore` is **persistence**, not export. Dispatch is a distinct egress concern → a new port, not an overload of `ReviewStore`.

## Proposal

### 1. `CommentSink` driven port (9th port)

- Core emits a **dispatch intent** over the commented atoms; an adapter persists/forwards it.
- Shape: `dispatch(ctx, dispatch: ReviewDispatch): Promise<DispatchReceipt>`.
- `ReviewDispatch = { comments: CommentRecord[] }`; `CommentRecord = { atomHash, path, lineRange, body }` — domain-neutral, built from the master list + comment events.
- First adapter: **markdown-file**. Writes one markdown file carrying enough metadata (atom hash, path, line range, body) that a downstream agent can pick it up and action each comment. PR posting is out of scope (a later `GitHubPR` adapter over the same port).
- `Go` is a `ReviewService` use-case (`dispatch(ctx)`) the user triggers; it gathers comments and calls `CommentSink`.

### 2. Composer UI (web driving adapter)

- Focusable composer; OS dictation types into it.
- The agent **drafts the comment in the user's voice** from spoken intent → user reviews → accepts. Drafted text is **untrusted, always user-editable**, never authoritative — same posture as agent summaries (ADR-0004).
- Quiet line markers + inline thread on the diff surface.

### 3. Line-comment anchoring

- Comments anchor to **atoms by hash** (domain identity), never to raw line numbers.
- The web adapter maps atom → current line range → **Monaco view zones** for the inline thread (per ADR-0006). View zones are a Monaco/adapter concern; the domain never names them.

## Boundary — domain vs adapter

| Concern | Side |
|---|---|
| Comment identity (atom hash), comment body, dispatch use-case | **domain** |
| `CommentSink` port interface + `ReviewDispatch`/`CommentRecord` shapes | **domain** |
| Markdown format, output file path, frontmatter, `Go` target | **adapter** (markdown-file `CommentSink`) |
| Composer widget, dictation, inline thread rendering, Monaco view zones | **adapter** (web) |
| Drafting prose in the user's voice (untrusted, user-reviewed) | **adapter** via agent port |

The domain must not know the sink is markdown, must not know a filesystem path, must not name `Go` or Monaco. If the core can tell which sink it's talking to, the boundary has leaked (CLAUDE.md › no adapter-concept leakage).

## Open questions (for ADR-0007)

- **Where does comment drafting live** — a new `draftComment` method on `AgentPort`, or a sibling port? `AgentPort` today is grouping-only (structure, untrusted overlay, ADR-0004); prose drafting is a different capability over the same LLM. Lean: keep grouping clean, add drafting as a distinct seam.
- **Dispatch granularity** — one file per `Go`, or append-per-comment? Markdown-file adapter detail; doesn't touch the port.
- **`DispatchReceipt` contents** — path/id of what was written, for UI confirmation.
