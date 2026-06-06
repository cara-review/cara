---
status: accepted
---

# Monaco as the diff-rendering surface

clear-diff's web adapter renders a Section's evidence with the **Monaco diff editor**, not
a bespoke DOM renderer. The core still owns mechanical truth and grouping; Monaco is a
client-side presentation library that renders git-verbatim text. Born from TN-26-015 (#27).

## Context

ADR-0001 fixed a local web-first form factor. TN-26-010 (#12) then shipped a hand-rolled
change-block/gap renderer and deferred syntax highlighting (#24), inline/side-by-side,
fold-unchanged, and comments. Those are table stakes for a review tool, and re-implementing
them is a large, ongoing cost.

The constraint that shaped this decision: a Section is a *curated, often cross-file subset*
of git's hunks, and within a file only that Section's hunks should read as changes — the
file's other changes (other Sections') must not appear as diffs. A turnkey "diff two whole
files" component does not express that directly.

## Decision

Use Monaco's diff editor in `apps/web`, one instance per file within the active Section,
stacked vertically. Shape the inputs rather than fight the renderer:

- **modified** = the real head file.
- **original** = head with only the active Section's hunks reverted to base, so only those
  hunks differ; everything else is identical and folds via `hideUnchangedRegions`.
- "Show all diffs in file" = supply the real base instead.

Marks, atom identity, grouping, navigation, and the WS boundary are unchanged. The
synthetic original is a per-frame render input — never persisted, never sent to the core.

## Considered options

- **Bespoke DOM renderer (status quo, #12)** — *rejected.* Full control, zero deps, tiny
  bundle. But every feature (highlighting, inline/SBS toggle, fold-unchanged, comment
  affordances, word-diff) is ours to build and maintain. Wrong investment for a tool whose
  job is pleasant review.
- **Monaco diff editor + synthetic-base inputs** — *chosen.* Gives highlighting, inline ↔
  side-by-side, fold-unchanged, view-zone comment anchors, and word-diff for free. The
  cross-file-Section / show-only-this-section requirement is met by shaping the buffers
  (revert only this Section's hunks), so Monaco's own fold collapses the rest. No fighting
  its (buggy) hide APIs. Validated by prototype.
- **Monaco's native multi-file diff (`createMultiFileDiffEditor`)** — *rejected.* Broken in
  the standalone npm package (internals tree-shaken away; open upstream bug). Not available.
- **CodeMirror merge view / diff2html / other turnkey diff viewers** — *rejected.* They own
  layout and alignment from a raw diff or two files, which fights the Section grouping the
  same way; we would re-derive our model on top of theirs.

## Consequences

- `apps/web` gains a `monaco-editor` dependency + worker wiring. Bundle/perf cost is
  accepted (local-first desktop tool; owner: not a concern). This narrows ADR-0001's
  implicit "keep the web payload light" lean (recorded here deliberately).
- The TN-26-010 rendering model is superseded; the rest of #12 (store, selectors,
  navigation, marks) stands. #24 is absorbed (highlighting is free; header Done-toggle
  folds in).
- Multi-instance is bounded by files-in-the-active-Section and recycled on switch — not the
  hundreds-of-instances failure mode that pushes teams off Monaco.
- Comments (#14) gain a natural home: Monaco **view zones** render an inline composer,
  anchored to the atom that owns the line. #14 keeps its own CommentSink-port ADR.
- Core invariants intact: ADR-0002/0004 (identity = content hash; marks canonical from the
  snapshot), the agent-untrusted rule (lines are git-verbatim; grouping only chooses which
  hunks to revert), ADR-0003 (web → backend over WS only).

## Open

- **`renderSideBySide` toggle relayout** — whether to live-toggle or recreate-on-toggle to
  avoid the known Monaco jitter; an implementation detail, settled in #27.
- **Base-side line numbers** on the synthetic original — map to real base numbers via the
  `lineNumbers` callback only if reviewers miss them; head side is always correct.
- **Theme integration** — drive Monaco's theme from the existing light/dark tokens.
