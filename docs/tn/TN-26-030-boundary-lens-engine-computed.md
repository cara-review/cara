---
number: 26-030
title: Engine-computed boundary lens — a deterministic between-atom view for the seams pass
kind: proposal
status: draft
issue: "#47"
tags: [proposal, methodology, evaluation, completeness, seams, architecture]
---

# TN-26-030: Engine-computed boundary lens

> **PROPOSAL — DECISION DEFERRED.** Recommends an approach; **does not ratify one**. The
> gating evidence (k≥3 variance runs) is not yet in. n=2, a 2-bug recall gap that sits inside
> plausible single-run variance — not enough to act on. This TN exists so the idea is
> **specified and ready** the moment the data lands. It introduces **no** port, schema, or
> boundary change; any of those would need a human-approved ADR first (CLAUDE.md › Architecture
> policy).

Hardens the v3 free-text seams pass ([`methodology.ts`](../../packages/core/src/methodology.ts),
`METHODOLOGY_VERSION` 3) from a prose instruction into an **engine-computed mechanism**: a
deterministic, path-based view that groups atoms by the boundary they cross, so the reviewer
is pointed *at the seam* instead of asked to remember to look for it.

## Evidence — two rounds, honestly limited

Two evaluation rounds, both small, both pointing at the same structural hole.

**Round 1 — dogfood A/B ([TN-26-029](TN-26-029-ab-eval-scaffolded-vs-freeform.md), n=1).**
Scaffolded review proved 269/269 coverage but lost the *outcome* axis: 8 real issues to
freeform's 13, and missed the only crash-level bug (B1) — which spanned three files and lived
in no single hunk. **Every one of freeform's 6 unique catches was either cross-file or about an
absence** (no timeout, no `line` validation, no max on a field). The per-atom sweep is
hunk-blind by construction. That round motivated the v3 seams pass (a mandatory Stage 2 tracing
interactions / propagations / symmetric surfaces / absences).

**Round 2 — seeded ground truth (seeded ground truth, n=1).** Owner's external harness, 12
known-planted bugs, run *after* the v3 seams pass landed:

| Bug class | Scaffolded | Freeform |
|---|---|---|
| Recall, overall | **6/12** | **8/12** |
| Cross-file (caller↔callee) | 3/3 | 3/3 |
| Architecture / dependency-direction | **0/3** | 0/3 |
| Pure absence | **0/2** | **0/2** |

The v3 prose seams pass **closed the cross-file class** (3/3 — the thing round 1 exposed) but
left two classes untouched for the scaffold: **architecture / dependency-direction** crossings
(a cross-crate type leak, a serde type reaching into the domain, an illegal dependency edge) and
**pure absences** (missed by *both* arms). These are precisely the **between-atom** defects a
per-hunk march is structurally worst at — they are not *in* a hunk, they are in the *relationship*
between hunks in different modules.

**Limits — read honestly.**
- **n=2.** Two single runs. The 6-vs-8 recall gap is a 2-bug delta, well inside plausible
  single-run variance — **not** a distribution.
- **Seeded, not wild.** Round 2's bugs were planted; planted bugs may not mirror the shape or
  density of real ones.
- **Different diffs, different harnesses.** Round 1 was a self-referential dogfood diff scored by
  a non-blind judge; round 2 a seeded harness. Cross-round numbers are directional, not commensurable.
- The seams pass is **young** — round 2 is its first measurement. Its prose may simply need
  sharpening; an engine mechanism is one hypothesis among others.

## Diagnosis

Prose can *ask* a reviewer to trace dependency-direction crossings; it cannot *show* them where
the crossings are. The agent must reconstruct the module graph from raw paths in its head,
mid-sweep — exactly the reconstruction the per-hunk loop biases it away from. The cross-file
class closed because a changed caller and changed callee are easy to pair by symbol; the
architecture class stayed open because "is this dependency edge legal?" needs the *partition*
(which module owns which atom, which edges the change introduces) made explicit first.

The engine already owns that partition. It runs git, owns every atom's **path**, and is the
**trusted, LLM-free** layer (ADR-0004). It can derive — deterministically, with zero agent
involvement — which boundary each atom sits behind and which crossings the change as a whole
introduces. That derivation belongs on the **mechanical layer** (git-stable, like the
git-order floor), never the semantic one.

## Proposal — an engine-computed boundary lens

A second deterministic arrangement of the master list, alongside the existing git-order floor:
group atoms by the **boundary** they touch (which modules a change spans together), and surface
that grouping as a **first-class lens** the seams pass consumes.

- **Shape (sketch).** `atoms --by-boundary` (or a lens the methodology directs the agent to
  request) returns the same master-list atoms, partitioned by module and annotated with the set
  of **crossings the change introduces** — pairs of modules a single coherent change touches at
  once. For each crossing it poses one concrete question: *"this change couples module X and
  module Y — is that dependency direction legal?"*
- **Where the derivation lives.** Entirely in the **trusted core**, path-based, zero LLM. It is
  a pure function over `(atom path) → boundary`, the same family as git-order: deterministic,
  recomputed live, never persisted, never agent-authored. Marks are untouched — they stay
  block-level on atoms by content hash (ADR-0002).
- **How it composes.** It does **not** replace the per-atom sweep or the agent's semantic
  Chapters/Sections. It is a *lens* — a view the Stage-2 seams pass opens to drive the
  dependency-direction and absence hunts the prose currently leaves to memory. The methodology
  text (versioned, not an ADR) would point Stage 2 at it.
- **Why it fits the model.** A boundary view is a **mechanical** grouping (deterministic,
  path-derived), so it sits cleanly on the git side of the two-layers-never-mixed rule — like
  the git-order floor, just ordered by boundary-crossed instead of diff position. No bijection
  concern: it partitions the master list, hides nothing, adds nothing.

## What it does NOT do

- **No new port.** Boundary derivation is a function over paths the core already holds — not a
  driven dependency. Adding a port (e.g. a `ModuleLayout` source) would need a human-approved
  ADR first; this proposal does **not** assume one.
- **No semantic authoring by the engine.** The lens *partitions and asks*; it never judges
  whether a crossing is legal — that verdict stays the reviewer's (human or agent). The engine
  stays LLM-free (ADR-0004 / 0011).
- **No master-list or bijection change.** Same atoms, same counts, same content-hash marks. A
  lens is a view, not a regrouping the bijection must repair (ADR-0004).
- **No adapter-concept leak — the open question.** "Which crate / package / module" is a
  build-system concept. A path-prefix partition the core derives is path-based and arguably
  domain-neutral; but whether the *partition scheme itself* belongs in the domain or behind a
  boundary-map seam is a real ADR-0003/0004 question (CLAUDE.md › no adapter-concept leakage —
  the architect treats a leak as a layer breach). **That question is the human gate** and must
  be answered *before* any implementation — not coded around.

## Decision — DEFERRED, pending k≥3 variance

- **Gate:** at least three independent seeded-harness runs (k≥3), so the architecture/absence
  miss rate can be told apart from single-run noise. Today's 0/3 and 0/2 are n=2 single
  observations.
- **If the gap holds across k≥3** (scaffold persistently blind to the between-atom classes), this
  lens — or its disproof — is the response, opened with an ADR for the boundary-derivation
  question above.
- **If it collapses into variance**, the seams-pass prose is sufficient and this TN is filed as
  explored-and-rejected.
- Until then the agent **stops** at the architectural question and waits (CLAUDE.md › Ship
  policy). This TN is the readiness, not the trigger.
