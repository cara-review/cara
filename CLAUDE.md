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

**clear-diff** — a local-first, diff-first conversational code reviewer. The agent reads a whole diff, reorganises it into a navigable structure, and surfaces the right part at the right time. You direct; it writes the comments (voice-first). Node CLI.

- `index.js` — bin entry (`clear-diff`). Currently a stub.
- Invocation: `clear-diff` (worktree vs `origin/main`), `clear-diff <base>..<head>`, `clear-diff --pr N` (later).

See [`docs/concept.md`](docs/concept.md) for the full product model. Treat it as the source of intent. Architecture: [`docs/adr/`](docs/adr/) — hexagonal core (0003), agent/master-list security invariant (0004), atom identity (0002), marks persistence (0005).

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

# Documentation

- [`docs/`](docs/) — project docs. [`docs/concept.md`](docs/concept.md) is the product spec.
- Code change affects docs → update in the same change.
- After writing or editing any doc, run `/streamline-doc` on it before committing.
- **Repo state:** `agent/skills/` + `agent/agents/` = canonical skills and reviewer agents (checked in), surfaced to Claude Code via `.claude/skills` and `.claude/agents` symlinks; `.claude/settings.json` = policy. `.agent-state/` = runtime per-clone state, e.g. the approval marker (gitignored). Never invert.

# Workflow: trunk-based

Agents push directly to `main`. No feature branches for review, no PRs to merge.

- `/do-work` — single entry point for any change (kick-off → plan → develop → review → ship → close).
- `/do-review` (or `/clear-diff`) — local review before shipping.
- `/do-ship` — deliver to `main`.
- `/start-team` — parallel agents picking up Ready issues.
- Pre-push hook is the quality gate. **Never `--no-verify`.**
- Issues: `clear-diff/clear-diff` GitHub Project. Reference with `Refs #N` (or `Closes #N` to auto-close).

## Ship policy

Read by `do-ship`. Authoritative.

- **Approver:** human only. Coordinators / team leads route the human's go-ahead, never substitute. Silence ≠ approval.
- **Commit timing:** commit *after* approval. Flow: `do-review` → human reviews uncommitted diff → approval → commit → push.
- **Approval signals:** `approve`, `push`, `ship`, `lgtm`, `go`, `👍`, optionally with `#N`. Ambiguous → ask. Changes requested → apply, re-run `do-review`, return to Stage 1.
- **Scope:** every change, even trivial. No skip path.
- **Approval marker:** after approval + commit, write `.agent-state/last-approval.json` `{"head_sha":"<HEAD>","approved_at":"<ISO 8601>","approver":"human"}`. PreToolUse hook `scripts/claude-check-approval.sh` blocks `git push` if missing or SHA-stale.

## Worktrees

`git worktree add <path> -b <branch> main` (new branch always). Path: `../clear-diff-worktrees/<issue>-<slug>`. Never check out `main` (or any primary branch) inside a worktree — locks the primary worktree out.

## Issue sizing

Prefer one larger issue over several small. Sub-features belong in the parent's body/checklist. Split only when work is about to start and parallelism pays off.

# Build

Node CLI. After cloning: `./scripts/install-git-hooks.sh` to install the pre-push gate.

Two enforcement layers: Claude Code hooks via `.claude/settings.json` (active on clone — approval gate) + git `pre-push` via `./scripts/install-git-hooks.sh` (manual install — runs `npm test` once tests exist).
