---
number: 26-010
title: Web — diff surface, marking, keyboard navigation
kind: plan
status: active
issue: "#12"
tags: [web, ui, diff, marking, keyboard, hexagonal]
---

# TN-26-010: Web diff surface + marking + keyboard navigation

Wave 5. `apps/web` only. The core review loop on top of the #11 shell: render the
focused Section's evidence, mark it (block-by-block or whole-Section), and fly the
structure by keyboard. Builds on the shell's `AppStore`, `selectors`, `protocol`,
`dom.el`, `glyph`, and the stable `[data-diff-surface]` mount exposed as `view.mount`.
Does not touch the store, the WS client, or the nav tree's render.

Honours ADR-0003 (web reaches the backend over WS only), ADR-0002/0004 (atom identity
is a content hash; counts/marks are canonical from the backend snapshot; Chapter/Section
`summary` is the untrusted overlay). Vocabulary: only **Chapters**, **Sections**,
**change-block**/**block**, **Reviewed** ever surface — never "atom"/"hunk".

## Rendering model

The focused Section's `atoms` are git-verbatim `lines` (added/removed, `-U0`, no context).
Render as **change-block / gap / change-block** across files:

- Group the Section's atoms into **file groups** by consecutive path (a file may recur in
  later Sections — that revisiting is intentional). Never assume one continuous file.
- Each **block** = one atom's `lines`, with per-line numbers derived by walking the hunk
  (`oldStart`/`newStart`): removed lines advance the old counter, added the new.
- Between two blocks of the same file, a **gap** affordance ("Expand N hidden lines")
  fetches the elided head-side context via `store.readFile(path, "head")` and inlines it.
  Hidden count + head range are computed from the atoms' line spans.
- `+`/`-` is the non-colour cue; add/remove also carry semantic colour. **No strikethrough**
  on removed lines.
- Each block carries its own **Reviewed** control — the block's mark ("Mark reviewed" /
  "Reviewed"); each file group's header opens the real file at that line via
  `store.openInEditor`.

Syntax highlighting is **deferred** (flagged): diff lines are isolated `-U0` fragments
with no surrounding context, so a real highlighter degrades badly until gap-expansion
brings file context, and bundling one is out of scope for the runnable skeleton. Code is
rendered through a single `renderCode(text)` seam a highlighter can later replace. The
required non-colour add/remove cue ships now.

## Marking

Marks are per-atom (ADR-0004); there is no Section-level mark on the wire. So:

- **Block tick** — toggles its atom: `store.mark(hash, "done")` / `store.unmark(hash)`.
- **Whole-Section Done (`D`)** — marks every atom in the Section `done` (sequential, to
  avoid out-of-order snapshot overwrites), then auto-advances.
- **Skip (`S`)** — marks every atom `skipped`, then auto-advances. Skip ≠ delete; skipped
  Sections stay re-revealable (nav de-emphasises them).
- **Auto-complete + auto-advance** — after any mark, if the Section's `sectionRollup`
  state is no longer `unreviewed`, focus moves to the next unreviewed Section. The
  block-by-block path and the whole-Section key feed the same canonical state; the header
  and nav counts (from the snapshot) reflect it.

Two visible controls back the keys: a **Skip** and an accent **Done & Next** action bar at
the foot of the surface (the sticky section header stays the shell's — not edited here).
Both use the tick (✓) glyph, never an arrow.

## Keyboard + focus

A single `document` keydown listener:

- `j` / `ArrowDown` → next Section, `k` / `ArrowUp` → prev Section (flat order across
  Chapters, clamped — no wrap).
- `d`/`D` → Done & advance, `s`/`S` → Skip & advance.
- Suppressed while focus is in an `input`/`textarea`/contentEditable; ignored with
  meta/ctrl/alt held (those stay for palette/chords, later).

Focus is the store's `activeSection` — moving it drives both nav highlight (shell) and the
diff (here); the shell's nav click already drives it the other way, so the two panes stay
coupled. Moving focus into a collapsed Chapter expands it (set active + expand if collapsed
— never collapse). The existing `:focus-visible` ring + `.section--active` accent are the
always-visible indicator.

## Module layout (`apps/web/src`) — all new except `main.ts`

```
navigation.ts        pure: flatten Sections, next/prev Section, nextUnreviewedSection, sectionAt
ui/diff-model.ts     pure: Section → file groups + blocks + gap ranges; numberedLines(atom)
ui/keyboard.ts       pure keyToAction(key); installKeyboard(store) keydown wiring + suppression
ui/controller.ts     focusSection / advance / markSectionDone / skipSection / toggleBlock (store glue)
ui/diff-surface.ts   DOM renderer: file groups, blocks, gaps (expand via readFile), ticks, action bar
ui/diff-surface.css  styles for the surface (consumes the shell's design tokens)
main.ts              + wire createDiffSurface(view.mount, store) and installKeyboard(store)
```

Pure modules (`navigation`, `diff-model`, `keyboard` mapping) are DOM-free and unit-tested
under `node --test` (the established pattern). The DOM renderer + controller glue are thin
and untested by node (no DOM in the test runtime), as with the shell's render functions.

Only `main.ts` of the shell's files is edited (two wiring lines it already anticipates);
styles live in a separate `diff-surface.css` so the shell's `styles.css` is untouched —
both minimise rebase conflict when #11 lands on `main`.

## Tests

- `navigation.test.ts` — next/prev clamp at ends; nextUnreviewedSection skips done/skipped,
  wraps, returns null when all reviewed.
- `ui/diff-model.test.ts` — groups by consecutive file; gap hidden-count + head range;
  numberedLines numbers added/removed by side.
- `ui/keyboard.test.ts` — key→action mapping (incl. arrows + upper/lower case), null for
  unbound keys.

No git/child-process spin-up — tests stay pure (no `GIT_*` concern).

## Out of scope (later issues)

Syntax highlighting (seam left), command palette (`⌘K`), comment composer + line comments,
chat messaging, split/side-by-side mode, pane resize/collapse, the Go dispatch flow.
