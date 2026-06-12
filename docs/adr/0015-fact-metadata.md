---
status: accepted
relates: [0004, 0005, 0011, 0013, 0014]
---

# Fact metadata — descriptive, never gate-trusted

Owner greenlit building this in-session (Refs #47), reviewed alongside the code like ADR-0005 / ADR-0013 (semantics open to revision on owner review). Realises the **fact metadata** fast-follow ([TN-26-031](../tn/TN-26-031-review-ledger-pivot.md), [TN-26-035](../tn/TN-26-035-ledger-gate-role-coverage.md)). Design: [TN-26-036](../tn/TN-26-036-repo-wide-coverage-and-fact-metadata.md).

## Problem

A review fact records *who* (channel-inferred tier + reviewer label) and *what* (atom hash, disposition, comment). It does not record *how* it was produced — which model, what thinking budget, which tool version. That is valuable for audit ("which model swept this?") and for weighing an agent-role fact, but it is **self-reported by the agent** and so must never move a gate.

## Decision

### 1. An optional `meta` on attributing events

`MarkedEvent`, `CommentedEvent`, and `AnsweredEvent` carry an optional `meta?: FactMeta`. The non-attributing markers (`completed`, `presented`, `reshape-requested`) do not — they assert no review act to describe.

```ts
/** Self-reported descriptive metadata of a fact (model, thinking-mode, tool …). Never gate-trusted. */
export type FactMeta = Readonly<Record<string, string>>;
```

A bounded string→string map, not a fixed schema: `model`, `thinking`, `tool`, … evolve without a domain change, and core never interprets it. It is distinct from a `Section`/`Chapter` `summary` (an AI prose overlay *about the change*): `meta` is structured key/values *about how a fact was produced*. The domain type is an unbounded `Readonly<Record<string,string>>`; all bounds are adapter input-hardening (§3), so core never knows the limits exist. Empty map ⇒ the field is omitted, keeping a no-meta fact byte-identical to today (no dedupe churn for existing facts).

### 2. Descriptive only — a *guarded* invariant, not just an omission

`meta` is carried by the fold onto `MarkRecord.meta` and `Comment.meta` for display/audit, and surfaced on `dispatch`'s `CommentView`. It is **never** passed to `reviewProgress` / `repoProgress` / the gate evaluator — those take only `(masterList, marks, comments)`, and the mark/comment role data excludes `meta`. So "never gate-trusted" holds by construction.

But construction-by-omission erodes one well-meaning commit later, so it is **guarded**, not merely true today:

- The gate predicate grammar (ADR-0013 §4) is **closed** over its role table; a `meta` key is **not** addressable as a predicate role. A regression test asserts that no `FactMeta` key can be named in `--require` (it resolves to a reviewer label that no fact carries → 0, never to `meta`).
- Any future predicate over `meta` (e.g. `--require model=opus`) requires a **new ADR** — it would move self-reported data onto the trust path, which this ADR forbids.
- Under repo-wide **existence** semantics (ADR-0014 §3) `meta`-distinct facts collapse to one bit per (atom hash, role) — existence already de-dupes — so `meta` can never inflate a coverage or scrutiny number even though it makes facts distinct at storage (§4). The distinctness is for audit, not counting.

### 3. Channel-supplied, validated, never forged

`meta` rides the provenance rule (ADR-0011 §5): the **agent** supplies it on a CLI `submit` (a batch-level `meta` applied to every event in that batch). The **browser/human** channel sets no `meta`. `meta` is opaque text *beside* the author tier — `isMarkEvent` / `coerceBatch` validate `author` **independently of `meta`**, so an agent can never smuggle or override the channel-inferred tier through it (tier stays `"human"|"agent"`, set by the channel).

Adapter bounds (`coerceBatch`, rejecting the batch otherwise): ≤ 12 entries; keys a lowercase slug ≤ 40 chars; values ≤ 200 chars of printable text (no control characters — values reach terminal/CI logs via `--by-file` and `dispatch`, so a control/ANSI sequence is a log-forging surface, CWE-150). `isMarkEvent` re-validates shape on read-back from the ledger.

### 4. Part of the content-addressed fact

`meta` is inside the canonical fact, so it participates in `factId` (ADR-0005): two otherwise-identical marks with different `meta` are **distinct facts** (a re-review under a different model is genuinely a different fact). The fold stays last-write-wins by author; `meta` travels with the winning record. Caveat (interacts with ADR-0014 cost): because `meta` ∈ `factId`, fact-count *per atom* is bounded by `meta` variety, not by review count — a loop varying one `meta` value mints a fresh blob each time, which `loadAll` then walks. Accepted for v1 (append-only log; the existence fold de-dupes the *count*), and pointed at ADR-0014's tip-keyed-snapshot mitigation for the walk cost.

## Consequences

- Audit gains "produced by `<model>`/`<thinking>`" per fact, for free, without touching the gate.
- One optional domain field (`MarkEvent` union) + boundary validation (`isMarkEvent`, `coerceBatch`) + fold carry + a regression test pinning the guard (§2). No port change, no new verb.
- **Untrusted overlay** (ADR-0004): `meta` is agent-self-reported, so on **every** surface — CLI readout, `--by-file` map, `dispatch` view, any audit export — both key and value are rendered escaped, control-char-stripped, and never interpreted as markup or used to drive an action. The trust gradient (ADR-0013 §Trust) is unchanged: `meta` describes a fact, it never elevates one.
- Re-review under a new model writes a new fact (no dedupe). Accepted (§4).
