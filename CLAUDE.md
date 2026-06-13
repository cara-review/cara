# Behaviour

**Be extremely concise. Sacrifice grammar for concision.**

## Think before coding
- State assumptions. Ask if uncertain.
- Multiple interpretations → present, don't pick silently.
- Simpler approach → say so. Push back when warranted.
- Unclear → stop, name it, ask.

## Simplicity first
- No features, abstractions, or flexibility beyond what was asked.
- No error handling for impossible scenarios.
- 200 lines that could be 50 → rewrite.
- Senior-engineer test: "would they call this overcomplicated?" If yes, simplify.

## Surgical changes
- Touch only what the task requires. Don't improve adjacent code. Don't refactor what isn't broken. Match existing style.
- Unrelated dead code: mention, don't delete.
- Orphaned imports/vars from your changes → remove. Pre-existing dead code → leave.

## No backwards compatibility
- Pre-release. No external consumers, no shipped releases, no deprecation contracts.
- When renaming or restructuring: change every callsite. No deprecated aliases, no re-exports of old names, no "TODO: remove after migration" comments.
- The codebase should always reflect its current, intended state — never carry transitional layers.

## Naming
- Names reflect what the thing IS. `atomHash` > `h`, `sections` > `arr`.
- Short names (`s`, `v`, `i`) only when scope ≤ 3 lines.

## Code style
- Focus on the current, intended state of the code. Change history lives in git — don't reflect it in comments, names, or architecture.

## TypeScript
- `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables`.
- No `any`, implicit or explicit (lint-enforced). `unknown` + narrow at boundaries.
- Inference-first. Annotate only at seams (exported signatures, port interfaces); implementations infer. Generics where they earn reuse.

# Project

**cara** — a local-first, completeness-gated code-review **engine**, driven by an external agent over a CLI protocol. The engine runs git, owns the atoms/identity/marks, and is **LLM-free**; the calling agent (Claude Code, Cursor, the session that made the change) supplies the grouping and drives the verbs. Dual-mode: human-in-loop (browser) and autonomous (CLI). Bun CLI.

- `index.js` — dev entry (`bun index.js`). The published `cara` bin is the bundled `dist/index.js` (built by `scripts/pack-dist.ts`); both run the same `cli.ts`.
- **Verbs (agent-invoked plumbing, no LLM/key):** `atoms` (engine→agent: context + atoms), `present` (agent→engine: grouping → browser), `dispatch [--wait]` (engine→agent: comments + progress), `submit` (agent→engine: dispositions/answers → gap report), `instructions` (self-narrating protocol).
- **Porcelain:** `cara review` — the bundled LLM wrapper that groups, then drives the verbs. `--headless` (autonomous), `--reviewer <label>` (one labelled lens), `--fake` (stub, no key). The only place an API key is touched.

See [`docs/concept.md`](docs/concept.md) for the full product model. Treat it as the source of intent. The pivot is [TN-26-026](docs/tn/TN-26-026-cli-agent-protocol-pivot.md) → [ADR-0011](docs/adr/0011-cli-agent-protocol.md). Architecture: [`docs/adr/`](docs/adr/) — hexagonal core (0003), agent/master-list security invariant (0004), atom identity (0002), marks persistence (0005), CLI agent protocol (0011).

## Core model — two layers, never mixed

A review is a tree: **Review → Chapters → Sections → atoms.**

- **Mechanical layer (git — stable, deterministic):** atoms are git hunks (`git diff -U0 --histogram -M`). git owns mechanical truth and identity. No arbitrary line-drawing by the agent.
- **Semantic layer (agent — fluid, disposable):** Chapters and Sections are groupings *over* atoms, regrouped freely on every run.
- The two layers never contaminate each other.

**Marks live on atoms**, keyed by a content hash of the atom's payload (added/removed lines, normalised, context excluded) — never on line numbers, never on the agent's grouping. Unrelated edits don't disturb marks; edits to reviewed lines resurface automatically; regrouping is free.

## Vocabulary

Use these terms exactly in code, docs, commits, and conversation:

- **Chapter** — a major tranche of intent, ordered by importance.
- **Section** — a curated group of related change within a chapter, ordered by relevance (theme, not git position).
- **atom** — one git hunk; the indivisible mechanical unit. Internal plumbing — never surface the word "atom" to users; user vocabulary is Chapters and Sections.
- **author tier** — every mark is `human` or `agent`, inferred from channel (browser ⇒ human, CLI ⇒ agent). **No override** — impersonation is structurally impossible. Agent-tier marks may carry an optional `reviewer` label (e.g. `security`, `architecture`).
- **comment** — the only interface (no chat pane). Freeform in, structured out; `open` until the atom payload changes or an answer is attached. `dispatch` is the engine's sole egress.

# Documentation

- [`docs/`](docs/) — project docs. [`docs/concept.md`](docs/concept.md) is the product spec.
- **Doc system (see [TN-26-001](docs/tn/TN-26-001-technical-notes-and-doc-structure.md)):**
  - `docs/tn/` — **Technical Notes**: numbered timeline of proposals, specs, **plans**, explorations, research. The working surface. Format `TN-YY-NNN`.
  - `docs/adr/` — ratified **architectural** decisions. `docs/cdr/` — ratified **convention** decisions. Both `NNNN` zero-padded.
  - **All plans go via the TN system** (`kind: plan`) — never a loose plan file.
  - A TN is born from an issue; the TN reservation is the first commit on the ticket. Index every TN in `docs/tn/README.md`.
- Code change affects docs → update in the same change.
- After writing or editing any doc, run `/streamline-doc` on it before committing.
- **Repo state:** `agent/skills/` + `agent/agents/` = canonical skills and reviewer agents (checked in), surfaced to Claude Code via `.claude/skills` and `.claude/agents` symlinks; `.claude/settings.json` = policy. `.agent-state/` = runtime per-clone state, e.g. the approval marker (gitignored). Never invert.

# Workflow: trunk-based

Agents push directly to `main`. No feature branches for review, no PRs to merge.

- `/do-work` — single entry point for any change (kick-off → plan → develop → review → ship → close).
- `/do-review` (or `/cara`) — local review before shipping.
- `/do-ship` — deliver to `main`.
- `/start-team` — parallel agents picking up Ready issues.
- Pre-push hook is the quality gate. **Never `--no-verify`.**
- Issues: `cara-review/cara` GitHub Project. Reference with `Refs #N` (or `Closes #N` to auto-close).

## Architecture policy

The architecture is load-bearing and already ratified: hexagonal boundaries ([ADR-0003](docs/adr/0003-hexagonal-architecture.md)), atom identity ([ADR-0002](docs/adr/0002-core-review-architecture.md)), the agent-untrusted master-list invariant ([ADR-0004](docs/adr/0004-agent-untrusted-master-list.md)). Default to strict.

- **Strict architectural review on every change.** Boundaries, layer direction, port discipline, the two-layers-never-mixed rule, naming. When in doubt, escalate — run the `architect` reviewer.
- **No adapter-concept leakage into the domain.** The core stays adapter-neutral: a concept true for *one* adapter but not all of them must never appear in domain types, names, or logic — it lives behind the port. (git hunks/SHAs/diff headers, filesystem paths, HTTP/WS framing, a specific LLM's response shape, GitHub PR fields, …) Ports translate adapter reality into domain-neutral terms; if the domain can tell which adapter it's talking to, the boundary has leaked. Hard violation — the architect treats it like a layer breach.
- **Deviations require a human-approved ADR.** No agent may deviate from an accepted ADR, cross a layer boundary, add a port/package/cross-boundary channel, relax TS strictness, or introduce a new architectural pattern without **first** writing an ADR (born from a TN, `kind: proposal`) and getting **explicit human approval**. Silence ≠ approval.
- Until that approval lands, the agent **stops** — it does not code around the boundary or ship a workaround. Surface the question, wait.
- The human (project owner) is the sole approver of architectural deviations, new ADRs/CDRs, and process questions. **These are the *only* human gates** — normal code delivery is autonomous (see Ship policy).

## Ship policy

Read by `do-push`. Authoritative.

- **Autonomous delivery.** Agents commit and push directly to `main` after a scaled local review — **no human approval gate for normal changes**. Trunk-based, concurrent, no branch sequencing.
- **Human gate only for:** a new ADR/CDR, an architectural deviation, or a process question (see `## Architecture policy`). Hard stop — route to the human and wait; silence ≠ approval. Everything else ships without asking.
- **Local review is mandatory even when autonomous** — scaled to risk: trivial → self-review; standard → one reviewer; security/architecture → full arch + security review. Apply findings before push.
- Pre-push hook is the quality gate. **Never `--no-verify`.**
- After push, update the issue (delivered summary + review note) and set status Done.

## Worktrees

`git worktree add <path> -b <branch> main` (new branch always). Path: `../cara-worktrees/<issue>-<slug>`. Never check out `main` (or any primary branch) inside a worktree — locks the primary worktree out.

## Issue sizing

Prefer one larger issue over several small. Sub-features belong in the parent's body/checklist. Split only when work is about to start and parallelism pays off.

# Build

Bun CLI (CDR-0001). After cloning: `bun install`, then `./scripts/install-git-hooks.sh` to install the pre-push gate.

Quality gate: the git `pre-push` hook (`./scripts/install-git-hooks.sh`, manual install — runs lint + `bun run test` + `bun run test:e2e`). No per-push approval gate; delivery is autonomous (see Ship policy). The only human gates are ADR / architectural / process questions.
