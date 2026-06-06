# clear-diff

A local-first, diff-first conversational code reviewer. It reads a whole diff, reorganises it into a navigable structure, and surfaces the right part at the right time. You direct; it writes the comments.

> **Status: pre-release, early days.** The skeleton is being built now — there is no working binary yet. Everything below describes the intended product. Treat the invocation and UX as the target, not current reality.

## The problem

PR review assumed a human typed every line, so a human read every line. That world is ending: code is increasingly agent-generated, automated reviewers cover conventions and coverage, CI catches the mechanical issues, and the volume of change keeps rising.

So the diff-browsing UI from 2008 now works against you. You open a 400-line diff and feel dread. Where do you even start?

The diff is the wrong *starting point*. Diffs aren't useless — they're the evidence. But being handed all of it, in file order, with no sense of what matters, is the wrong front door.

## The inversion

Current tools say: *here's everything that changed, good luck.*

clear-diff says: *here's the change, organised into a shape you can walk through — start at the top, stop when you stop caring.*

An agent reads the whole diff first and reorganises it into a navigable structure. You descend that structure, marking things off as you go, commenting where you want to (by voice, usually). The diff is surfaced as evidence — never pushed at you as a wall.

It works on any diff: a local worktree against `origin/main`, two refs, or a GitHub PR. PRs are just one source of a diff.

## The core model

A review is a tree:

```
Review
└── Chapters     — major tranches of intent, ordered by importance
    └── Sections — curated groups of related change, ordered by relevance
```

- **Chapter** — a major tranche of intent. A small diff is one Chapter; a big diff is several. *("Event-bus migration", "New API surface", "Tests & fixtures".)*
- **Section** — a curated group of related change within a Chapter, grouped by theme rather than file position — so a Section can pull related lines out of several files, or out of different places in one file, and leave the rest behind.

Importance at the top, detail underneath, related things together. Review feels like reading a report instead of scrolling a file dump.

Under the hood the change is split into the smallest mechanical units git emits, and your review marks are keyed to the *content* of those units — not to line numbers or to the agent's grouping. So unrelated edits never disturb your progress, edits to lines you already reviewed resurface automatically, and the agent can regroup freely between runs without losing a mark.

## Principles

- **Structure-first, diff-second.** The diff is evidence surfaced on demand, not the interface.
- **Local-first.** Real work (git, hashing, open-in-editor) runs on your machine against local checkouts. No auth infrastructure for now.
- **Keyboard-native.** Every action is reachable by key and command palette; the mouse is optional. Traversal speed is the product.
- **Selective disclosure over prediction.** The agent structures and orders; *you* decide what to hide by marking. It doesn't guess your mind.
- **You direct, the agent writes.** Comments are drafted in your voice, usually from speech, for your approval.
- **Completion over coverage.** The goal isn't to have read every line — it's to have accounted for every Section and know what you checked.

## Intended invocation

*Target UX — not yet shipped.*

```bash
clear-diff                  # review the current worktree against origin/main
clear-diff <base>..<head>   # any two refs
clear-diff --pr 63          # a GitHub PR (later)
```

The `clear-diff` CLI boots a localhost server and opens the UI in an `--app`-mode browser window. It walks you through the changes, you comment and mark as you go, and when everything is accounted for you click go — comments are dispatched (and, for a PR, posted).

## Architecture & docs

A hexagonal core: a pure domain + application core surrounded by interchangeable adapters, so many front-ends (CLI, local web, later) and back-ends sit over one unchanged core.

- [`docs/concept.md`](docs/concept.md) — the product model and voice. Source of intent.
- [`docs/design-brief.md`](docs/design-brief.md) — the UI and interaction surface.
- [`docs/adr/`](docs/adr/) — architecture decisions: hexagonal boundaries, content-hash identity, the agent-untrusted invariant, marks persistence.

## Roadmap

Early and in active development. The core model is settled; the build is starting. Follow along through the issues and commits.

## Licence

MIT — see [`LICENSE`](LICENSE).
