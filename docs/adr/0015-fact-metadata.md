---
status: accepted
relates: [0004, 0005, 0011, 0013]
---

# Fact metadata — descriptive, never gate-trusted

Owner greenlit building this in-session (Refs #47), reviewed alongside the code like ADR-0005 / ADR-0013. Realises the **fact metadata** fast-follow ([TN-26-031](../tn/TN-26-031-review-ledger-pivot.md), [TN-26-035](../tn/TN-26-035-ledger-gate-role-coverage.md)). Design: [TN-26-036](../tn/TN-26-036-repo-wide-coverage-and-fact-metadata.md).

## Problem

A review fact records *who* (channel-inferred tier + reviewer label) and *what* (atom hash, disposition, comment). It does not record *how* it was produced — which model, what thinking budget, which tool version. That context is valuable for audit ("which model swept this?") and for weighing an agent-role fact, but it is **self-reported by the agent** and so must never be trusted to move a gate.

## Decision

### 1. An optional `meta` on attributing events

`MarkedEvent`, `CommentedEvent`, and `AnsweredEvent` carry an optional `meta?: FactMeta`. The non-attributing markers (`completed`, `presented`, `reshape-requested`) do not — they assert no review act to describe.

```ts
/** Self-reported, descriptive provenance of a fact. Never gate-trusted. */
export type FactMeta = Readonly<Record<string, string>>;
```

A bounded string→string map, not a fixed schema: `model`, `thinking`, `tool`, `commit` … evolve without a domain change. Bounds (adapter boundary): ≤ 12 entries; keys a lowercase slug ≤ 40 chars; values ≤ 200 chars. Empty map ⇒ omit the field entirely (keeps the no-meta fact byte-identical to today — no dedupe churn for existing facts).

### 2. Descriptive only — structurally invisible to gating

`meta` is carried by the fold onto `MarkRecord.meta` and `Comment.meta` for display/audit, and surfaced on `dispatch`'s `CommentView`. It is **never** passed to `reviewProgress` / `repoProgress` / the gate predicate evaluator — those take only `(masterList, marks, comments)`, and the mark/comment role data excludes `meta`. So "never gate-trusted" holds by construction, not by policy: there is no code path from `meta` to a coverage number.

### 3. Channel-supplied, never forged

`meta` rides the existing provenance rule (ADR-0011 §5): the **agent** supplies it on a CLI `submit` (a batch-level `meta` object applied to every event in that batch). The **browser/human** channel sets no `meta` (a human mark has no model to report). `meta` cannot carry or override the author tier — tier stays channel-inferred; `meta` is opaque descriptive text beside it.

### 4. Part of the content-addressed fact

`meta` is inside the canonical fact, so it participates in `factId` (ADR-0005): two otherwise-identical marks with different `meta` are **distinct facts** (a re-review under a different model is genuinely a different fact). This is intended. The fold is last-write-wins by author as before; `meta` travels with the winning record.

## Consequences

- Audit gains "produced by `<model>`/`<thinking>`" per fact, for free, without touching the gate.
- One optional domain field (`MarkEvent` union) + boundary validation (`isMarkEvent`, `coerceBatch`) + fold carry. No port change, no new verb.
- **Untrusted overlay** (ADR-0004): `meta` is agent-self-reported, escaped on render like a comment body; a gate or readout must never present it as proof of anything. The trust gradient (ADR-0013 §Trust) is unchanged — `meta` describes a fact, it never elevates one.
- Re-review under a new model writes a new fact (no dedupe). Acceptable; the ledger is an append log.
