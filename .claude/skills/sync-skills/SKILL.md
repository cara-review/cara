---
name: sync-skills
description: Syncs skills from the dotfiles canonical library to ~/.claude/skills/ (the global active location). Detects workflow mode and deploys the right set. Uses LLM semantic comparison to detect improvements vs customisations.
disable-model-invocation: false
---

# sync-skills

Keeps skills in sync between the dotfiles canonical library and repos. Workflow skills live in repos (`agent/skills/`) so every developer gets the right tools on clone. Personal skills stay in dotfiles only.

Skills in dotfiles are organised by class in `skills-lib/`:

- `shared/` — syncs to all repos
- `pr-based/` — syncs to PR-workflow repos only
- `trunk-based/` — syncs to trunk-based repos only
- `personal/` — never syncs to repos (personal tools only)

## Triggers

`/sync-skills`, "sync skills", "sync my skills", "update skills"

---

## Direction

If the user says "sync skills" without specifying direction, infer from context:

- If they've just edited skills in dotfiles → dotfiles → active
- If they've just improved a skill in `~/.claude/skills/` → active → dotfiles
- If unclear, ask: "Which direction? dotfiles → active, active → dotfiles, or both?"

Explicit flags:

- `/sync-skills` — infer or ask
- `/sync-skills --to-active` — dotfiles → `~/.claude/skills/`
- `/sync-skills --to-dotfiles` — `~/.claude/skills/` → dotfiles
- `/sync-skills --both` — dotfiles → active first, then back-propagate

---

## Stage 1 — Detect workflow mode

Read the current repo's `CLAUDE.md` (check `.claude/CLAUDE.md` first, then root `CLAUDE.md`).

Does this repo declare a development workflow? Look for explicit statements like "trunk-based development", "push directly to main", "PR-based", "feature branches".

Classify as: `trunk-based`, `pr-based`, or `unknown`.

If `unknown`, ask the user: "I couldn't detect the workflow mode from your CLAUDE.md. Is this repo trunk-based or PR-based? You may want to add a line like: `## Workflow: trunk-based`"

Target skill set = `shared` + `personal` + `<workflow-class>`.

---

## Stage 2 — Resolve paths

```
DOTFILES="$HOME/dev/dotfiles"
SKILLS_LIB="$DOTFILES/claude/skills-lib"
ACTIVE="$HOME/.claude/skills"
```

List canonical skills for this environment by scanning `shared/`, `personal/`, and `<workflow-class>/` in `skills-lib/`.

---

## Stage 3 — Direction: dotfiles → active

For each canonical skill in the target set:

**Not present in active** → copy the entire skill directory in.

**Present in active** → compare semantically (Stage 5). If dotfiles version is better, overwrite. If identical or locally customised, skip.

**Skills in active that no longer belong** (wrong class for this workflow, or deleted from dotfiles) → delete them. No confirmation needed — the dotfiles is the source of truth.

Report: Installed / Updated / Removed / Skipped (identical).

---

## Stage 4 — Direction: active → dotfiles

For each skill in `~/.claude/skills/`, find its canonical counterpart in `skills-lib/`.

If no counterpart → this is a local-only skill. Ask: "I found `<skill>` in active with no dotfiles counterpart. Want to add it to skills-lib? If so, which class: shared, pr-based, trunk-based, or personal?"

If counterpart exists → compare semantically (Stage 5).

After review, write approved changes to `skills-lib/`. Remind the user: "Changes written to skills-lib. Review with `git diff` in your dotfiles repo and commit when happy."

Never auto-commit or auto-push dotfiles.

---

## Stage 5 — LLM semantic comparison

For any skill present in both places:

1. **Byte-identical check** — if files match exactly, skip.

2. **Read both full versions** and classify:

```
You are comparing two versions of a Claude Code skill named '<skill>'.

DOTFILES VERSION (canonical):
<full content>

ACTIVE VERSION:
<full content>

Classify as exactly one of:
- IDENTICAL: semantically the same, cosmetic/whitespace differences only
- DOTFILES_NEWER: dotfiles version is strictly better — more complete, clearer, or fixes a bug
- ACTIVE_IMPROVED: active version has genuine improvements that should go back to dotfiles
- ACTIVE_CUSTOMISED: active version has local changes that should not be back-propagated
- DIVERGED: both sides have meaningful changes — requires human judgement

Respond with the classification on the first line, then a one-sentence reason.
```

3. Act on classification:

| Classification    | dotfiles → active   | active → dotfiles             |
| ----------------- | ------------------- | ----------------------------- |
| IDENTICAL         | skip                | skip                          |
| DOTFILES_NEWER    | overwrite active    | skip                          |
| ACTIVE_IMPROVED   | skip                | propose writing to skills-lib |
| ACTIVE_CUSTOMISED | skip                | skip (flag to user)           |
| DIVERGED          | show diff, ask user | show diff, ask user           |

---

## Rules

- Skills are personal — never sync to or from a repo directory
- Never auto-commit or auto-push dotfiles — always leave dirty for human review
- Never overwrite without semantic comparison (except new installs)
- When uncertain about classification, ask — do not guess
