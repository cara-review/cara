---
title: "clear-diff"
category: personal
tags: [idea, product, code-review, diff, AI-agents, developer-tools, local-first, clear-diff]
status: active
date_created: 2026-04-01
last_updated: 2026-06-10
---

# clear-diff

## The Problem

PR review assumed a human typed every line, so a human read every line. That world is ending: code is increasingly agent-generated, automated reviewers already cover conventions and coverage, linting and CI catch the mechanical issues, and the volume of change is rising fast.

The result: the diff-browsing UI from 2008 now works against you. You open a 400-line diff and feel dread. Where do you even start?

**The diff is the wrong primary interface.** Diffs aren't useless; they're the evidence. But being handed *all* of it, in file order, with no sense of what matters, is the wrong starting point.

clear-diff fixes the *starting point*, not by guessing what you care about, but by **structuring the change and showing you the right part at the right time.**

---

## The Inversion

Current tools say: *here's everything that changed, good luck.*

clear-diff says: *here's the change, organised into a shape you can walk through — start at the top, stop when you stop caring.*

The agent that made (or is reviewing) the change reads the whole diff and reorganises it into a navigable structure. You descend that structure, marking things off as you go, commenting where you want to (by voice, usually), and the diff is surfaced as evidence — never pushed at you as a wall.

It works on any diff: a local worktree against `origin/main`, two refs, or a GitHub PR (later). **Diff-first, local-first.** PRs are just one source of a diff.

---

## The Engine and the Agent

clear-diff is **not** an AI tool with an LLM inside it. It is a **trusted, deterministic accounting engine** that an external agent drives.

- **The engine (clear-diff)** runs git, computes the atoms, owns identity and marks, enforces completeness. It carries **no LLM, no model, no API key.** Everything it reports is mechanically true.
- **The agent (your coding tool — Claude Code, Cursor, the session that *made* the change)** reads the diff and supplies the grouping. It already has the richest possible context: it wrote the code. It drives the engine over a small CLI protocol.

This split is the whole point. The agent *arranges and describes*; it can never *define or change* what's in the review. Putting the LLM **outside** the trust boundary is the property every downstream capability (a completeness gate, multi-lens review, an audit artifact) rests on — see [TN-26-025](tn/TN-26-025-competitive-landscape-and-positioning.md).

---

## The CLI Protocol

The agent drives the engine with four verbs plus a self-describing helper. clear-diff never calls *out* to the agent — every verb is agent-invoked, which is what makes it portable to any platform that can run a command and read JSON. No hooks, no callbacks, no per-platform code.

```
clear-diff atoms [spec]       # engine → agent: context, merged methodology, atoms
                              #   (hash, path, ranges, diff lines), open items.
clear-diff present [grouping] # agent → engine: grouping JSON → bijection repair →
                              #   boots server + browser. --no-open stays headless.
clear-diff dispatch [--wait]  # engine → agent: all comments (open|addressed) + progress.
clear-diff submit <batch>     # agent → engine: dispositions and/or answers, batched.
                              #   Returns the gap report ("38/41 accounted; missing: …").
clear-diff instructions       # emits the canonical loop + verb reference.
```

- **Core as agent memory.** Every response returns the full open state + a gap report; the agent tracks nothing across calls.
- **Self-narrating.** Every JSON response carries a `next` hint ("now run: …"); a cold agent that runs any one verb is pulled through the whole loop. `clear-diff instructions` emits the canonical protocol, generated from the same source — no doc drift.
- **Fixes need no verb.** The agent edits code, the atom's hash changes, the engine marks the comment addressed mechanically. Only answers are data.

The protocol is ratified in [ADR-0011](adr/0011-cli-agent-protocol.md).

---

## Two Modes

clear-diff is dual-mode from day one — the same engine, the same atoms, a different reviewer in the seat.

| | Human-in-loop | Autonomous |
|---|---|---|
| Flow | `atoms` → agent groups → `present` → human reviews in browser → "done" → agent edits + answers → converge | `atoms` → agent reviews → `submit` marks + comments → gap report → resubmit until clean. No browser. |
| Reviewer | human (browser) | the calling agent (CLI) |
| Mark tier | `human` | `agent` |
| Synchroniser | the human ("done — pick it up") | none |

Hybrid is free: an agent pre-reviews autonomously; a human later opens the same context, sees the pre-marked tree with tiers visible, and adjudicates only the residue.

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

The single most important design decision. Two layers, kept strictly separate:

**Mechanical layer (git — stable, deterministic).** The atoms. The engine takes the diff with fine granularity (`git diff -U0 --histogram -M`) so git itself splits the change into small, contiguous line-runs. No arbitrary line-drawing by the agent — the atoms are whatever git emits. This is the **master list**: the complete surface area of the change, computed with zero agent involvement.

**Semantic layer (agent — fluid, disposable).** Chapters and Sections are groupings *over* atoms, supplied by the agent and regrouped freely on every run.

The two layers never contaminate each other. The engine enforces a **bijection**: the union of all sections equals the master list, exactly — unplaced atoms sweep into a trailing "Other changes" section, dangling ids are dropped. The agent returns ids + titles + summaries only; it **cannot add, remove, hide, or edit an atom**. Counts and completion derive from the master list, never the grouping, so a grouping can never make the change look smaller than it is. See [ADR-0004](adr/0004-agent-untrusted-master-list.md).

---

## Identity & Marking

You (or the agent) mark off as you review — a whole section at once, or block by block — the way GitHub's "viewed" works, but smarter:

- **done** — reviewed, happy
- **skipped / ignored** — don't care (huge test file, lockfile churn, generated code)

The trick: **marks live on atoms, keyed by a content hash of the atom's payload** (the added/removed lines, normalised, context excluded) — *not* on line numbers, and *not* on the agent's grouping.

This makes the whole thing work:

- **Unrelated edits don't disturb you.** Someone changes code elsewhere in the file → your atom's payload is unchanged → same hash → still marked done.
- **Changed work resurfaces automatically.** Someone edits the exact lines you reviewed → payload changes → new hash → it comes back as unreviewed. You don't build this behaviour; it falls out of the hash.
- **Regrouping is free.** Because identity is on atoms, not on chapters/sections, the agent can completely reorganise the semantic layer between runs without losing a single mark.

Each mark carries an **author tier** — `human` or `agent` — inferred from the channel it arrives on: a browser session is `human`, a CLI invocation is `agent`. There is **no override flag**; an agent cannot stamp a mark `human` even if prompted to. Impersonation is structurally impossible, the provenance analogue of the bijection. Multiple headless reviewers can carry an optional `reviewer` label (`"security"`, `"architecture"`) so they stay distinguishable.

Marks are stored as a per-review append-only event log, folded to current state on each open — see [ADR-0005](adr/0005-review-store-event-log.md).

---

## Ordering

Importance reorders the coarse grain; git keeps the fine grain stable.

| Level | Ordering | Why |
|---|---|---|
| **Chapters** | by importance | which tranche to review first |
| **Sections** | by relevance — **not** git order | group related change, relegate tests/docs even within the same file |
| **atoms** | **git order, always** | within a coherent unit, lines never jump around |

So the agent tells you *what's important* and *what's related*; git tells you *where things are* inside any one section. A file can therefore appear in several places (domain section early, test section late), and that revisiting is intentional. The diff view renders a file in pieces (*atom, gap, atom*), never assuming one continuous file.

The atoms-in-git-order floor is the safety net: even a poor grouping never feels fully random.

---

## The Interaction

Each chapter and section can be headed by a short **AI summary** — an agent-written orientation of what the change does, taken with a pinch of salt. It's an aid, never authoritative and never a substitute for reading the diff; the evidence below it is the truth.

You descend the structure. For each chapter, top section first, you read the surfaced diff and either:

- **mark it** — done or skip. Mark a whole section in one keystroke, or *zap through it block by block*: each change-block ticks off on its own and the section completes when the last one's ticked. Either granularity lands the mark on the underlying atoms.
- **comment** — click a line and talk. Voice-to-text is the primary input, strongly encouraged: you just say what you mean and the agent writes the comment in your voice. *"Tell them to use the existing retry util rather than rolling their own."*
- **open the file** — jump to the real file at that line in your editor (VS Code / Zed / configurable) when the diff isn't enough.

**The comment is the only interface.** There is no chat pane. A comment is freeform in, structured out — you say what you mean and the agent infers whether to edit code, answer, or both. Questions are just comments; the answer routes back to the agent and renders inline at the atom (sanitized markdown, untrusted overlay). A comment is `open` until the atom's payload changes or an answer is attached; the reviewer adjudicates on reopen and re-raises by commenting again.

You work down each chapter until you stop caring, then move on. When everything's accounted for, the comments are already in the agent's hands — `dispatch` is the engine's sole egress, and the agent composes any file or PR export it wants from that output.

The point throughout: **less guessing, more selective disclosure.** The agent's job is to structure and surface; yours is to decide what's worth your attention. The marking — not an AI prediction — is what hides the noise.

---

## Keyboard-Native

The whole review is drivable from the keyboard, with the rapid, IDE-fast feel of a modern editor. The mouse is always optional, never required. This is a hard requirement: traversal speed is the product.

- **Command palette.** One chord (e.g. `Cmd/Ctrl-K`) fuzzy-searches every action: mark done/skip, comment, open-in-editor, jump to chapter/section, switch diff source, mark complete. Everything reachable, nothing memorised, nothing buried in a menu.
- **Smart shortcuts.** Single-key bindings for the hot path: next/previous section, mark done, skip, comment, open file. Vim-style `j/k` alongside arrows. Contextual — the same key does the obvious thing for whatever's focused.
- **Focus model.** Movement through the tree (chapter → section → atom) and between panes (diff, comment) is fully keyboarded, with a visible focus indicator always. Voice dictation drops into a comment without breaking flow.
- **Customisable & shown.** Bindings remappable; the palette shows each action's current shortcut, so the keyboard map teaches itself.

---

## CLEAR_DIFF.md and config

Two kinds of configuration, both plain and local.

**Review guidance** — plain-markdown instructions, working like CLAUDE.md, that steer how the change is *presented*. Two layers, merged and fed to the agent on every `atoms` call:

| Path | Scope |
|---|---|
| `~/.clear-diff/CLEAR_DIFF.md` | Personal — your standing preferences across every repo |
| `CLEAR_DIFF.md` (repo root) | Project — committed, benefits the whole team |

Personal might say *"I care most about architectural changes and boundary violations; deprioritise CSS."* Project might say *"the domain layer is sacred; flag anything touching auth."* These shape chaptering, section relevance, and what gets relegated.

**Behaviour config** — `~/.clear-diff/config.toml`: grouping mode (`llm` | `git-order`), the bundled LLM porcelain's provider/model/API-key *env-var name* (never the key itself), and the editor command. No silent fallbacks — behaviour is configured, never inferred; a missing key is a loud error, never a quiet drop to the floor.

---

## Invocation

Local-first, local checkouts, no auth infrastructure for now. Two ways in:

```bash
# Plumbing — the agent drives these directly (LLM-free, no key):
clear-diff atoms              # current worktree against origin/main
clear-diff atoms <base>..<head>
clear-diff present grouping.json
clear-diff dispatch --wait
clear-diff submit batch.json

# Porcelain — the bundled LLM wrapper that groups for you:
clear-diff review             # bare: full semantic review, opens the browser
clear-diff review --headless  # autonomous, no browser
clear-diff review --headless --reviewer security   # one labelled lens
```

`clear-diff review` is a thin LLM wrapper around the same verbs: it calls an LLM to group, then drives `present`/`submit` for you. It is the *only* place an API key is touched; the plumbing verbs never read the `[grouping]`/`[llm]` config at all.

---

## Design Principles

- **Trusted engine, untrusted agent.** clear-diff is a deterministic accounting engine; the LLM lives outside the boundary. The agent arranges and describes, never defines or changes the review.
- **Structure-first, diff-second.** The diff is evidence the agent surfaces on demand, not the interface.
- **Two layers, never mixed.** Git owns mechanical truth and identity; the agent owns semantic grouping. Marks live on the mechanical layer.
- **Selective disclosure over prediction.** The agent structures and orders; *you* decide what to hide by marking. It doesn't guess your mind.
- **You direct, the agent writes.** Comments — drafted in your voice, usually from speech — for your approval.
- **Completion over coverage.** The goal isn't to have read every line. It's to have accounted for every section and know what you checked.
- **Keyboard-native.** Every action is reachable by key and command palette; the mouse is optional. Traversal speed — IDE-fast — is the product.

---

## Out of Scope (for now)

Deliberately not in the first cut — noted so they don't creep in:

- Auth infrastructure (OAuth/keychain) — relies on local checkouts and existing creds
- Posting reviews back to GitHub at scale / non-Comment review states
- A standing/cross-context store of what was reviewed (a likely V2)
- A completeness *gate* and risk tiers (own TN later — the event-log + tier substrate is what it builds on)
- An MCP adapter (deferred; the CLI is the portable integration)
- Multi-platform (GitLab, Bitbucket)
- Learning your preferences over time from review history
- A native desktop (Electron) shell — deferred behind the local-web build; see [ADR-0001](adr/0001-form-factor-local-web-first.md)

---

## Form Factor

**Decided ([ADR-0001](adr/0001-form-factor-local-web-first.md)): a local web app, Electron deferred.** In human-in-loop mode `present` boots a localhost server and opens the UI in an `--app`-mode window. All real work (git, atom hashing, open-in-editor) lives in the local server; the form factor is only the rendering shell, so a later Electron wrapper stays thin and additive. In autonomous mode there is no window at all — the agent works the verbs headless.

In-host MCP (inline HTML in Claude Code / Desktop) is rejected for the human surface: the dominant host is a terminal with no canvas, and a focused, keyboard-driven split-pane can't live in a borrowed panel. MCP may return later as an *adapter* over the same verbs. Voice is not built — speech→text is delegated to OS-level dictation.
