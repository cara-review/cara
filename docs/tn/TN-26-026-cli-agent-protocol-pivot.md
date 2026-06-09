---
number: 26-026
title: CLI agent protocol pivot — external agent supplies grouping, dual-mode, LLM-free core
kind: proposal
status: active
issue: "#47"
tags: [pivot, cli, agent-protocol, dual-mode, architecture, security, adr-fallout]
---

# TN-26-026: CLI agent protocol pivot

The product pivot: clear-diff stops carrying its own grouping LLM and becomes a **completeness-gated, content-addressed review engine driven by an external agent over a CLI protocol** — dual-mode (human-in-loop and autonomous) from day one. Designed in a full grilling session against ADR-0002/0003/0004/0005/0009 and TN-26-025; positioning in `.agent-state/visions/SYNTHESIS.md`.

> **Human gate.** This TN proposes amendments to accepted ADRs and a new cross-boundary channel. Nothing here is buildable until the ADR fallout (below) is human-approved.

## Why

- The calling agent (Claude Code, Cursor, the session that *made* the change) has richer context for grouping/prioritising than a cold built-in LLM re-deriving intent.
- Removing the LLM makes the core a pure trusted accounting engine — the property every vision (gate, RCR, lens fan-out) rests on, and the one no competitor has (TN-26-025: they all put the LLM inside the trust boundary).
- A CLI is the only universally portable agent integration: every platform can run a command and read JSON. No hooks, no callbacks, no per-platform code.

## Decision ledger

| # | Decision |
|---|---|
| 1 | **CLI-first.** MCP deferred as a possible later adapter. Browser stays the human surface — ADR-0001 untouched. |
| 2 | **Built-in agent dropped as a driven port.** It reforms as an outer LLM-wrapper porcelain (`clear-diff review`) that drives the same plumbing verbs. `AgentPort` inverts: grouping arrives *inbound* (untrusted, via `repairGrouping`), never fetched. |
| 3 | **Core fully LLM-free.** `AgentChat` removed; chat/model concerns exit to the porcelain. One LLM in the system, outside the boundary, wearing every hat (grouper, answerer, fixer). |
| 4 | **Batch loop, human-synchronized.** No yield/resume protocol, no hooks, no heartbeat state machine. The human is the synchronizer; `dispatch --wait` is the optional auto-pickup. |
| 5 | **Marks carry an author tier** — `human` \| `agent`. Tier is inferred from channel: browser session ⇒ human, CLI ⇒ agent. **No override flag** — an agent cannot impersonate a human even if prompted to (structural, not policy; extends ADR-0004's philosophy to provenance). |
| 6 | **Four agent-invoked verbs** (below). Core-as-agent-memory: every response returns full open state + a gap report; the agent never tracks anything across calls. |
| 7 | **One bin.** LLM porcelain isolated as a module; API keys resolved lazily at the first LLM call only. Plumbing verbs have zero key awareness. |
| 8 | **`~/.clear-diff/config.toml`. No silent fallbacks.** Behavior configured, never inferred. Keys referenced by env-var name only. |
| 9 | **Chat pane dropped. The comment is the only interface.** Freeform in, structured out. |
| 10 | **clear-diff owns the methodology.** `atoms` emits system methodology + project `CLEAR_DIFF.md` + personal `~/.clear-diff/CLEAR_DIFF.md`, merged, version-locked to the `present` schema. |
| 11 | **Markdown Chapter/Section summaries**, content shaped by the layered instructions, sanitized-subset rendered (TN-26-023 renderer transfers). No per-block summaries. |
| 12 | **Autonomous deliverable = the persisted event log + verb returns.** Prose reports are the caller's job. Gate semantics deferred to a follow-up TN. |
| 13 | **Onboarding = self-narrating protocol + `clear-diff instructions` + a documented one-liner.** No shipped skill. |

## The verb contract

All four are **agent-invoked**; clear-diff never initiates toward the agent (no callback channel — that's what makes it portable). Verbs differ in payload direction only.

```
clear-diff atoms [spec]       # core → agent: context, merged methodology, atoms
                              #   (hash, path, ranges, diff lines), open items from
                              #   prior rounds. Trusted: core runs git itself.
clear-diff present [grouping] # agent → core: grouping JSON → bijection repair →
                              #   boots server + browser. Non-blocking. --no-open
                              #   persists the grouping without a browser (autonomous).
clear-diff dispatch [--wait]  # core → agent: all comments, each open|addressed,
                              #   + full progress. --wait blocks until Done.
clear-diff submit <batch>     # agent → core: dispositions and/or answers, batched.
                              #   Returns the gap report ("38/41 accounted; missing: …").
```

- **`dispatch --wait` three-state return:** `done` (full payload) · `reviewInProgress` (human active — re-run; idempotent, no resume token) · `reviewIdle` (no UI events for ~5 min — **stop polling**, await the user). Blocked process burns zero agent tokens; the idle state makes an abandoned review self-extinguishing. Default block ~240 s (under common harness timeouts), both knobs flags.
- **Fixes need no verb.** The agent edits code; the atom's hash changes; the core marks the comment addressed mechanically. Only answers are data (`submit {commentId, answer}`).
- **Self-narrating protocol:** every JSON response carries a `next` hint ("now run: …"). A cold agent that runs any one verb is pulled through the whole loop. `clear-diff instructions` emits the canonical loop + verb reference, generated from the same source — version-locked, no doc drift.

## Dual mode

| | Human-in-loop | Autonomous |
|---|---|---|
| Flow | `atoms` → agent groups → `present` → human reviews → "done" (or `dispatch --wait`) → agent edits + `submit` answers → reopen, converge | `atoms` → agent reviews → `submit` marks+comments → gap report → resubmit until clean. No browser. |
| Reviewer seat | human (browser) | calling agent (CLI) |
| Mark tier | `human` | `agent` |
| Synchroniser | the human ("done — pick it up") | none needed |

Hybrid is free: agent pre-reviews autonomously; a human later opens the same context and sees the pre-marked tree (tiers visible), adjudicating only the residue.

## Comment model

- **Freeform in, structured out.** No intent buttons, no categories (like a GitHub review). The agent infers from text whether to edit code, answer, or both.
- `open | addressed` computed by the core: atom payload changed **or** answer attached. The reviewer adjudicates on reopen; re-raise by commenting again.
- Answers render inline at the atom (sanitized markdown subset, untrusted overlay). No chat surface exists.

## Config — `~/.clear-diff/config.toml`

```toml
[grouping]
mode = "llm"            # "llm" (bundled wrapper) | "git-order"

[llm]
provider = "anthropic"
model = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"   # env var NAME — never the key

[editor]
command = "code"
```

| State | Bare `clear-diff` |
|---|---|
| No config | Loud error; message contains a paste-ready minimal config |
| `llm`, key resolves | Full semantic review |
| `llm`, key missing | Loud error at the LLM call — never auto-drops to floor |
| `git-order` | Floor, by choice — no nag |
| Plumbing verbs | Never read `[grouping]`/`[llm]` |

Subsumes `AppConfig.groupingModel`; becomes the `ConfigPort` source. Instruction files renamed `clear-diff.md` → `CLEAR_DIFF.md` (project root) and `~/.clear-diff/CLEAR_DIFF.md` (personal) in the implementing change.

## Agent onboarding — three tiers

1. **Inline (zero setup):** user says "review this with clear-diff"; agent runs `clear-diff instructions`; the self-narrating protocol does the rest.
2. **One-liner (recommended):** paste into CLAUDE.md / AGENTS.md / a rule: *"To review changes with the user, run `clear-diff instructions` and follow it."*
3. **Skill (optional, user-authored):** same one-liner with triggers. Nothing shipped — the binary self-describes; a shipped manual would only drift.

## Security posture

- The master list stays canonical and agent-untouched: the core runs git, computes atoms, enforces the bijection (`repairGrouping`) on every inbound grouping. Unplaced atoms → "Other changes"; dangling ids dropped. Unchanged from ADR-0004.
- **Diff-blind clause narrowed:** the external caller has the repo and can read any diff itself, so grouping-path diff-blindness is unenforceable theatre. `atoms` therefore includes diff lines (one-shot convenience; the caller shouldn't replicate `-U0 --histogram`). The surviving invariant (the only ever structural one): grouping output is ids + titles + summaries; rendered evidence always comes from git verbatim; the agent cannot add, remove, hide, or edit an atom.
- Channel-inferred tier with no override is the provenance analogue of the bijection: impersonation is structurally impossible, not policed.
- Summaries and answers remain untrusted overlay: sanitized markdown subset, escape on render, never drive an action.
- **Accepted (owner ruling, 2026-06-10):** project `CLEAR_DIFF.md` flows into the porcelain's LLM system prompt via the merged methodology. In the local-first model this is operator-vouched content (the operator chose to review this checkout — same trust class as the repo content any calling agent reads). Blast radius is bounded by the structural backstops: bijection (can't hide an atom), channel-inferred tier (can't forge human), no tool/key access from prompts. **ADR trigger:** the moment clear-diff reviews untrusted sources (`--pr`, CI over external contributions), trusted/untrusted methodology segmentation becomes ADR-gated work — do not ship those features without it.

## ADR fallout (each human-gated)

- **New ADR** — the CLI agent protocol: four verbs, self-narration, dual mode, channel-inferred mark tiers, batch loop, three-state `--wait`.
- **Amend ADR-0003** — port table: `AgentPort` + `AgentChat` removed as driven ports; agent becomes a driving actor; LLM-wrapper porcelain as a driving adapter; `ConfigPort` → toml.
- **Amend ADR-0004** — diff-blind clause narrowed (see Security posture); mark author tiers; grouping inbound-not-fetched.
- **Supersede ADR-0009** — no `AgentChat`, no chat surface; Q&A routes to the caller as comment answers.

## Out of scope (own TNs later)

`clear-diff gate` / risk tiers · RCR artifact + verifier · standing/cross-context store · fleet mode · MCP adapter · lens fan-out. The pivot must not preclude them; the event-log + tier substrate is exactly what they build on.

**Accepted (owner ruling, 2026-06-10):** `progress.byReviewer` is last-writer attribution — the fold keeps one mark per atom, so overlapping lenses credit the later label. The event log retains every lens's mark, so per-lens progress is derivable later without schema change; proper multi-lens accounting ships with the lens-fanout/gate TN.

## Implementation sketch (post-approval)

1. Core: mark-event author tier; comment `open|addressed` derivation; grouping-inbound use-case split (`atoms`-equivalent / `present`-equivalent on `ReviewService`); remove `AgentPort`/`AgentChat` from `ReviewServiceDeps`.
2. CLI: the four verbs + `instructions`; `next` hints; three-state `--wait` (server tracks UI activity over WS).
3. Porcelain: `clear-diff review` wrapper (grouping call, answer calls); config.toml; lazy keys.
4. Web: remove chat pane; composer stays freeform; inline answer rendering; tier badges on marks.
5. Docs: concept.md, CONTEXT.md (already updated), README agent-setup section; rename instruction files.
