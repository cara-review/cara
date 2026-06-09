# clear-diff

**A local-first, completeness-gated code reviewer that an AI agent drives — not one with an LLM inside it.**

clear-diff is a trusted, deterministic engine: it runs git, splits the change into mechanical units, owns identity and review marks, and enforces that every change is accounted for. Your coding agent (Claude Code, Cursor, the session that *made* the change) reads the diff and supplies the structure, driving the engine over a tiny CLI protocol. The agent arranges and describes; it can never define or change what's in the review.

The result is review that reads like a report — importance at the top, related things together, evidence on demand — and works two ways: a human reviewing in a browser, or an agent reviewing autonomously, over the same engine.

> **Status: pre-release.** The pivoted engine, CLI protocol, and dual-mode web UI are landed and tested. Distribution polish (`npx`) is in progress.

## Why it's different

Every other AI reviewer puts the LLM **inside** the trust boundary — it both reads the diff and decides what you see, so a hidden or mis-summarised change is undetectable. clear-diff puts the LLM **outside**:

- **Trusted engine.** Counts and completion derive from a master list computed straight from git, with zero agent involvement. A grouping can never make a change look smaller than it is.
- **Untrusted agent.** Grouping is ids + titles + summaries only. The engine enforces a bijection — every atom appears exactly once — so the agent **cannot add, remove, hide, or edit** a single line ([ADR-0004](docs/adr/0004-agent-untrusted-master-list.md)).
- **No LLM in the core.** The engine carries no model and no API key. One LLM, outside the boundary, in an optional wrapper.

## Quickstart

```bash
# Standalone, once published:
npx clear-diff review            # in any git repo with uncommitted changes
```

`clear-diff review` calls an LLM to group the diff, then opens the review in a browser. It needs `~/.clear-diff/config.toml` (below) and the configured API key in your environment.

## Agent setup

The point of clear-diff is to be driven by *your* agent. Onboarding is one line — paste into `CLAUDE.md`, `AGENTS.md`, or a rule file:

> To review changes with the user, run `clear-diff instructions` and follow it.

`clear-diff instructions` emits the canonical loop and verb reference. The protocol is **self-narrating** — every response carries a `next` hint — so a cold agent that runs any one verb is pulled through the whole review. Nothing else to install; no shipped skill to drift.

## The protocol

The agent drives the engine with four verbs plus a helper. clear-diff never calls out to the agent — every verb is agent-invoked, which is what makes it portable to any platform that can run a command and read JSON.

```
clear-diff atoms [spec]       # engine → agent: context, merged guidance, atoms
                              #   (hash, path, ranges, diff lines), open items.
clear-diff present [grouping] # agent → engine: grouping JSON → bijection repair →
                              #   boots server + browser. --no-open stays headless.
clear-diff dispatch [--wait]  # engine → agent: all comments (open|addressed) + progress.
clear-diff submit <batch>     # agent → engine: dispositions and/or answers, batched.
                              #   Returns a gap report ("38/41 accounted; missing: …").
clear-diff instructions       # emits the canonical loop + verb reference.
```

- **Engine as agent memory** — every response returns full open state + a gap report; the agent tracks nothing across calls.
- **Fixes need no verb** — the agent edits code, the atom's hash changes, the engine marks the comment addressed mechanically.
- **`dispatch --wait`** blocks (zero agent tokens burned) and returns one of three states: `done`, `reviewInProgress` (human still active — re-run), or `reviewIdle` (no activity ~5 min — stop polling, await the user).

Full contract: [ADR-0011](docs/adr/0011-cli-agent-protocol.md).

## Two modes

| | Human-in-loop | Autonomous |
|---|---|---|
| Flow | `atoms` → agent groups → `present` → human reviews → "done" → agent edits + answers → converge | `atoms` → agent reviews → `submit` marks + comments → gap report → resubmit until clean |
| Reviewer | human (browser) | the calling agent (CLI), no browser |
| Mark tier | `human` | `agent` |

Hybrid is free: an agent pre-reviews autonomously; a human later opens the same context, sees the pre-marked tree with tiers visible, and adjudicates only the residue.

### Headless multi-reviewer

```bash
clear-diff review --headless                      # autonomous, no browser
clear-diff review --headless --reviewer security  # one labelled lens
clear-diff review --headless --reviewer architecture
clear-diff review --fake                           # deterministic stub, no LLM/key
```

Each headless reviewer's marks carry its `--reviewer` label, so several lenses (security, architecture, …) review the same diff and stay distinguishable; `dispatch` and progress can filter per label.

## Config — `~/.clear-diff/config.toml`

```toml
[grouping]
mode = "llm"            # "llm" (bundled wrapper) | "git-order" (floor, no LLM)

[llm]
provider = "anthropic"
model = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"   # env var NAME — never the key itself

[editor]
command = "code"
```

No silent fallbacks — behaviour is configured, never inferred:

| State | Bare `clear-diff review` |
|---|---|
| No config | Loud error with a paste-ready minimal config |
| `llm`, key resolves | Full semantic review |
| `llm`, key missing | Loud error at the LLM call — never auto-drops to floor |
| `git-order` | Floor, by choice — no nag |
| Plumbing verbs | Never read `[grouping]`/`[llm]` |

Review guidance is separate, in plain markdown (like CLAUDE.md): `CLEAR_DIFF.md` at the repo root (project, committed) and `~/.clear-diff/CLEAR_DIFF.md` (personal). Both are merged and fed to the agent on every `atoms` call to steer chaptering and relevance.

## Security model

- **Master list is canonical.** The atom set is computed from git every run, zero agent involvement; counts and completion derive from it, never from the grouping.
- **Grouping is untrusted overlay.** ids + titles + summaries only; repaired to a bijection over the master list before anything renders. The agent cannot add, remove, hide, or edit an atom — structural, not policed.
- **Provenance is structural.** Mark author tier (`human` | `agent`) is inferred from the channel with no override flag; an agent cannot impersonate a human.
- **Diff lines are shared, not the change.** `atoms` includes diff lines (the caller has the repo anyway), but rendered evidence always comes from git verbatim; the agent never has a write channel to a line.
- **Summaries and answers are display-only.** Sanitized markdown subset, escaped on render, never drive an action ([ADR-0010](docs/adr/0010-chat-answer-markdown-rendering.md)). The agent guidance (`CLEAR_DIFF.md`) reaching the LLM prompt is an accepted, documented trust seam ([TN-26-026 §Security posture](docs/tn/TN-26-026-cli-agent-protocol-pivot.md)).

## Architecture & docs

A hexagonal core: a pure domain + application core surrounded by interchangeable adapters, so the CLI, the local web UI, and the LLM porcelain all sit over one unchanged engine. The agent is a *driving* actor over the CLI, not a port the core calls.

- [`docs/concept.md`](docs/concept.md) — the product model and voice. Source of intent.
- [`docs/design-brief.md`](docs/design-brief.md) — the UI and interaction surface.
- [`docs/adr/`](docs/adr/) — ratified architecture decisions; [`docs/tn/`](docs/tn/) — the technical-note timeline. The pivot is [TN-26-026](docs/tn/TN-26-026-cli-agent-protocol-pivot.md) / [ADR-0011](docs/adr/0011-cli-agent-protocol.md).

## Development

Bun toolchain ([CDR-0001](docs/cdr/)). Contributions: see [`CONTRIBUTING.md`](CONTRIBUTING.md).

```bash
bun install
./scripts/install-git-hooks.sh   # pre-push gate: lint + test + e2e
bun run test                     # typecheck + unit
bun index.js atoms               # dev entry (runs the same cli.ts as the bundled bin)
```

## Licence

MIT — see [`LICENSE`](LICENSE).
