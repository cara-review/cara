---
name: do-commit
description: Mid-work commit checkpoint. Groups and commits changes without excessive confirmation. Warns if any changes appear unrelated to the current ticket — and offers do-split to handle them.
---

# do-commit

A fast commit checkpoint for mid-work progress. Analyses and groups changes, then commits them. Minimal interaction — it just does it, unless something looks wrong.

**The one thing that will always stop it:** changes that appear unrelated to the current ticket. Those are flagged prominently and you're offered `do-split`.

## Triggers
`/do-commit`, "commit my changes", "checkpoint this", "save progress"

---

## Autonomous Mode

When running as a developer under `start-team`:
- Skip all confirmation gates — group and commit without asking
- Unrelated changes check still applies — but instead of waiting for user choice, default to excluding unrelated files and reporting them to the team lead
- Proceed with conventional commit messages without confirmation

---

## Step 1 — Check State

```bash
git status --porcelain
git diff --stat
git diff
git diff --cached
git branch --show-current
```

If working tree is clean: "Nothing to commit." Stop.

---

## Step 2 — Identify the Ticket Context

Infer the issue from the branch name:
```bash
BRANCH=$(git branch --show-current)
ISSUE_NUM=$(echo "$BRANCH" | grep -oE '^[0-9]+')
gh issue view "$ISSUE_NUM" --json title,body --jq '"#\(.number): \(.title)\n\(.body | split("\n")[0:3] | join("\n"))"' 2>/dev/null
```

This gives the context used to assess whether changes belong here.

If no issue can be inferred from the branch name, skip the unrelated-changes check and proceed to Step 4.

---

## Step 3 — Unrelated Changes Check ⚠️

**This is the most important step.** Compare the changed files and their content against the ticket context.

Assess each changed file: does it plausibly relate to the issue title/description? Consider:
- File path and module (e.g. changes in `auth/` when the ticket is about `billing/`)
- Nature of the change (e.g. a refactor of a completely different system)
- Commit messages if any staged commits exist

**If any changes look unrelated, stop and warn prominently:**

> "⚠️ Some changes don't appear related to issue #N (`<title>`):
>
> Likely unrelated:
> - `src/some-other-module/file.ts` — looks like [reason]
>
> Options:
> 1. **Run `do-split`** — move unrelated changes to their own branch/issue (recommended)
> 2. **Commit everything together** — I'll proceed including these files
> 3. **Exclude them** — I'll commit only the related files; unrelated ones stay uncommitted"

Wait for choice before continuing.

If the user chooses (3), exclude those files from all subsequent steps.

---

## Step 4 — Group and Commit

Analyse the (related) changes and group logically. **Never mix refactoring with functional changes.**

Show a brief summary of what will be committed — no confirmation gate, just proceed:

```
Committing:
  feat(auth): add JWT session validation  →  src/auth/session.ts, src/routes/auth.ts
  test(auth): unit tests for session validation  →  src/auth/__tests__/session.test.ts
```

Then commit each group:
```bash
git add <specific files>
git commit -m "<conventional commit message>"
```

Use conventional format: `<type>(<scope>): <description>`
Types: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `style`, `perf`

---

## Step 5 — Summary

```bash
git log --oneline -n <commits created>
git status
```

Report: commits created, any files left uncommitted (and why).

---

## Rules
- Never `git add -A` — always stage specific files
- Never commit secrets or generated files
- Always check for unrelated changes before committing — this is non-negotiable
- Don't ask "does this look right?" for normal grouped commits — just do it
- This is a mid-work tool — use `do-push` when ready to ship
