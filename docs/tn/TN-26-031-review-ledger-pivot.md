---
number: 26-031
title: Review-ledger pivot — review as a durable, role-attributed, gatable repo fact
kind: proposal
status: draft
issue: "#47"
tags: [pivot, review-ledger, attestation, coverage, gating, compliance, naming]
---

# TN-26-031: Review-ledger pivot

> **Draft / direction-setting.** Captures a product pivot crystallised in live field-testing
> and a human-review-proof research pass. Not yet a ratified plan; the ADR fallout below is
> the human gate. Supersedes the *headline* of the agent-reviewer framing — see Appendix A
> for what's demoted, dropped, or carried forward.

## Thesis

**Code review stops being an ephemeral act and becomes a durable, role-attributed, gatable
fact in the repository.** cara becomes the **review ledger**: a repo-resident,
content-pinned, signed-where-human, role-attributed audit log of every review act — that
cannot go stale, because it is keyed to the change itself.

The pivot is away from *competing on bug-finding* (the A/B experiments, TN-26-029, showed
freeform review matches or beats the scaffold at finding bugs) and toward the two things
cara structurally does that nothing else does:

1. **Human-ness is structural, not a checkbox.** A mark made through the human channel is
   unforgeable (channel-inferred tier, ADR-0011); signed, it is a person-level fact.
2. **The fact decays with the content.** Keyed to the atom payload hash (ADR-0002), a
   review fact evaporates the instant the code changes. Coverage is live and
   self-maintaining — it falls automatically as agents edit, rises only when a reviewer
   actually re-looks. A PR approval is a frozen lie the moment the next commit lands; this
   is not.

> **One-line framing:** "Approved" was a verb that vanished. This is a noun that stays.
> Test coverage made correctness-anxiety measurable; this makes *autonomy-anxiety*
> measurable — proof of who (or what role) attended to which exact code.

## The unifying axis: role, not human-vs-agent

The axis is **role**. Human is simply the one role that is cryptographically signed.
Every mark already carries `(tier: human | agent, reviewer: "security" | "architecture" |
…)` (ADR-0011). That pair *is* the product. Persist it to a signed repo ledger, aggregate
by role, gate on it.

A review fact:

```
{ atomHash, role, tier, attributor, signature?, scrutiny, ts }
```

- **role** — security / architecture / performance / domain / … (the reviewer label).
- **tier + signature** — `human` facts are signed with a person's key (offline-verifiable
  by recomputing the atom hash from the diff); `agent` facts are *attributed, not proven*.
- **scrutiny** — substance, not just presence (commented? ran a check? swept?) — see Risk 1.

**Trust gradient, stated plainly:** `signed-human > attributed-agent-role > unseen`. The
gate sets the bar per risk; agent-role never masquerades as equivalent to signed-human.

## Readouts

- **Per-PR** (mildly interesting): "100% security-reviewed, 100% architect-reviewed, 40%
  human-reviewed."
- **Per-repo** (the prize): "across main — 80% architectural review by agents, 10% human,
  100% security." A dark-matter map by role: for every line, which roles ever attended to
  the change that introduced it — human-reviewed / agent-role-reviewed / **never seen**. A
  number no one can produce today.
- **The gate replaces the marker-file hack.** Today review gates write a marker file ("an
  agent says it reviewed" — cara's own `.agent-state` approval marker and remit's
  review gate are both this hack). Replace with *the ledger is the gate*:
  `cara gate --require security=100%,architecture=100%,human-on-risky`. Content-pinned
  per role; cannot be stale; no honour system.

## Why this beats the narrower wedges

It has **both** a base and a premium, from one ledger:

- **Base (existing demand):** replace the review gate every serious team hacks today.
  Concrete, not founder-inferred — teams already do this, badly.
- **Premium (regulated demand):** the signed human-attention subset is the compliance
  artifact. Research confirms the gap is real: *signed commits prove who advanced a branch,
  not that a human read the content.* EU AI Act Art.14 binds 2026-08-02; DO-178C / IEC
  62304 / SOC2 require human review but accept only the discredited "approval click." A
  signed, content-pinned "a human attended to exactly this code" sits between
  worthless-"approved" and asserted-"audited".

It also turns the **multi-agent-review trend from threat into fuel**: those N role-agents
finally have a standard place to write their facts. The A/B finding ("agents aren't better
reviewers") stops mattering — the value was never bug-superiority; it is the recorded,
gatable fact that a security-role pass examined this exact content.

## Honest risks (both have answers we already shipped)

1. **Agent rubber-stamp.** "100% security-reviewed by an agent" rots into "approved" if the
   agent swept. Antidote: the **scrutiny breakdown** (0.5.2 / methodology v4) — a role-review
   with zero comments on risky atoms is a *sweep*. The ledger fact must record substance,
   not just "a security-labeled process touched it," or the metric inherits "approved"'s
   worthlessness one level down.
2. **Role-claim trust.** Any agent can pass `--reviewer security` — attribution, not proof.
   Only human is signed. The trust gradient above must be explicit in every readout and gate.
3. **The theatre ceiling.** It proves *attention, not comprehension* — a human can
   rubber-stamp through the browser. State it always; never add fake "engagement" proxies as
   proof. Audit regimes run on procedural evidence, and "attended to this exact content" is
   categorically stronger than anything they accept today.

## What changes structurally

- **Persistence pivot — the big one.** ADR-0005 (local, gitignored, per-context, isolated)
  → a **shared, committed, signed ledger** (`.cleardiff/` or git notes). Makes review state
  durable, portable, and social — needs a privacy/team-dynamics design (per-person activity
  becomes permanent record).
- **Signing.** Mark batch signed at "Done" with a person's key (the existing commit-signing
  pattern, applied to attestations). Offline-verifiable. Without this, "proof" is a lie.
- **Coverage semantics.** Per-diff coverage is easy and gateable now. Repo-wide needs
  line→introducing-hunk attribution via blame — ship per-diff first, map second.
- **`cara gate`** as a first-class verb (was deferred): role/tier/scrutiny predicates,
  exit code, CI integration.
- **Mode separation holds (field-test ruling):** the UI is exclusively the human's room —
  it is the *only* mint for signed human-review facts, which is what keeps the ledger
  credible. Agent review is headless, a separate ledger contributor, never blended into the
  browser uninvited.

## ADR fallout (human-gated — nothing built until ratified)

- **Rewrite ADR-0005** — persistence: local-isolated → shared-committed signed ledger;
  privacy model.
- **New ADR — the review fact + signing model** — fact schema, the trust gradient,
  human-key signing, offline verification, what an agent-role fact may and may not assert.
- **New ADR — coverage + gate semantics** — per-diff vs repo-wide, role/scrutiny predicates,
  the bijection as the denominator (its integrity *is* the metric's credibility).
- **Extend ADR-0012 / ADR-0011** — reviewer-label role taxonomy becomes load-bearing;
  scrutiny recorded in the fact.
- **Naming** — held open. "cara" describes the instrument, not the proof; the product
  is now a review-attestation/ledger. Name follows the settled thesis, not before it.

## Open questions

- Granularity of "reviewed": atom, or line-within-atom (line-pointer comments already exist)?
- What signs an agent-role fact — nothing (pure attribution), the CI identity, or a
  policy-scoped key? Determines how much weight a gate may place on it.
- Does repo-wide coverage need every historical commit re-attributed, or only forward from
  adoption (a "reviewed since" baseline)?
- Privacy: per-person review activity as a permanent committed record — opt-in scope, what's
  visible to whom.

---

## Appendix A — prior directions: carried, demoted, dropped

The pivot reorganises ~two weeks of design. Status of each prior thread against *this*
thesis:

**Carried forward (now load-bearing):**
- The engine — atoms, content-hash identity (ADR-0002), master list + bijection (ADR-0004).
  The denominator's integrity *is* the metric's credibility.
- Channel-inferred author tiers (ADR-0011) — the unforgeable human/agent boundary; the root
  of "human-ness is structural."
- The reviewer label (ADR-0011 §6) — promoted from minor feature to the central **role** axis.
- The scrutiny breakdown (0.5.2, dispositioned ≠ reviewed) — the antidote to rubber-stamp;
  becomes substance in the ledger fact.
- The human-exclusive UI ruling (field-test) — the UI is the sole mint for signed human facts.
- The four-verb CLI protocol, live-refresh, mandatory summaries, line-anchored comments,
  Reshape — the instrument that produces facts, unchanged.

**Demoted (context, not headline):**
- **Headless multi-reviewer** — no longer "cara finds bugs better." Now: a ledger
  contributor producing agent-role facts. Its bug-finding parity (TN-26-029) is irrelevant
  to the new value.
- **Methodology arms race (v3 seams, v4 deletion nudge)** — fine as-is; no longer the
  battleground. Good agent review raises *quality* of agent-role facts, not the product's core.

**Dropped as headline / deferred:**
- **"Human-review coverage %" as a standalone dashboard** — research: no expressed demand;
  the 2026 trend is routing *around* the human. Survives only as the *mechanism* under a
  required artifact (the gate / the regulated attestation), never sold as a discretionary
  dashboard.
- **Eval-harness ("cara as the measuring stick for reviewers")** — interesting, not
  the pivot. Parked.
- **Boundary lens (TN-26-030)** — stays deferred pending k≥3; orthogonal to the ledger.
- **Lens marketplace / RCR-as-open-standard / protocol-ownership (vision 5)** — the RCR +
  two-tier attestation thread is *promoted into* this pivot (the signed fact + export);
  the marketplace/standard ambitions are parked.

**Prior research that fed this (kept for the record):**
- A/B evaluation (TN-26-029): scaffold wins *accounting*, loses *bug-finding* → the moat is
  trusted accounting of attention, not reviewer quality. This pivot is the consequence.
- Human-review-proof research: the metric is a compliance/liability wedge, not a mass dev
  tool; lead with the regulated, signed attestation anchored to a requirement. The
  role-ledger framing (this TN) broadens that to a base + premium without losing the wedge.

## Appendix B — what to build first (sketch, pre-ratification)

Order, smallest credible slice first:
1. **Signed human fact + verify** — sign the mark batch at Done; a tiny verifier recomputes
   atom hashes from the diff and checks the signature. This is the irreducible core; without
   it "proof" is a lie.
2. **`cara gate`** over the existing (in-memory) marks — role/tier/scrutiny predicates,
   exit code. Proves the gate shape before the persistence rewrite.
3. **Committed ledger** (ADR-0005 rewrite) — move facts into the repo; per-diff coverage.
4. **Repo-wide map** — blame attribution; the dark-matter-by-role view.
