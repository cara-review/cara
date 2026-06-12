---
number: 26-036
title: Repo-wide coverage + fact metadata — design and plan
kind: plan
status: active
issue: "#47"
tags: [cara, ledger, coverage, repo-wide, metadata, blame, role]
---

# TN-26-036: Repo-wide coverage + fact metadata

Owner directed (in-session, Refs #47): write the two remaining ledger ADRs "really properly", review
them, then build — owner reviews after. Both land on `feat/cara-ledger`, **never main**; review-gated.
Continues [TN-26-035](TN-26-035-ledger-gate-role-coverage.md) (the per-diff gate). Decisions:
[ADR-0014](../adr/0014-repo-wide-coverage.md) (repo-wide), [ADR-0015](../adr/0015-fact-metadata.md) (metadata).

## Two pieces

1. **Repo-wide coverage** ([ADR-0014](../adr/0014-repo-wide-coverage.md)) — the per-repo readout from
   [TN-26-031](TN-26-031-review-ledger-pivot.md): "across this range — 80% architecture, 100% security,
   40% human." Built on a **cross-context global fact index** (content-addressing makes an atom hash
   globally meaningful), measured over a baseline→target range's master list, with a per-file
   breakdown (the dark-matter map). Honours content-decay for free. Per-line whole-history attribution
   via `git blame` is **deferred** (see ADR-0014 §Alternatives) — the range model answers
   "reviewed-since-baseline", which is the TN's pragmatic resolution of the open question.

2. **Fact metadata** ([ADR-0015](../adr/0015-fact-metadata.md)) — optional descriptive `meta` on a fact
   (model, thinking-mode, tool version). **Never gate-trusted**: carried by the fold for display/audit,
   structurally invisible to coverage/gate. Bounded + validated at the adapter boundary; agent-supplied.

## Build order

ADR-0015 first (contained: one optional field + boundary validation). Then ADR-0014 (a port method,
a core existence-fold, a `gate --repo [--by-file]` mode). Each ADR lands with its code + tests, gate-green.

## Out of scope (still deferred)

Signing (the `Attestation` port); per-line blame attribution of pre-baseline history; auto-configured travel.
