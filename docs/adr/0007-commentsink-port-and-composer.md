---
status: accepted
---

# CommentSink: a driven egress port for dispatching review comments

Background: TN-26-016. Approved by owner 2026-06-06 (delegated to coordinator).

clear-diff already stores comments as events keyed by atom hash (ADR-0005), but has no way to push them *out*. This ADR adds a 9th driven port (`CommentSink`) for dispatch (`Go`), plus the composer that authors comments and the anchoring that ties them to the diff. The diff-touching rules of ADR-0004 carry over unchanged: the agent drafts prose the user reviews; it never defines or edits the change.

## Context

- `ReviewService.comment` + the `commented` event (ADR-0005) cover authoring and persistence.
- Persistence (`ReviewStore`) is not export. `Go` forwards accumulated comments to a downstream actor — a distinct egress concern, so a distinct port rather than an overload of `ReviewStore`.
- The downstream actor (a coding agent) needs each comment tied to a stable atom identity + current location, so it can find and action the change.

## Decision

### `CommentSink` driven port

Add to the ADR-0003 port table:

| Port | Responsibility | Adapter(s) |
|---|---|---|
| `CommentSink` | dispatch accumulated comments out of the review | MarkdownFile (→ GitHubPR later) |

- `dispatch(ctx, dispatch: ReviewDispatch): Promise<DispatchReceipt>`.
- `ReviewDispatch = { comments: CommentRecord[] }`; `CommentRecord = { atomHash, path, lineRange, body }` — domain-neutral, assembled from the master list (ADR-0004) + comment events (ADR-0005).
- `ReviewService.dispatch(ctx)` is the `Go` use-case: gather commented atoms → build `ReviewDispatch` → call the sink.
- First adapter: **MarkdownFile** — writes one markdown file carrying atom hash, path, line range and body per comment, enough for a downstream agent to action each. PR posting stays out of scope; a `GitHubPR` adapter is a later impl of the same port.

### Composer (web driving adapter)

- Focusable composer; OS dictation types into it.
- The agent **drafts the comment in the user's voice** from spoken intent → user reviews → accepts. The draft is untrusted, user-editable, never authoritative — same posture as agent summaries (ADR-0004). Escape on render; never interpret as markup; never let it drive an action.

### Anchoring

- Comments anchor to **atoms by hash**, never to raw line numbers. Edits to reviewed lines resurface the comment via identity (ADR-0002); regrouping leaves it untouched.
- The web adapter maps atom → current line range → **Monaco view zones** for the inline thread (per ADR-0006). View zones are an adapter concern; the domain never names them.

## What crosses the boundary

- **Out (`CommentSink`):** a `ReviewDispatch` of domain-neutral `CommentRecord`s. The core does not know the sink is markdown, does not know an output path, does not name `Go`.
- **In (composer):** a user-accepted comment body → `ReviewService.comment`. Drafting prose is an LLM capability reached over a port (see Open), kept separate from `AgentPort` grouping so the structure-only, untrusted-overlay contract of ADR-0004 stays clean.

No adapter concept (markdown, filesystem path, Monaco view zone, `Go`) appears in domain types, names, or logic. If the core could tell which sink or viewer it's talking to, the boundary has leaked.

## Consequences

- One more port, one markdown-file adapter; dispatch is testable against a fake sink.
- Comments gain an egress path without coupling the core to any output format.
- Marks/comments survive edits and regrouping unchanged — anchoring rides existing atom identity.

## Rejected

- **Dispatch via `ReviewStore`** — conflates persistence with export; the sink would need to know the store's event shape and the markdown format at once.
- **Anchoring comments to line numbers** — breaks on any edit; loses the identity guarantees of ADR-0002.
- **Letting the agent author final comments** — drafts must be user-reviewed; an unedited agent comment is untrusted text presented as the reviewer's own.

## Open

- **Comment drafting seam** — a `draftComment` method on `AgentPort`, or a sibling port? Lean: a distinct seam, to keep grouping (structure-only) uncontaminated by prose drafting.
- **Dispatch granularity & `DispatchReceipt`** — one file per `Go` vs append-per-comment; receipt carries the written path/id for UI confirmation. Adapter detail; doesn't move the port boundary.
