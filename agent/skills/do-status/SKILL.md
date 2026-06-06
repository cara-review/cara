---
name: do-status
description: Dashboard of all active worktrees — branch, linked issue, GitHub Project status, and delivery state. Read-only. Flags stale worktrees and anything needing attention.
---

# do-status

A read-only overview of all active work. Shows every worktree, what ticket it's linked to, where it is in the workflow (from GitHub Projects), and whether anything looks stale or needs action.

## Triggers

`/do-status`, "what's in progress", "show worktrees", "what's open", "what am I working on"

---

## Step 1 — List Worktrees

```bash
git worktree list
```

---

## Step 2 — Resolve Issue, Project Status, and Delivery State Per Worktree

For each linked (non-main) worktree:

```bash
BRANCH="<branch>"
ISSUE_NUM=$(echo "$BRANCH" | grep -oE '^[0-9]+')

# Issue state + project status
gh issue view "$ISSUE_NUM" --json number,title,state,labels,projectItems \
  --jq '{number, title, state, labels: [.labels[].name], project: .projectItems[0].project.title, status: .projectItems[0].status.name}' 2>/dev/null

# If status is Blocked or Needs Human, get the "Blocked reason" field
gh issue view "$ISSUE_NUM" --json projectItems \
  --jq '.projectItems[0].fieldValues' 2>/dev/null

# Delivery state
# Trunk-based (no PR — CLAUDE.md `## Workflow: trunk-based`): compare the branch to origin/main
git fetch origin main -q
git rev-list --left-right --count origin/main...HEAD 2>/dev/null   # "<behind>  <ahead>"

# PR-based repos: query the PR instead
# gh pr list --head "$BRANCH" --state all --json number,title,state,url --jq '.[0]' 2>/dev/null
```

---

## Step 3 — Render Dashboard

```
Active worktrees
--------------------------------------------------------------------------------
 Worktree                         Branch              Issue        Status       Delivery
--------------------------------------------------------------------------------
 ~/dev/myapp                      main                —            —            —
 ~/dev/myapp-wt/42-auth           42-auth-refactor    #42 open     In Progress  3 ahead, 0 behind
 ~/dev/myapp-wt/55-model          55-data-model       #55 open     In Progress  not started
 ~/dev/myapp-wt/61-login-fix      61-fix-login        #61 closed   Done         landed on main
 ~/dev/myapp-wt/70-cache          70-add-cache        #70 open     Blocked      2 ahead, 5 behind
--------------------------------------------------------------------------------
```

(On PR-based repos the **Delivery** column shows PR state instead: `PR #87 open`, `PR #91 merged`, `— not raised`.)

**Status** column from GitHub Project status:

- Backlog, Next, Ready, In Progress, Blocked, Needs Human, In Review, Done

**Annotations:**

- If status is "Blocked" or "Needs Human", show the "Blocked reason" field value on a second line
- If `needs-human` label is present, append " [HUMAN]"

**Delivery** column:

- Trunk-based: `N ahead, M behind` origin/main · `landed on main` (work merged, nothing ahead) · `not started` (no commits)
- PR-based: open / merged / closed-no-merge / — not raised

---

## Step 4 — Callouts

After the table, flag anything notable:

- **Stale worktree:** work landed on main (or, on PR repos, PR merged/closed) but worktree still exists — "`.../61-login-fix` looks stale — delivered. Run `do-close` / `do-cleanup`."
- **Unshipped work:** commits ahead of main but status still In Progress for a while — "Issue #N has N commits not yet on main."
- **Branch behind main:** fetch and check — "Branch `42-auth-refactor` is N commits behind main. Run `do-sync`."
- **No issue inferred:** branch name doesn't match convention — "Branch `old-experiment` has no associated issue."
- **Blocked items:** any issue with status "Blocked" or "Needs Human" — surface the blocked reason.

---

## Rules

- Read-only — never modify issues, PRs, or branches
- Never guess issue numbers if branch naming doesn't match the convention
