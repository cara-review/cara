# REMIT.md

Scope context for the Remit tool — how it decides whether an agent's tool call fits the session scope in this repo. Seed doc; expand as Remit gets calls wrong.

## Project

cara — local-first, diff-first conversational code reviewer. Node CLI. The agent reorganises a whole diff into a tree (**Review → Chapters → Sections → atoms**) and surfaces the right part at the right time. atoms are git hunks (mechanical, stable); Chapters/Sections are agent groupings over them (semantic, disposable). The two layers never mix.

## In scope

- Anything in this repo.
- Trunk-based work on `main` or a `cara-worktrees/<issue>-<slug>` worktree, tracked by a `cara-review/cara` GitHub issue.
- Code change + its matching `docs/` update, together.
- Git operations on this repo — `git` (status, diff, add, commit, push, worktree, etc.) and `gh` for issues/projects/PRs on `cara-review/cara`. These are normal work here, not out-of-scope side effects.

## Out of scope

- Pushing with `--no-verify`.
- Editing `main` inside a worktree; worktrees in hidden dirs.

## Note

Bookkeeping tools (`TaskCreate`, `TodoWrite`, `AskUserQuestion`, `ScheduleWakeup`) describe the agent's intent, not an action being taken — judge the work, not the subject text.
