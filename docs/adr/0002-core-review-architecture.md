---
status: accepted
---

# Core review architecture: two layers, atom identity by content hash

The review model (`Review → Chapters → Sections → atoms`) is specified in
[`docs/concept.md`](../concept.md). This ADR records the load-bearing architectural
decision under it and the alternatives rejected.

## Context

Two hard requirements drive the architecture:

1. **Navigable structure** — coarse-to-fine, important-first, related change grouped
   together even when git scatters it through a file.
2. **Marks survive revision** — a user marks a Section reviewed; the author pushes more
   commits; approved work must stay marked and only genuinely-changed parts resurface.
   Git has no native "same semantic unit across two diff versions", so identity is ours
   to build.

Marking by line number breaks on any upstream shift. Marking by the agent's grouping
breaks because the agent regroups non-deterministically between runs.

## Decision

**Two strictly separated layers.**

- **Mechanical (git — stable):** atoms = git hunks from `git diff -U0 --histogram -M`.
  `-U0` makes git split the change into fine contiguous line-runs (no agent line-drawing),
  `--histogram` gives stable boundaries, `-M` detects renames.
- **Semantic (agent — disposable):** Chapters and Sections are groupings over atoms,
  regrouped and reordered freely each run.

**Identity and marks live on the mechanical layer only.** An atom's identity is a content
hash of its payload (added/removed lines, normalised, context excluded) plus a rename-aware
path. Marks (`done` / `skipped`) key off that hash — never line numbers, never the agent's
grouping.

**Ordering:** Chapters by importance, Sections by relevance, atoms always in git order.

## Consequences

- **Free reappear-on-change** — editing reviewed lines changes the payload → new hash →
  atom resurfaces. Not built; falls out of the hash.
- **Free regrouping** — identity is on atoms, so the agent can reorganise the semantic
  layer between runs without losing a mark.
- **Unrelated edits don't disturb marks**; **renames survive** via `-M`.
- **Merge/split resurfaces** — when atoms merge or split across revisions the new payload
  matches no prior hash, so they resurface. Accepted as correct (something there changed);
  identity is best-effort, not perfect tracking.
- **Leans on agent grouping quality** — the atoms-in-git-order floor is the only guarantee
  a poor grouping never feels fully random.
- **Non-contiguous file rendering** — a file may appear in several Sections; the diff view
  renders *atom, gap, atom* and never assumes one continuous file.
- Requires a **marks store** keyed by atom hash, persisted per repo across sessions.

## Alternatives rejected

- **Agent-drawn line ranges as atoms** — non-deterministic boundaries destroy stable
  identity.
- **Identity by line number / position** — breaks on any upstream shift.
- **Identity by the agent's grouping** — regrouping loses marks.
- **Default-context (`-U3`) hunks** — coarser atoms force sub-hunk splitting; `-U0` lets
  git split deterministically.
- **Depend on `git range-diff`** — not adopted, noted as prior art; the content hash is a
  lighter equivalent of its cross-version hunk matching.
