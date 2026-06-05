---
title: "clear-diff"
category: personal
tags: [idea, product, code-review, diff, AI-agents, developer-tools, local-first, clear-diff]
status: active
date_created: 2026-04-01
last_updated: 2026-06-05
---

# clear-diff

## The Problem

PR review was designed for a world where a human typed every line, so a human read every line. That world is ending. Code is increasingly agent-generated, automated reviewers already cover conventions and coverage, linting and CI catch the mechanical issues — and the volume of change is rising fast.

The result: the diff-browsing UI from 2008 now works against you. You open a 400-line diff and feel dread. Where do you even start?

**The diff is the wrong primary interface.** Not because diffs are useless — they're the evidence — but because being handed *all* of it, in file order, with no sense of what matters, is the wrong starting point.

clear-diff fixes the *starting point*, not by guessing what you care about, but by **structuring the change and showing you the right part at the right time.**

---

## The Inversion

Current tools say: *here's everything that changed, good luck.*

clear-diff says: *here's the change, organised into a shape you can walk through — start at the top, stop when you stop caring.*

The agent reads the whole diff first and reorganises it into a navigable structure. You descend that structure, marking things off as you go, commenting where you want to (by voice, usually), and the diff is surfaced as evidence — never pushed at you as a wall.

It works on any diff: a local worktree against `origin/main`, two refs, or a GitHub PR. **Diff-first, local-first.** PRs are just one source of a diff.

---

## The Core Model

A review is a tree:

```
Review
└── Chapters        — overarching tranches of functionality, ordered by importance
    └── Sections    — coherent groupings of related change, ordered by relevance
        └── atoms   — the mechanical git hunks (internal plumbing; you never see the word)
```

- **Chapter** — a major tranche of intent. A small diff is one chapter; a big diff is several. *"Event-bus migration", "New API surface", "Frontend wiring", "Tests & fixtures".*
- **Section** — a curated group of related changes within a chapter. Defined by **theme, not position** — so a section can pull related lines out of several places, even out of a single file, and leave the rest behind. *"The retry logic", "Domain model changes", "The tests".*
- **atom** — one git hunk. The indivisible mechanical unit everything is built from. Internal only — the user vocabulary is Chapters and Sections.

This is what lets review feel like reading a report instead of scrolling a file dump: importance at the top, detail underneath, related things together.

---

## Two Layers: Mechanical and Semantic

The single most important design decision. The structure has two layers, and they're kept strictly separate:

**Mechanical layer (git — stable, deterministic).** The atoms. We take the diff with fine granularity (`git diff -U0 --histogram -M`) so git itself splits the change into small, contiguous line-runs. No arbitrary line-drawing by the agent — the atoms are whatever git emits.

**Semantic layer (agent — fluid, disposable).** Chapters and Sections are groupings *over* atoms. The agent regroups and reorders these freely on every run.

The two layers never contaminate each other, and that buys us everything below.

---

## Identity & Marking

You mark sections off as you review — the way GitHub's "viewed" works, but smarter:

- **done** — reviewed, happy
- **skipped / ignored** — don't care (huge test file, lockfile churn, generated code)

The trick: **marks live on atoms, keyed by a content hash of the atom's payload** (the added/removed lines, normalised, context excluded) — *not* on line numbers, and *not* on the agent's grouping.

This makes the whole thing work:

- **Unrelated edits don't disturb you.** Someone changes code elsewhere in the file → your atom's payload is unchanged → same hash → still marked done.
- **Changed work resurfaces automatically.** Someone edits the exact lines you reviewed → payload changes → new hash → it comes back as unreviewed. You don't build this behaviour; it falls out of the hash.
- **Regrouping is free.** Because identity is on atoms, not on chapters/sections, the agent can completely reorganise the semantic layer between runs without losing a single mark.

When atoms merge or split between revisions, they simply resurface — correct behaviour, since something there genuinely changed. (Conceptually this is what `git range-diff` does — fuzzy-matching hunks across two versions of a patch — done as a lightweight content hash.)

---

## Ordering

Importance reorders the coarse grain; git keeps the fine grain stable.

| Level | Ordering | Why |
|---|---|---|
| **Chapters** | by importance | which tranche to review first |
| **Sections** | by relevance — **not** git order | group related change, relegate tests/docs even within the same file |
| **atoms** | **git order, always** | within a coherent unit, lines never jump around |

So the agent tells you *what's important* and *what's related*; git tells you *where things are* inside any one section. A file can therefore appear in several places — domain section early, test section late — and that revisiting is intentional. The diff view renders a file in pieces (*atom, gap, atom*), never assuming one continuous file.

The atoms-in-git-order floor is the safety net: even a poor grouping never feels fully random.

---

## The Interaction

You descend the structure. For each chapter, top section first, you read the surfaced diff and either:

- **mark it** (done / skip), or
- **comment** — click a line and talk. Voice-to-text is the primary input, strongly encouraged: you just say what you mean and the agent writes the comment in your voice. *"Tell them to use the existing retry util rather than rolling their own."*
- **open the file** — jump to the real file at that line in your editor (VS Code / Zed / configurable) when the diff isn't enough.

A **chat panel runs alongside** for questions that aren't line comments — *"is this backwards compatible?", "show me the failure path"*. Chat operates at the chapter level.

You work down each chapter until you stop caring, then move on. When everything's accounted for, you **click go** — comments are dispatched (and, for a PR, posted).

The point throughout: **less guessing, more selective disclosure.** The agent's job is to structure and surface; yours is to decide what's worth your attention. The marking — not an AI prediction — is what hides the noise.

---

## clear-diff.md

Two layers of plain-markdown instructions, working like CLAUDE.md, that steer how the reviewer *presents* the change:

| Path | Scope |
|---|---|
| `~/.clear-diff.md` | Personal — your standing preferences across every repo |
| `clear-diff.md` (repo root) | Project — committed, benefits the whole team |

Personal might say *"I care most about architectural changes and boundary violations; deprioritise CSS."* Project might say *"the domain layer is sacred; flag anything touching auth."* These shape chaptering, section relevance, and what gets relegated.

---

## Invocation

Local-first, local checkouts, no auth infrastructure for now:

```bash
clear-diff                    # review the current worktree against origin/main
clear-diff <base>..<head>     # any two refs
clear-diff --pr 63            # a GitHub PR (later)
```

It walks you through the changes you can comment on, change, and approve.

---

## Design Principles

- **Structure-first, diff-second.** The diff is evidence the agent surfaces on demand, not the interface.
- **Two layers, never mixed.** Git owns mechanical truth and identity; the agent owns semantic grouping. Marks live on the mechanical layer.
- **Selective disclosure over prediction.** The agent structures and orders; *you* decide what to hide by marking. It doesn't guess your mind.
- **You direct, the agent writes.** Comments — drafted in your voice, usually from speech — for your approval.
- **Completion over coverage.** The goal isn't to have read every line. It's to have accounted for every section and know what you checked.

---

## Out of Scope (for now)

Deliberately not in the first cut — noted so they don't creep in:

- Auth infrastructure (OAuth/keychain) — relies on local checkouts and existing creds
- Posting reviews back to GitHub at scale / non-Comment review states
- A persistent log/audit trail of what was reviewed (a likely V2)
- Multi-platform (GitLab, Bitbucket)
- Learning your preferences over time from review history
- Standalone-desktop vs in-host (MCP app) form factor — **the one open decision**, deferred until the model is proven

---

## The One Open Decision

**Form factor.** A standalone desktop app gives full control of the click-line / voice / split-pane / open-in-editor experience, keyboard-driven and focused — but it's heavier to build. Riding inside an existing host (Claude Code / Claude Desktop as an MCP app with inline HTML) is far cheaper and reuses chat + credentials — but constrains the UI to what the host can render.

Everything else in this document is decided. This is the next thing to pin down.
