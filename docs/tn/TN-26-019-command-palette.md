---
number: 26-019
title: Web — ⌘K command palette
kind: plan
status: active
issue: "#13"
tags: [web, ui, keyboard, palette]
---

# TN-26-019: ⌘K command palette

`apps/web` only. A keyboard-driven overlay over the actions the review loop already
exposes, opened with `⌘K`, fuzzy-filtered, `Escape` to close. Pure UI — no store,
protocol, port, or backend change. Honours ADR-0003/0004 (web reaches the backend over
WS only; agent-supplied Chapter/Section titles are untrusted text, escaped by
`dom.el`). Vocabulary: only **Chapters** and **Sections** (never "atom").

## Scope — only wired actions

The palette is a *view over existing actions*; it never invents behaviour. Commands map
1:1 onto already-wired `controller`/`store` calls:

- **Next / Previous section** — `moveFocus` (hint `j` / `k`)
- **Mark section done** — `markSectionDone` (hint `d`)
- **Skip section** — `skipSection` (hint `s`)
- **Jump to <Chapter › Section>** — one dynamic command per Section → `focusSection`

Actions named in the issue but not yet wired (comment, open-in-editor, switch source,
toggle panes, Go) are out of scope here — each gains a palette command when its feature
lands (#14/#16/#17). No fake commands.

The static commands appear only while a review is active (`snapshot !== null`).

## Design

New, self-contained `apps/web/src/ui/command-palette.ts`:

- `Command { id, title, hint?, run() }` — `run` closes over `store`/`controller`.
- `buildCommands(state, store): Command[]` — pure builder (static + per-Section jumps).
- `fuzzyScore(query, text): number | null` — case-insensitive subsequence match with a
  contiguity/start bonus; `null` = no match.
- `filterCommands(commands, query): Command[]` — score, drop misses, stable sort by score.
- `createCommandPalette(store)` — owns one overlay appended to `document.body` (hidden by
  default); returns `{ open, close, toggle }`. On open it rebuilds commands from
  `store.getState()`, focuses the input, resets query/selection. `ArrowUp/Down` move the
  selection, `Enter` runs it, `Escape` / backdrop-click close.

Wiring:

- `keyboard.ts` — `installKeyboard(store, palette)`: handle `⌘K` (toggle) **before** the
  existing chord guard. The hot-path keys stay suppressed while the palette is open
  because focus is in its `<input>` (existing `isTextEntry` guard) — arrows included.
- `main.ts` — construct the palette and pass it to `installKeyboard` (minimal edit to the
  shared composition root).

Styling: a `.palette*` block in `styles.css` using existing tokens (overlay, `kbd`,
`--accent`, radii). Reuses the `kbd` element style for hints.

## Tests

`command-palette.test.ts` (node:test): `fuzzyScore` (match/miss/ordering),
`filterCommands` (filter + ranking + empty query passthrough), and `buildCommands`
(static command set gated on snapshot; one jump command per Section with correct titles).
DOM controller verified live in the real app.
