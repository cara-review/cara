---
number: 26-015
title: Monaco-based diff surface
kind: proposal
status: active
issue: "#27"
tags: [web, ui, diff, monaco, rendering, hexagonal]
---

# TN-26-015: Monaco-based diff surface

Replace the bespoke DOM diff renderer (#12 / TN-26-010) with the **Monaco diff editor**
as `apps/web`'s rendering surface. cara keeps owning the *reorganisation* (Chapters,
Sections, ordering) and the *checklist* (marks); Monaco owns *rendering the evidence*.

Proposed ADR-0006, now accepted. Implementation proceeds on #27.

## Why

TN-26-010 shipped a hand-rolled change-block/gap/change-block renderer and deliberately
deferred syntax highlighting (#24), inline/side-by-side toggle, fold-unchanged, and any
comment affordance. Monaco gives all of those for free. Maintaining a bespoke diff renderer
for a tool whose whole job is pleasant review is the wrong investment.

A throwaway prototype (`apps/web/prototype-monaco/`) validated the approach against the
real multi-file, multi-section case ("tests in the same file as the change"). Verdict:
the way forward.

## The model

One Section is shown at a time, as a **vertical stack of per-file Monaco diff editors**
(GitHub "Files changed" scroll). A Section spans files; each file shows **only this
Section's hunks as diffs**.

### Synthetic-base technique (the load-bearing idea)

Per file in the Section, feed Monaco two buffers:

- **modified** = the real head file (real head line numbers — what the reviewer reads).
- **original** = the head file with *only this Section's hunks reverted to their base
  text*. Every other change (other Sections' hunks) stays at head, so it is identical on
  both sides → Monaco treats it as **unchanged context** → `hideUnchangedRegions` folds it
  to a thin "N lines hidden" bar.

So we never fight Monaco's hide APIs; we shape the inputs so the irrelevant changes simply
*aren't* differences. "Show all diffs in this file" = feed the real base instead — one
flag, no special-casing.

Buffers are built from data we already have: the full head file (`readFile(path,"head")`)
plus each atom's base/head lines and position. No new wire data; confirm `readFile`
exposes the base side too (it should — the gap-expansion seam already reads a side).

### Behaviour

- Inline ↔ side-by-side via `renderSideBySide`, toggled live.
- `hideUnchangedRegions` collapses the rest of each file with peek-to-expand.
- **Debounced auto-height**: each editor sized to its (folded) content, no inner
  scrollbar, so the page scrolls as one. (The prototype's un-debounced refit is the source
  of its visible jitter — fixed here with an rAF-coalesced sizing pass.)
- Navigator (Chapters → Sections) drives which Section renders + carries tick-off.

## Architecture fit

`apps/web` only. **No core or port change.** Honours:

- **ADR-0002 / ADR-0004** — atom identity is a content hash; marks/counts stay canonical
  from the backend snapshot. Monaco rendering is presentation; it never defines the mark
  unit and never enters identity. The synthetic original is a *render input*, discarded
  per frame, never persisted, never sent to the core.
- **Agent-untrusted invariant** — every rendered line is git-verbatim head/base text. The
  agent's Section grouping only decides *which* hunks to revert, never the text. The
  untrusted Chapter/Section `summary` stays the labelled overlay, outside the editor.
- **ADR-0003** — web still reaches the backend over WS only; Monaco is a client-side lib.

The decision is "what renders a Section's evidence in the web adapter" — a presentation
choice, not a boundary move. It does not add a port or cross-boundary channel.

## Impact on `apps/web`

- **Add** `monaco-editor` dependency + Vite worker wiring (`MonacoEnvironment`).
- **Replace** `ui/diff-surface.ts` and most of `ui/diff-model.ts` (the change-block/gap
  renderer) with a Monaco surface + a buffer-builder (`syntheticBuffers(section, file)`).
- **Keep** `navigation.ts`, the store/selectors, `keyboard.ts`, the marks model, the nav
  tree — unchanged. The `[data-diff-surface]` mount stays the integration point.
- **Fold in** #24's header Done-toggle; #24's syntax highlighting becomes free.
- Pure, testable seam: `syntheticBuffers` (Section + file + atoms → {original, modified})
  is DOM-free and unit-tested under `node --test`. The Monaco glue stays thin/untested by
  node (no DOM in the runtime), as with the shell renderers.

## Risks / open

- **Auto-height jitter** — solved by debouncing the content-size refit; some Monaco
  relayout quirk on `renderSideBySide` toggle may remain (mitigate: recreate-on-toggle).
- **`hideUnchangedRegions` fold asymmetry** between sides — cosmetic; tune
  `contextLineCount` / `minimumLineCount`.
- **Synthetic-original left line numbers** are not real base numbers — map via Monaco's
  `lineNumbers` callback if base-side numbers matter; head side is always correct.
- **Bounded multi-instance** — N = files in the *active* Section (small), recycled on
  Section switch; far from the "hundreds of instances" failure mode. Bundle/perf cost
  accepted (owner: not a concern).
- **Renames / pure-add / pure-delete** need care in buffer construction (previousPath,
  empty base/head).
- **Comments (#14)** — Monaco view zones inject the inline composer; anchor to the atom
  owning the clicked head line (original side for removed lines). Validate view zones +
  diff editor + `hideUnchangedRegions` interplay there, not here.

## Supersedes / absorbs

- Supersedes the TN-26-010 rendering model; the rest of #12 (store, selectors,
  navigation, marks) stands.
- Absorbs **#24** (syntax highlighting + header Done-toggle).
- Comment-ready for **#14** (which keeps its own CommentSink-port ADR).

## Plan (post-approval, via `/do-work` on #27)

1. Add `monaco-editor` + Vite worker config; smoke a single diff editor in the shell.
2. `syntheticBuffers` pure module + tests (incl. rename / pure-add / pure-delete).
3. Stacked per-file surface with debounced auto-height + `hideUnchangedRegions`.
4. Inline/SBS + show-all-diffs toggles; wire the navigator + tick-off; header Done-toggle.
5. Delete the bespoke renderer + the `prototype-monaco/` folder; update the e2e suite
   (the #22 vocabulary/marking/persistence specs are the regression net).

## Decision

See **ADR-0006** — Monaco as the diff-rendering surface.
