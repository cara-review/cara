---
number: 26-033
title: AI review-gate market scan — is "gate that an agent reviewed my code" already solved?
kind: research
status: active
issue: "#47"
tags: [research, market-scan, gate, guardrail, ai-review, wedge, prior-art]
---

# TN-26-033: AI review-gate market scan

Companion to the [TN-26-032](TN-26-032-cara-prior-art-survey.md) prior-art survey, narrowed to
the **gate / guardrail wedge** that surfaced in field feedback: a former-CTO reviewer was cold
on the audit/ledger story but warm on *"the easiest way to ensure a certain type of agent
reviewed my changes, enforced in my existing workflow."* Before betting on that wedge, scan the
crowded AI-code-review market: is gated agent review already an easy solved problem with
someone else's tool?

> **Open-source lens.** clear-diff/CARA is an open standard with open tools; this scan reads the
> field as public prior art to credit and build on. Where a mechanism already exists (the IMTI
> hook, SLSA's re-review-on-change), say so plainly and define the delta — not a competitive
> moat, an honest position relative to work that's already public.

Method: seven fan-out web-research passes — AI-review tools (gate vs comment, three tool
groups), workflow-gating plumbing, and AI-agent-governance products.

## Verdict

**Findings-gating is crowded and mature; completeness/content-addressed/role/stale-on-change
gating is empty.** The wedge is real but **narrow and precise** — and it is *not* the loud part
of the market.

- The part easy to over-claim — *"an AI reviews your code and can block the merge"* — is **not
  special**. Many tools do it. Claiming that loses.
- The mechanism actually designed — gate on **`(reviewer role) × (exact per-hunk content) ×
  (stale-on-change) × (completeness)`** — returned **zero commercial hits** across five query
  angles. The negative repeated across angles is itself signal.

## The market splits in two — neither is CARA

1. **Findings / threshold gating** (CodeRabbit, Qodo, CodeAnt, Sourcery CLI, Bito…): block if
   the bot *found an issue above a threshold* or *flagged threads are unresolved*. The gate
   asserts "the bot ran / commented / no critical findings" — **never** "the required role
   reviewed every hunk." Running ≠ reviewing-completely.
2. **Human review standards** (SLSA Source L4 + VSA, Nov 2025; OpenSSF two-reviewer): gate on
   two-party review **tied to a revision**, with mandatory re-review on change. The closest
   conceptual cousin and **standards-blessed proof the "stale-on-change" instinct is sound** —
   but human-only, role-less, **revision-granular (not per-hunk)**, heavyweight to adopt.

## Tool-by-tool: does it gate, and on what?

| Tool | Gate or comment? | Gate asserts | Content-addressed / stale-on-change? |
|---|---|---|---|
| **GitHub Copilot review** | comment only — *structurally can't gate* (only "Comment" reviews, never approves, never blocks) | — | no |
| **CodeRabbit** | gates (required status check) | issues found / pre-merge checks | re-runs on push; no content-fingerprint |
| **Qodo** | gates (required pre-merge + Rules) | rule/finding violations | no |
| **CodeAnt** | gates — strongest of the set | **threshold compliance** (coverage, bugs, secrets) | no |
| **Sourcery** | gates via CLI (`review --check`, exit 1) — *the closest hook UX* | unresolved issues in the diff | `--diff` scopes lines; no completeness/staleness |
| **Bito** | gates via native "conversation resolution" | flagged threads resolved | no |
| **Baz** | soft gate — "Merge Blocker" threads | human-flagged threads resolved | no |
| **Graphite Agent / Ellipsis / Korbit** | comment only (deliberately advisory) | — | no |
| **Entelligence** | claims gating; primary-source mechanics thin | score/threshold | no |

Cross-cutting: **none ties the pass to a content hash of the changed lines; none verifies
hunk-level completeness; none goes stale when reviewed lines change.** "Re-run on push" is
re-execution, not staleness detection of a prior verified state.

## Closest prior art — the IMTI "Pre-Commit Review Gate"

[IMTI's hook](https://imti.co/pre-commit-review-gate/) is the single closest thing in existence
(commercial or hobbyist) and must be cited by name. It already has CARA's **defining move**:
content-pin a review verdict so it goes stale when the code changes.

- A Claude Code `PreToolUse(Bash)` hook.
- `SHA-256` of the **whole** cached diff (`git diff --cached HEAD; git diff`).
- Spawns one adversarial sub-agent → writes `.claude/.last-review.md` with `reviewed_hash`,
  `findings_count`, `verdict: CLEAN`.
- Any edit changes the hash → stale → re-review forced.

It validates the instinct (someone reached for the exact mechanic) but is the **minimum-viable
version**. Deltas, split honestly by whether a wedge buyer would feel them:

**Deltas that matter to the buyer:**
- **Roles.** IMTI = "a review happened." CARA = "the **security** role reviewed, **agent** tier"
  — literally the field-feedback ask ("a certain *type* of agent"). IMTI can't express it.
- **Per-hunk vs whole-diff.** IMTI's single blob-hash means *any* edit invalidates the *entire*
  review → re-review everything. Per-hunk atoms ([ADR-0002](../adr/0002-core-review-architecture.md))
  leave reviewed hunks undisturbed by unrelated edits; only touched hunks resurface. Matters on
  big/long-lived diffs; on tiny commits the buyer may not feel it.
- **Completeness vs trust-the-verdict.** IMTI pins "this diff → CLEAN," but CLEAN could be a
  skim — it trusts the sub-agent. The master-list bijection
  ([ADR-0004](../adr/0004-agent-untrusted-master-list.md)) proves *every hunk was accounted for*.
  For an agent reviewer (rubber-stamp risk), this is the central value-add.

**Deltas that probably only the project feels (for now):**
- Fail-closed / server-side enforceability (IMTI is local, advisory, agent-bypassable).
- Committed, signed, shareable ledger (IMTI's `.last-review.md` is local/ephemeral) — the audit
  story the field reviewer shrugged at.
- A **standard** many agents/tools write to and **compose** into one number; IMTI is one hook,
  one reviewer.

## Two structural findings that reshape the wedge

- **Shape is prior art; assertion is the empty space.** Sourcery already ships the
  CLI-in-a-pre-commit-hook gate UX (and has deprioritised it as "legacy"). So the *gate shape*
  (CLI, exit code blocks) is not novel. The *gate assertion* (per-hunk, role-attributed,
  complete, stale-on-change) is the only unoccupied ground. **Lead with the assertion, never the
  shape.**
- **Local hooks are bypassable by the very agents being gated** —
  [`--no-verify`/stash, claude-code#40117](https://github.com/anthropics/claude-code/issues/40117).
  A husky-hook gate is *advisory* exactly when an agent writes the code, so a credible gate must
  be **server-side / CI** (a required check), not only a local hook.

## The honest risk — buyer perception, not occupancy

The space is open; the danger is not "someone built it" but **"does a buyer feel the difference
between *the bot ran and found nothing* and *the required role covered every changed line and
the proof dies if you touch it*?"** Findings-gating (CodeAnt/CodeRabbit-as-required-check) is the
*good-enough* substitute a pragmatic dev reaches for first. The three deltas that justify CARA
existing over "just productise the IMTI hook" — **roles, per-hunk completeness, the standard** —
must visibly clear that bar; two of them are the buyer's own needs, not only the project's.

**Cheap validation before building:** stand up a findings-gating tool as a required check on a
real repo, observe exactly what it asserts vs skips, then re-pitch the specific delta and watch
whether the distinction lands or glazes.

## Implication for build order (carried into the architecture work)

- **Gate is the wedge; ledger is the exhaust.** Lead with the gate (the painkiller that fits an
  existing workflow with no behaviour change); have it write CARA facts as a by-product so the
  ledger accrues "for free" and the audit/compliance value compounds later for a different buyer.
- The wedge's critical-path features are **role/tier predicates** (already present,
  [ADR-0011 §6](../adr/0011-cli-agent-protocol.md)) and **per-hunk completeness** — *not*
  signing or repo-wide coverage. Sequence accordingly.

## Sources

AI-review tools: [Copilot review docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review) ·
[CodeRabbit pre-merge checks](https://docs.coderabbit.ai/pr-reviews/pre-merge-checks) ·
[Qodo governance](https://www.qodo.ai/resources/beyond-code-review-building-a-governance-layer-for-ai-generated-code/) ·
[CodeAnt quality gates](https://github.com/CodeAnt-AI/codeant-quality-gates) ·
[Sourcery pre-commit](https://docs.sourcery.ai/Guides/Getting-Started/Pre-Commit/) ·
[Bito request-changes](https://docs.bito.ai/ai-code-reviews-in-git/request-changes-comments) ·
[Baz](https://baz.co/) · [Graphite Diamond](https://graphite.com/docs/diamond) ·
[Ellipsis](https://docs.ellipsis.dev/features/code-review) · [Korbit](https://www.korbit.ai/).
Plumbing: [pre-commit.com](https://pre-commit.com) ·
[GitHub required-reviewer rule GA (teams-only)](https://github.blog/changelog/2026-02-17-required-reviewer-rule-is-now-generally-available/) ·
[bots can't be required approvers #167357](https://github.com/orgs/community/discussions/167357) ·
[palantir/policy-bot](https://github.com/palantir/policy-bot) ·
[Danger JS](https://danger.systems/js/reference).
Closest prior art: [IMTI Pre-Commit Review Gate](https://imti.co/pre-commit-review-gate/) ·
[agents bypass hooks, claude-code#40117](https://github.com/anthropics/claude-code/issues/40117).
Standards: [SLSA v1.2 Source Requirements](https://slsa.dev/spec/v1.2/source-requirements) ·
[OpenSSF two-reviewer best practice](https://best.openssf.org/SCM-BestPractices/gitlab/project/code_review_by_two_members_not_required.html).
Governance: [Qodo Rules System](https://www.helpnetsecurity.com/2026/02/18/qodo-rules-system-ai-governance/) ·
[Endor AI Code Governance](https://www.endorlabs.com/use-cases/ai-code-governance) ·
[GitHub "Agent PRs are everywhere"](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/).
