---
name: do-push
description: Trunk-based delivery — scaled local review, commit, push directly to main, and issue update. Pre-push hook is the quality gate.
disable-model-invocation: false
---

# do-push

Delivers work directly to main. No PR, no branch, no merge sequencing. The pre-push hook (fmt, clippy, test) is the gate. Review happens locally before push, scaled to the risk of the change.

## Triggers
`/do-push`, "push this", "ship this", "I'm done"

---

## Autonomous mode (under start-team)

- Skip confirmation gates — proceed with defaults
- If pre-push hook fails, attempt to fix twice, then report to coordinator
- Report blockers via message, not by waiting

---

## Stage 1 — Assess change risk

Read the current diff:
```bash
git diff main...HEAD --stat
git diff main...HEAD
```

Classify the change:

| Type | Signals | Review required |
|---|---|---|
| **Trivial** | Docs, comments, config tweaks, test fixes, text changes | Self-review only |
| **Standard** | Single domain, clear scope, no security/auth/crypto touch | 1 local review agent |
| **Security/Architecture** | Ports, crypto, auth, wire format, new deps, cross-cutting | Full local review (arch + security agents) |

State the classification and why. Confirm with user unless in autonomous mode.

---

## Stage 2 — Local review

**Trivial:** briefly self-review the diff. Check nothing obviously wrong. No agent spawn.

**Standard:** spawn `do-local-review` against the current diff. Apply any findings before proceeding.

**Security/Architecture:** spawn `do-local-review` with full mode. Hard stop if ADR escalation is triggered — do not push until resolved.

Review findings are applied inline. A summary is saved to post as an issue comment after push.

---

## Stage 3 — Pre-flight

```bash
# Ensure on main (or a worktree tracking main)
git branch --show-current

# Check for uncommitted changes
git status --porcelain

# Confirm we're not behind
git fetch origin main
git status
```

If uncommitted changes exist, commit them in Stage 4.
If behind origin/main, pull with rebase: `git pull --rebase origin main`.

---

## Stage 4 — Commit (if needed)

If there are staged but uncommitted changes, commit them:
```bash
git commit -S -m "<conventional commit message>"
```

Use a conventional commit message. If multiple logical changes, group into separate commits.

---

## Stage 5 — Push

```bash
git push origin HEAD:main
```

Worktrees use a local branch (e.g. `267-my-feature`) that never goes to remote — `HEAD:main` pushes the commits to `origin/main` regardless of local branch name.

The pre-push hook runs automatically: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test --workspace` (or equivalent for this repo's stack). If it fails, fix the issue and retry — do not use `--no-verify`.

**If another agent pushed first (push rejected):**
```bash
git pull --rebase origin main
# Run tests to confirm nothing broken after rebase
git push origin HEAD:main
```

Retry once automatically. If the second attempt also fails, report to the user.

---

## Stage 6 — Update issue

Find the issue number from the current context (branch name if in a worktree, or ask):
```bash
BRANCH=$(git branch --show-current)
ISSUE_NUM=$(echo "$BRANCH" | grep -oE '^[0-9]+')
```

Post a comment with:
- What was delivered (conventional commit subject lines)
- Review summary (from Stage 2) — even if trivial ("self-reviewed, no findings")
- Any noteworthy decisions made

```bash
gh issue comment "$ISSUE_NUM" --body "<summary>"
```

Set project status to "Done":
```bash
gh issue edit "$ISSUE_NUM" --project-status "Done"
```

---

## Rules

- Never use `--no-verify` on push — the hook is non-negotiable
- Never push to any branch other than main
- Always run local review before push — even trivial changes get a self-review
- ADR escalation is a hard stop — do not push until resolved
- If push fails twice, stop and report — do not loop indefinitely
