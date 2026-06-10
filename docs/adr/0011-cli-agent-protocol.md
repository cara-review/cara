---
status: accepted
amends: [0003, 0004]
amended-by: [0012]
supersedes: 0009
supersedes-in-part: 0007
---

# CLI agent protocol: four verbs, self-narrating, dual-mode, channel-inferred mark tiers

> **Amended by [ADR-0012](0012-field-test-amendments.md) (2026-06-10, Refs #47).** Three
> field-test additions: **line-anchored comments** (a comment anchors to its atom plus an
> optional within-hunk line pointer stored by content+side, display-only); **Reshape** (a
> review-level, non-atom-anchored request routed to the agent via `dispatch`, answered as a
> re-presented grouping; the comment stream stays code-only); **one live server per context**
> (`present` live-refreshes the existing server over WS, never boots a sibling). See the
> amendment at the foot of this ADR.

Background: TN-26-026. Owner-approved in-session 2026-06-09 (Refs #47). This ADR ratifies the pivot's cross-boundary channel and carries the ADR-0003/0004 amendments and the ADR-0009 supersession it depends on.

clear-diff stops carrying its own grouping LLM. It becomes a **completeness-gated, content-addressed review engine driven by an external agent over a CLI protocol** — dual-mode (human-in-loop and autonomous) from day one. The calling agent (Claude Code, Cursor, the session that *made* the change) groups and prioritises; the core stays a pure trusted accounting engine. A CLI is the only universally portable integration: every platform can run a command and read JSON — no hooks, no callbacks, no per-platform code.

## Context

- ADR-0003 modelled the agent as a **driven** port (`AgentPort`) the core *fetches* grouping from. The pivot inverts that: grouping arrives **inbound**, untrusted, supplied by the caller; the agent is a **driving** actor, not a dependency.
- ADR-0009's chat surface assumed an in-process `AgentChat` port. With one LLM outside the boundary wearing every hat, there is no chat surface to host — Q&A becomes a comment answer (see Supersession).
- The portability constraint is structural: clear-diff **never initiates toward the agent**. No callback channel exists. Every verb is agent-invoked; verbs differ in payload direction only.

## Decision

### 1. Four agent-invoked verbs

```
clear-diff atoms [spec]       # core → agent: context, merged methodology, atoms
                              #   (hash, path, ranges, diff lines), open items from
                              #   prior rounds. Trusted: core runs git itself.
clear-diff present [grouping] # agent → core: grouping JSON → bijection repair →
                              #   boots server + browser. Non-blocking. --no-open
                              #   persists the grouping headless (autonomous).
clear-diff dispatch [--wait]  # core → agent: all comments, each open|addressed,
                              #   + full progress. --wait blocks until Done.
clear-diff submit <batch>     # agent → core: dispositions and/or answers, batched.
                              #   Returns the gap report ("38/41 accounted; missing: …").
```

**Core as agent memory.** Every response returns full open state + a gap report; the agent tracks nothing across calls. **Fixes need no verb** — the agent edits code, the atom's hash changes, the core marks the comment addressed mechanically (ADR-0002 identity). Only answers are data (`submit {commentId, answer}`).

### 2. Self-narrating protocol

- Every JSON response carries a `next` hint ("now run: …"). A cold agent that runs any one verb is pulled through the whole loop.
- `clear-diff instructions` emits the canonical loop + verb reference, **generated from the same source** as the `next` hints and version-locked to the `present` schema — no doc drift, nothing shipped to drift.
- Onboarding is the self-narrating protocol + `instructions` + a documented one-liner (paste into CLAUDE.md / AGENTS.md). No shipped skill.

### 3. Dual mode

| | Human-in-loop | Autonomous |
|---|---|---|
| Flow | `atoms` → group → `present` → human reviews → "done" (or `dispatch --wait`) → agent edits + `submit` answers → reopen, converge | `atoms` → review → `submit` marks+comments → gap report → resubmit until clean. No browser. |
| Reviewer seat | human (browser) | calling agent (CLI) |
| Mark tier | `human` | `agent` |
| Synchroniser | the human ("done — pick it up") | none |

Hybrid is free: an agent pre-reviews autonomously; a human later opens the same context and adjudicates only the residue, tiers visible.

### 4. Batch loop, human-synchronized

No yield/resume protocol, no hooks, no heartbeat state machine. The human is the synchronizer; `dispatch --wait` is the optional auto-pickup.

- **Three-state `--wait` return:** `done` (full payload) · `reviewInProgress` (human active — re-run; idempotent, no resume token) · `reviewIdle` (no UI events for ~5 min — **stop polling**, await the user). A blocked process burns zero agent tokens; the idle state makes an abandoned review self-extinguishing. Default block ~240 s (under common harness timeouts); both knobs are flags.

### 5. Channel-inferred mark author tier — no override

Marks carry an author tier — `human` | `agent` — **inferred from channel**: a browser session ⇒ `human`, a CLI invocation ⇒ `agent`. **There is no override flag.** An agent cannot stamp a mark `human` even if prompted to. This is the provenance analogue of ADR-0004's bijection: impersonation is **structurally impossible, not policed**.

### 6. Optional reviewer label on agent-tier events

An agent-tier event may carry an optional `reviewer` label (e.g. `"security"`, `"architecture"`) so multiple headless reviewer agents are distinguishable. `dispatch` and progress can filter per label. The label is descriptive metadata *within* the `agent` tier — it never crosses into `human`, never affects counts or the bijection, and is absent on human marks.

### 7. Config — `~/.clear-diff/config.toml`, no silent fallbacks

`[grouping] mode = "llm" | "git-order"`, `[llm]` provider/model/`api_key_env` (env-var **name**, never the key), `[editor] command`. Behavior is configured, never inferred. Missing config or missing key ⇒ loud error (never an auto-drop to floor). Plumbing verbs never read `[grouping]`/`[llm]`. This becomes the `ConfigPort` source (see ADR-0003 amendment).

## What crosses the boundary

- **`atoms` (core → agent):** context, merged methodology, atoms (hash, path, ranges, **diff lines**), prior open items. The core runs git itself — trusted.
- **`present` (agent → core):** grouping JSON — ids + titles + summaries only — repaired to a bijection over the master list before anything renders.
- **`dispatch` (core → agent):** comments with `open|addressed`, full progress, optional `reviewer` filter.
- **`submit` (agent → core):** dispositions + answers, batched → gap report.

No LLM/transport concept enters domain types or names. The core cannot tell which agent, model, or harness it is talking to — if it could, the boundary has leaked (CLAUDE.md › no adapter-concept leakage).

## Security posture

- The master list stays canonical and agent-untouched: the core runs git, computes atoms, enforces the bijection on every inbound grouping (ADR-0004, as amended). Unplaced atoms → "Other changes"; dangling ids dropped.
- Channel-inferred tier with no override is structural provenance — see §5.
- Summaries and answers remain untrusted overlay: sanitized markdown subset, escape on render, never drive an action (ADR-0010, carried forward to inline answers).

## Consequences

- One LLM in the system, outside the boundary, wearing every hat (grouper, answerer, fixer). The core is fully LLM-free — the trusted-accounting property every downstream vision rests on (TN-26-025).
- `AgentPort` and `AgentChat` leave the driven-port table; the agent becomes a driving adapter (ADR-0003 amendment).
- One bin. The LLM porcelain (`clear-diff review`) is an isolated module; API keys resolve lazily at the first LLM call only. Plumbing verbs have zero key awareness.
- **`dispatch` is the sole egress** (supersedes ADR-0007 in part). The `CommentSink`
  driven port and `ReviewDispatch`/`CommentRecord`/`DispatchReceipt` leave the core;
  comments flow back to the caller as structured data, not out through a sink. The UI `Go`
  control becomes `markComplete` (no push); standalone comment-file export moves to the LLM
  porcelain, composed from `dispatch` output. Comment authoring, the composer, and atom-hash
  anchoring (ADR-0007) survive unchanged.
- Autonomous deliverable = the persisted event log (ADR-0005) + verb returns. Prose reports are the caller's job. Gate semantics deferred to a follow-up TN.

## Rejected

- **MCP / hook / callback integration first** — none is universally portable; a CLI is. MCP deferred as a possible later adapter; the browser stays the human surface (ADR-0001 untouched).
- **Keep the built-in grouping LLM as a driven port** — a cold built-in re-derives intent the caller already has, and puts the LLM inside the trust boundary (the thing the pivot removes).
- **Mark-tier override flag** — any override hands an agent a channel to impersonate a human; channel inference is the only structural guarantee.
- **Yield/resume protocol with heartbeats** — a state machine where a human "done" and a blocking `--wait` suffice; the idle state self-extinguishes abandoned reviews without one.
- **A shipped skill / manual** — the binary self-describes via `instructions` + `next`; a shipped manual would only drift.

## Amendment (2026-06-10): line-anchored comments, Reshape, single-server lifecycle

Background: TN-26-026, Refs #47. Owner-approved in-session 2026-06-10 (field-testing). Ratified by [ADR-0012](0012-field-test-amendments.md). Three additions to the protocol:

- **Line-anchored comments.** A comment anchors to its atom (by hash — unchanged) plus an **optional within-hunk line pointer**, stored by **line content + side** (never a line number — the ADR-0002 identity rule). It is **display metadata only**: never a mechanical unit, never affecting the bijection or counts. **Marks stay block-level.** Fallback when the pinned line is absent from the payload: render at the end of the hunk (effectively never fires in-session).
- **Reshape.** A **review-level, non-atom-anchored** request channel: the human describes a desired view in natural language; the engine routes it to the agent via `dispatch`; the agent **re-presents** a new grouping (marks ride along free, ADR-0002). Covers regrouping, filtering (a focused chapter + a trailing "Rest of the change" swept by the bijection), and question-answered-as-a-view (the summary carries the verdict). The **comment stream stays code-only** — Reshape is a separate channel, not a comment.
- **One live server per context.** `present` routes a new grouping into the **existing live server** (live-refresh over WS, marks intact) instead of booting a sibling. Stale servers are replaced, never left to coexist.
