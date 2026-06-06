---
name: sync-skills
description: Syncs skills and agents between the dotfiles canonical library and the current repo (agent/skills + agent/agents). Detects workflow mode, targets the right classes, and uses LLM semantic comparison to detect improvements vs customisations.
disable-model-invocation: false
---

# sync-skills

Keeps skills **and agents** in sync between the **dotfiles canonical library** and the **current repo**.

Repos are self-sufficient: each commits its own skills (`agent/skills/`) and agents (`agent/agents/`) as part of its guardrails, so a fresh clone has everything. **Nothing is installed globally in `~/.claude`** — global skills shadow and confuse a repo's own. The dotfiles library is the maintained source of truth; this skill moves changes between it and a repo in either direction.

The library lives in dotfiles:

- `claude/skills-lib/shared/` — skills for all repos
- `claude/skills-lib/trunk-based/` — skills for trunk-based repos only
- `claude/skills-lib/pr-based/` — skills for PR-workflow repos only
- `claude/skills-lib/personal/` — personal utilities, **dotfiles-only** (never synced into a shared repo)
- `claude/agents-lib/` — reviewer agents (flat `<name>.md`), for all repos

## Triggers

`/sync-skills`, "sync skills", "sync agents", "sync my skills", "update skills"

---

## Direction

If the user says "sync" without a direction, infer from context:

- Just edited the dotfiles library → **library → repo**
- Just improved a skill/agent in the repo → **repo → library**
- Unclear → ask: "Which direction? library → repo, repo → library, or both?"

Explicit flags:

- `/sync-skills` — infer or ask
- `/sync-skills --to-repo` — library → repo
- `/sync-skills --to-dotfiles` — repo → library
- `/sync-skills --both` — library → repo first, then back-propagate

---

## Stage 1 — Detect workflow mode

Read the current repo's `CLAUDE.md` (check `.claude/CLAUDE.md` first, then root `CLAUDE.md`).

Does it declare a workflow? Look for "trunk-based development", "push directly to main", "PR-based", "feature branches". Classify as `trunk-based`, `pr-based`, or `unknown`.

If `unknown`, ask: "I couldn't detect the workflow mode from your CLAUDE.md. Is this repo trunk-based or PR-based? Add a line like `## Workflow: trunk-based`."

**Target skill classes** = `shared` + `<workflow-class>`. (`personal` is excluded — dotfiles-only.) **Agents** (`agents-lib`) always sync to all repos.

---

## Stage 2 — Resolve paths

```
DOTFILES="$HOME/dev/dotfiles"
SKILLS_LIB="$DOTFILES/claude/skills-lib"
AGENTS_LIB="$DOTFILES/claude/agents-lib"
REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_SKILLS="$REPO_ROOT/agent/skills"   # the real dir behind .claude/skills
REPO_AGENTS="$REPO_ROOT/agent/agents"   # the real dir behind .claude/agents
```

If the repo surfaces skills/agents through `.claude/skills` and `.claude/agents` symlinks, write to the symlink **targets** (typically `agent/skills` and `agent/agents`), not the symlinks. Skills are directories (`<name>/SKILL.md`); agents are single files (`<name>.md`).

---

## Stage 3 — Direction: library → repo

**Skills** (target classes only):

- Not present in `REPO_SKILLS` → copy the entire skill directory in.
- Present → compare semantically (Stage 5). Overwrite only if the library version is strictly better. Identical or repo-customised → skip.

**Agents** (`AGENTS_LIB` → `REPO_AGENTS`):

- Not present → copy `<name>.md` in.
- Present → compare semantically (Stage 5); overwrite only if the library is better.

**Mismatches** — a repo skill/agent that is not in the library, or belongs to the wrong workflow class → **flag for the user, do not delete.** Repos legitimately carry their own local skills (e.g. a project-specific `pm` or `shadcn`); deleting them would destroy repo-owned work.

Report: Installed / Updated / Skipped (identical) / Flagged (repo-local).

---

## Stage 4 — Direction: repo → library

For each repo skill (in a target class) and each repo agent, find its counterpart in the library.

- **No counterpart** → repo-local. Ask: "`<name>` exists in the repo but not the library. Add it? If a skill, which class — shared, trunk-based, pr-based, or personal? If an agent, it goes in `agents-lib`." Skip project-specific skills the user wants to keep repo-only.
- **Counterpart exists** → compare semantically (Stage 5).

Write approved changes to `skills-lib/` / `agents-lib/`. Then remind: "Changes written to the dotfiles library. Review with `git diff` in `~/dev/dotfiles` and commit when happy."

Never auto-commit or auto-push dotfiles.

---

## Stage 5 — LLM semantic comparison

For any skill/agent present in both places:

1. **Byte-identical check** — if files match exactly, skip.

2. **Read both full versions** and classify:

```
You are comparing two versions of a Claude Code <skill|agent> named '<name>'.

LIBRARY VERSION (canonical):
<full content>

REPO VERSION:
<full content>

Classify as exactly one of:
- IDENTICAL: semantically the same, cosmetic/whitespace differences only
- LIBRARY_NEWER: library version is strictly better — more complete, clearer, or fixes a bug
- REPO_IMPROVED: repo version has genuine improvements that should go back to the library
- REPO_CUSTOMISED: repo version has project-specific changes that should not be back-propagated
- DIVERGED: both sides have meaningful changes — requires human judgement

Respond with the classification on the first line, then a one-sentence reason.
```

3. Act on classification:

| Classification   | library → repo      | repo → library                |
| ---------------- | ------------------- | ----------------------------- |
| IDENTICAL        | skip                | skip                          |
| LIBRARY_NEWER    | overwrite repo      | skip                          |
| REPO_IMPROVED    | skip                | propose writing to library    |
| REPO_CUSTOMISED  | skip                | skip (flag to user)           |
| DIVERGED         | show diff, ask user | show diff, ask user           |

---

## Rules

- **Personal-class skills are dotfiles-only** — never synced into a shared repo.
- **Repos own their skills and agents** — never auto-delete a repo's files; flag mismatches for the user.
- **Never auto-commit or auto-push dotfiles** — leave dirty for human review.
- Never overwrite without semantic comparison (except new installs).
- When uncertain about classification, ask — do not guess.
