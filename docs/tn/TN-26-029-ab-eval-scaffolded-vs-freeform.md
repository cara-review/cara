---
number: 26-029
title: A/B evaluation — scaffolded (cara) vs freeform review (first eval datapoint)
kind: research
status: active
issue: "#47"
tags: [research, evaluation, completeness, methodology, eval-harness]
---

# TN-26-029: A/B evaluation — scaffolded vs freeform review

First datapoint for the eval-harness vision (vision 2 / SYNTHESIS): use the engine's own master list as the measuring stick to score *any* reviewer's coverage, and pit the cara scaffold against freeform review on the same diff. Tests the prior-art claims of [TN-26-025](TN-26-025-competitive-landscape-and-positioning.md): that single-pass LLM review skips parts of a diff and self-reports unverifiable coverage.

> n=1, single diff, same-day single model, self-review dogfood, judge not blind. Directional, not conclusive. See **Limits**.

## The experiment

- **Diff under test:** `origin/main..HEAD` of cara itself — the 0.5.0 polish pass ([ADR-0012](../adr/0012-field-test-amendments.md) field-test amendments). 12 commits, 62 files, +3141/−219, **269 atoms**.
- **Controlled variable — only one:** the cara scaffold. Same model both arms, same two lenses (ARCHITECTURE + SECURITY), same lens instructions, sequential, mutually blind, uncapped budget.
  - **Arm A (scaffolded):** drove the cara verbs — `atoms` → per-atom sweep → mark each `done`/`commented` → gap report. 127.8k sub-agent tokens, 30 tool uses.
  - **Arm B (freeform):** same model, same lenses, read the raw diff and wrote a prose report. No engine, no accounting. 142.8k tokens, 24 tool uses.
- **Measuring stick (the eval-harness pattern):** the judge mapped every Arm-B finding back onto the engine's 269-atom master list and measured *evidence-backed coverage* — which atoms each arm actually demonstrated it examined. Arm A's coverage is engine-measured (the gap report); Arm B's is reconstructed from its prose against the same master list. Every finding in both arms was judge-verified against the actual code.

## Results

| Axis | Arm A (scaffolded) | Arm B (freeform) |
|---|---|---|
| Coverage — proven | **269/269 (100%)** via gap report | n/a (no accounting) |
| Coverage — self-claimed | n/a (engine-measured) | 95% ("line by line") |
| Coverage — evidence-backed | 100% | **12% strict** / **38% lenient** |
| Distinct real issues | 8 | **13** |
| False positives / fabrications | 0 / 0 | 0 / 0 |
| Unique catches | 1 (weakest in union) | **6 (incl. the most severe)** |
| P1-class misses | **missed B1, area marked "clean"** | none |
| Location accuracy (5 spot-checks) | **5/5 resolve** (±0–11 lines) | 2/5 exact, **3/5 fabricated line numbers** |
| Severity self-labels | 0 P1 / 2 P2 / 8 P3 | 0 P1 / 4 P2 / 9 P3 |

- **Evidence-backed coverage, Arm B:** *strict* = atoms inside a finding-cited region; *lenient* = any atom in a cited file. 166/269 atoms (62%) show zero evidence of examination — including the diff's single biggest production file (`review-service.ts`, 23 atoms), only vaguely gestured at in B's closing summary.
- **Fabricated locations, Arm B:** L749 / L1089 / L564 cited in files of 324 / 253 / 136 lines. Symbol names correct, line numbers invented — they "resolve" only because the symbols are right.

### Finding union (judge-verified)

- **Shared, both arms, all real (7):** unbounded `comment.line.text` (the one field that escaped the CWE-770 caps); CLI `coerceBatch` silently drops the port's `line` pointer; `reshape` mutation ignores `input.context`; removed-side line pointers resolve to old-file numbers the UI anchors in the head editor; `runPresent` clears a pending reshape before the handoff is known to succeed; summary-gate retry resends a byte-identical request discarding `error.missing`; composer/reshape dialogs dismiss before the mutation settles, losing human text against the new caps.
- **Arm B unique, all real (6):**
  1. **B1 (the headline, P1-boundary):** the git-order **floor grouping is rejected by the live-server handover**. `buildGrouping` presents the floor with `requireSummaries: false`; `showGrouping` hands the same summary-less grouping to a live server whose `reshape` mutation hard-codes `requireSummaries: true` → `SummariesRequiredError` → masked to "Internal error." → handover rejects. Violates ADR-0012's "the floor is never rejected" guarantee on two reachable paths. **Spans `review.ts` ↔ `router.ts` — lives in no single hunk.**
  2. `SummariesRequiredError extends Error`, not `UserFacingError` — the one rejection the handover backstops is undiagnosable.
  3. `handReshapeToServer` has no timeout — a wedged-but-alive server (passes `kill(pid,0)`) blocks `present` forever.
  4. Store guard `case "commented"` validates atomHash/body/author but ignores `line` — malformed persisted pointers pass the type guard.
  5. Header meter fills on `addressed` while label and Done gate on `accounted` — two completion semantics in one control.
  6. Reshape note spliced unfenced into the LLM system prompt (defence-in-depth; self-flagged as not-a-vuln).
- **Arm A unique (1):** the reshape "human-only by channel" docstring overstates a convention as a structural guarantee. Real, but the weakest finding in the union.

## Two headline findings

### 1. TN-26-025's pathologies are empirically confirmed — unscaffolded review is un-gateable

Arm B exhibited exactly the failure modes [TN-26-025](TN-26-025-competitive-landscape-and-positioning.md) attributes to best-effort LLM review:

- **Phantom coverage claims.** "95%, line by line" against verifiable evidence for only 12–38% of atoms. A confident, unfalsifiable coverage claim — the precise pathology the completeness gate exists to kill. It is irrefutable for the same reason TN-26-025 §1 gives for every best-effort reviewer: the LLM that reviewed is its own coverage auditor (circular; vision 2 / SYNTHESIS).
- **Fabricated locations.** 3 of 5 spot-checked findings cite impossible line numbers. Right symbol, invented coordinate — decaying pointers, the anchoring failure mode of every position-keyed tool (TN-26-025 cross-cutting).

The scaffold removes both by construction: Arm A's 100% is the machine-checked gap report, not a claim; its findings exist as content-addressed comments in the event log (`accounted: 269`) with real atom coordinates, surviving regrouping. **This is the eval-harness thesis demonstrated once: the engine's accounting makes one reviewer's coverage provable and exposes the other's as unverifiable.**

### 2. The per-atom sweep is hunk-blind — the arms fail on *orthogonal* axes

The scaffold won the process axes (provable coverage, durable findings, accurate locations, zero unverifiable claims) and **lost the outcome axis decisively**: B found 13 real issues to A's 8, including the only crash-level bug — which A not only missed but **explicitly blessed**. A's clean-areas list says the reshape handover "re-validates the untrusted grouping (repair + summary gate backstop)" — it saw the exact mechanism of B1 and called it a feature.

The cause is structural, not effort: **every one of B's 6 unique catches is either cross-file (B1 spans three files) or about an *absence*** (no timeout, no `line` validation, no max on a field) — things that don't live inside any single hunk. A's loop (take atom → judge atom → mark done) biases toward per-hunk reasoning and spent its budget achieving breadth across 269 atoms (incl. ~100 test/doc atoms). The marginal token in A went to *accounting*; in B it went to *following a seam*.

**Completeness of accounting ≠ completeness of scrutiny.** The gap report guarantees no atom is *skipped*; nothing yet guarantees an *interaction* is *examined*. That is the measurable hole this datapoint exposes.

## Consequences

1. **Methodology v3 — a mandatory cross-cutting "seams" pass** (issue #47, task #22; `METHODOLOGY_VERSION` 2 → 3). After the per-atom sweep, every reviewer must trace interactions between changed areas (caller↔callee across files, handoffs/contracts between components, symmetric surfaces where one side changed) and hunt absences (missing validation / bounds / timeout / cleanup / error path). Each seam finding anchors as a comment on the nearest relevant atom, so the engine's accounting still holds — nothing escapes the ledger. The scaffold should **compose with**, not replace, a freeform-style seams pass.
2. **The engine's accounting as the measuring stick for *any* reviewer.** This experiment used the master list to score a reviewer that never touched the engine (Arm B). That generalises: the eval harness maps an arbitrary reviewer's findings onto the 269-atom ground truth and measures evidence-backed coverage. The accounting is a *coverage oracle*, not just a gate.

## Limits — read honestly

- **n=1.** One diff, one comparison. No claim about distributions.
- **Dogfood diff.** The diff under test is cara's own polish pass — atypically self-referential (the reviewer reasons about the very mechanisms it runs on). May inflate or distort both arms.
- **Same-day single model.** Both arms ran the same model on the same day. No cross-model or temporal variance captured.
- **Judge not blind.** The judge knew which arm was which and verified findings against code it could read. Verification is checkable, but selection/framing bias is not excluded.
- **Coverage metric is reconstructed for Arm B.** Strict/lenient evidence-backed coverage is inferred from prose, not measured by an instrument — a generous reading of B could move 12% upward, but not to the claimed 95%.

One datapoint, pointed two ways: it confirms the scaffold delivers what TN-26-025 says no competitor can (provable, falsifiable coverage), and it exposes that provable accounting is blind to the cross-cutting seam — the next thing the methodology and the eval harness must measure.

## Artifacts

Ephemeral, outside the repo (`~/dev/clear-diff-tmp/ab-test/`): `comparison.md` (judge), `arm-a-report.md` + `arm-a-dispatch.json` (10 comments, `accounted: 269`), `arm-b-report.md` (13 findings, 95% self-assessment), `master-atoms.json` (269-atom master list). Key evidence inlined above; the TN stands alone.
