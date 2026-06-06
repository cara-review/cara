---
name: do-close
description: Closes a GitHub issue — confirms the work was delivered, comments with outcome, sets project status to "Done". No local cleanup (use do-cleanup for that).
---

# do-close

Closes the GitHub issue for a piece of work. Confirms how the work was delivered and updates the issue to reflect the real outcome.

**Scope:** GitHub only — issue state, project status, comments. Does not touch worktrees, branches, or tmux sessions. Use `do-cleanup` for local cleanup.

**Idempotency:** If the issue is already closed, reports it and stops.

## Triggers

`/do-close`, "close this issue", "close this out", "mark this done"

---

## Step 1 — Identify the Issue

Infer from branch name (`<issue-number>-<slug>`):

```bash
BRANCH=$(git branch --show-current)
ISSUE_NUM=$(echo "$BRANCH" | grep -oE '^[0-9]+')
gh issue view "$ISSUE_NUM" --json number,title,state,projectItems 2>/dev/null
```

If no issue number found: ask the user.
If issue already closed: report and stop.

---

## Step 2 — Confirm delivery

**Trunk-based repos** (push direct to main, no PR — CLAUDE.md `## Workflow: trunk-based`): there is no PR. Confirm the work actually landed on main.

```bash
git fetch origin main -q
git log origin/main --oneline -10        # the issue's commits should be here
```

Determine outcome:

- **Landed on main** — happy path
- **Not on main yet** — warn: "No commits for #N on origin/main yet. Close anyway? (1) Yes / (2) No — I'll ship first via do-push"

**PR-based repos:** check PR state.

```bash
gh pr list --head "$BRANCH" --state all \
  --json number,title,state,mergedAt,closedAt,url
```

- **Merged** — happy path
- **Closed without merge** — note it
- **Still open** — warn: "PR #N is still open. Close the issue anyway? (1) Yes / (2) No — I'll merge first"
- **No PR found** — note it, proceed to close

---

## Step 3 — Close the Issue

Comment reflecting the actual outcome, then close:

**Delivered to main (trunk-based):**

```bash
gh issue comment "$ISSUE_NUM" --body "Delivered to main — <commit SHAs / subject lines>."
gh issue close "$ISSUE_NUM"
```

**Merged (PR-based):**

```bash
gh issue comment "$ISSUE_NUM" --body "Completed — merged via PR #<N>."
gh issue close "$ISSUE_NUM"
```

**Closed without merge:**

```bash
gh issue comment "$ISSUE_NUM" --body "PR #<N> was closed without merging."
gh issue close "$ISSUE_NUM" --reason "not planned"
```

**Still open (override):**

```bash
gh issue comment "$ISSUE_NUM" --body "Closed — PR #<N> still open."
gh issue close "$ISSUE_NUM"
```

**No PR:**

```bash
gh issue comment "$ISSUE_NUM" --body "Closed without a PR."
gh issue close "$ISSUE_NUM"
```

Set project status to "Done":

```bash
OWNER="<org-or-user>"
PROJECT_NUM=$(gh issue view "$ISSUE_NUM" --json projectItems --jq '.projectItems[0].project.number')
ITEM_ID=$(gh issue view "$ISSUE_NUM" --json projectItems --jq '.projectItems[0].id')
PROJECT_ID=$(gh project view "$PROJECT_NUM" --owner "$OWNER" --format json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

# Get Status field ID and "Done" option ID
gh project field-list "$PROJECT_NUM" --owner "$OWNER" --format json | python3 -c "
import json,sys
fields = json.load(sys.stdin).get('fields',[])
for f in fields:
    if f.get('name') == 'Status':
        print('FIELD_ID=' + f['id'])
        for opt in f.get('options',[]):
            if opt['name'] == 'Done':
                print('OPTION_ID=' + opt['id'])
"

gh project item-edit --project-id "$PROJECT_ID" --id "$ITEM_ID" --field-id "$STATUS_FIELD_ID" --single-select-option-id "$OPTION_ID"
```

Remove `needs-human` label if present:

```bash
gh issue edit "$ISSUE_NUM" --remove-label "needs-human" 2>/dev/null
```

---

## Summary

```
Issue #<N> <title> — Done (<delivered to main / merged / not delivered>)
```

---

## Autonomous Mode

When running as a developer under `start-team`:

- Skip confirmation on closing
- If the work hasn't landed on main (or, on PR repos, the PR is still open), report to the coordinator instead of waiting for user choice

---

## Rules

- Never conflate delivered/merged with not-delivered/closed-without-merge — the comment must reflect reality
- If the work hasn't landed (no commits on main, or PR still open), always warn before closing the issue
- No local cleanup — worktrees, branches, and tmux are `do-cleanup`'s job
