---
number: 26-018
title: Diff-surface toggles — split/unified and show-all-diffs
kind: plan
status: active
issue: "#16, #28"
tags: [web, monaco, diff-surface, toggles, ui]
---

# TN-26-018: Diff-surface toggles — split/unified and show-all-diffs

Add the two diff-surface toolbar controls #27 left as seams: split↔unified (#16) and
show-all-diffs-in-file (#28). Both flip an existing `SurfaceOptions` flag the Monaco surface
already honours — no new ports, no core change, no ADR. UI-only.

## Finding: the seams already exist

`DiffSurface` (apps/web/src/ui/diff-surface.ts) already carries both flags and renders them:

- `SurfaceOptions.renderSideBySide` → Monaco `renderSideBySide` (inline vs side-by-side).
- `SurfaceOptions.showAllDiffs` → swaps the per-Section synthetic original for `readFile(path,"base")`
  (the whole file's real base), per ADR-0006.
- `renderKeyFor` includes both flags, so flipping either rebuilds the stack correctly.

What's missing is purely the user-facing controls + persistence. This issue adds them.

## Scope

1. **Toolbar** — the surface renders a control bar above the file stack with two toggle buttons:
   - "Side by side" (#16) — flips `renderSideBySide`. Default off → unified/inline (per #16).
   - "All file changes" (#28) — flips `showAllDiffs`. Default off → only this Section's hunks.
   Buttons reflect state via `aria-pressed` + an `--on` class, matching `.file__done`.
2. **Keyboard** (#16) — `v` toggles side-by-side, routed through the hot-path handler to the
   surface (`toggleSideBySide`). #28 is button-only per the issue.
3. **Persistence** — both prefs saved to `localStorage` and restored on surface creation.

## Design

- Surface owns `options`, persistence, and the toolbar. Internal `setOption(patch)` mutates,
  saves, re-renders. Public interface gains `toggleSideBySide()` (the keyboard seam) and drops
  the now-internal `setOptions` — nothing external called it.
- `installKeyboard(store, surface)` gains the surface so `v` can call `toggleSideBySide()`.
  `keyToAction` maps `v`/`V` → `"split"`. main.ts edit is one argument.

## Boundaries

Pure UI. No domain/port/ADR impact. The agent-untrusted invariant is untouched: `showAllDiffs`
only chooses which base text to diff against (git-verbatim either way); no line is agent-authored.
