---
status: accepted
---

# Agent layer: untrusted, with a canonical master atom list

The LLM that groups atoms into Chapters and Sections is the only port whose output can't
be trusted. A reviewer must never approve a diff where a change was silently hidden or
altered, so the agent may *arrange* and *describe* the review but never *define* or *change*
what's in it. This is a security invariant, not a quality one.

## Master list is canonical

- The domain computes the atom set straight from the diff (`DiffSource → RawHunks →
  Atoms`), deterministically, with **zero agent involvement**. That set is the **master
  list** — the complete surface area of the change.
- **Counts and completion derive from the master list, never the grouping.** "412 atoms,
  38 unaddressed" comes from the canonical set, so a grouping cannot make the change look
  smaller than it is.
- `ReviewStore` never holds the atom set, only dispositions keyed by hash. The set is
  recomputed live every run, so stored state cannot hide an atom either.

## Agent output is an untrusted overlay

- `AgentPort.proposeGrouping(atoms, instructions) → ProposedGrouping`: chapter/section
  **titles, ordering, atom-id membership, and optional descriptive summaries**. The agent
  describes and arranges; it never returns, restates, or edits the diff itself.
- **Summaries are an explicitly untrusted overlay.** The agent may describe a Chapter or
  Section in prose, shown *over* the evidence ("AI summary — take with a pinch of salt"),
  never substituting for it and never authoritative. Orienting the reviewer is part of the
  point; the diff stays the source of truth.
- **The diff is never agent-touched.** The agent is handed atom ids and returns ids +
  titles + summaries, so it has no channel to alter a single line. Rendered evidence always
  comes from git via `DiffSource` / `WorkspaceReader`, verbatim.
- The domain enforces a **bijection**: union of all sections equals the master list,
  exactly.
  - atoms the agent never placed → swept into a trailing **"Other changes"** section, git
    order
  - references to atoms that don't exist → dropped
  - ordering invariants re-applied
- The agent cannot add, remove, hide, or omit an atom. Structural, not policy.

## Repair, don't retry

Invalid grouping is **repaired deterministically**, not rejected and re-prompted. The
atoms-in-git-order floor (ADR-0002) already guarantees a usable review with zero
intelligent grouping, so a botched response degrades to "git order, weak chapters" — never
broken, never partial. Retry-loops burn tokens and latency chasing a cleanliness we don't
need.

## Skip is not delete

A skipped atom stays in the master list and is always re-revealable. Only the user
collapses visibility, and only from the default flow. Nothing removes an atom.

## Consequences

- `AgentPort` output is treated as the most untrusted boundary in the system: `unknown` +
  validate, the same discipline as any external input.
- **Summaries are untrusted text:** escape on render, never interpret as HTML/markup, never
  let them drive an action — display only.
- A `FakeAgent` returning fixed groupings makes the whole pipeline testable offline.
- Grouping is disposable: cached by master-set hash, regenerated when the set changes
  (ADR-0003), marks unaffected.
