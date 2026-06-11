---
number: 26-032
title: CARA prior-art survey — does a content-addressed review attestation already exist?
kind: research
status: active
issue: "#47"
tags: [research, prior-art, cara, attestation, ledger, standard, signing]
---

# TN-26-032: CARA prior-art survey

Feeds the [TN-26-031](TN-26-031-review-ledger-pivot.md) pivot. Before building the review
ledger as a standard ("CARA" — Content-Addressed Review Attestation), survey what exists:
can we ride an existing standard rather than reinvent? Six fan-out research passes —
attestation standards, git-native review tools, marker/anchor tooling, and the
compliance/regulated angle.

> **Framing.** CARA is an **open standard with open reference tools** (TN-26-031). This survey
> reads the field as a *commons to build on and contribute back to*, not a competitive
> landscape to beat — credit the prior art, adopt its primitives, and where a gap is genuinely
> open (e.g. in-toto #77), contribute the missing piece upstream rather than fork around it.

> **Verdict:** CARA's exact combination is **unoccupied**, but every *part* worth reusing
> already exists. We assemble proven primitives; we do not invent crypto, storage, or an
> envelope. The genuinely new contribution is **the atom-payload hash as the attestation
> subject + decay-on-content-change + the human/agent role tier + the coverage gate**.

## The field splits in two — CARA is in neither camp

Every existing review-state mechanism is one of:

1. **Position / revision anchoring** (GitHub, GitLab, Gerrit, Phabricator, Graphite,
   Reviewable) — marks key to line numbers, diff positions, or revision ids. On change the
   mark goes **"outdated"/hidden** or **resets per-patchset**. Never invalidates by content
   identity.
2. **Fuzzy / follow anchoring** (CodeStream, Hypothes.is, MSR/USPTO "robust anchoring"
   research) — marks deliberately **chase the edit to stay attached**. The explicit goal is
   *never go stale*.

**CARA inverts camp 2:** it *wants* the mark to die the instant the reviewed bytes change —
at hunk granularity, keyed to a content hash. That intent appears nowhere in the surveyed
field.

## What to ride (do not build)

| Need | Ride | Why |
|---|---|---|
| Signing envelope | **in-toto + DSSE** | Standard envelope for "signed statement about an artifact." CARA = a new *predicate type* inside it. |
| Human signing / transparency | **Sigstore / gitsign / Rekor** | Keyless signing, offline verify, transparency log. "Signed where human" maps straight onto it. |
| Storage in git | **git-appraise's `refs/notes/...` pattern** | Proven notes substrate: JSON-per-line, auto-merged via `cat_sort_uniq` so concurrent reviewers don't conflict. |
| The content hash | **`git patch-id`** | git already ships "SHA of the normalised diff, line-numbers stripped." Our atom hash is patch-id at hunk granularity — proof the approach is sound, possible building block. |

The scary parts (crypto, storage, envelope) are solved and adoptable. CARA writes **one
predicate schema + the keying rule + the gate logic.**

## Closest neighbours (know these cold)

| System | What it nails | Why it isn't CARA |
|---|---|---|
| **crev / cargo-crev** | signed, content-digest reviews **that decay** | whole-**crate** granularity, dependency-trust not change-gate; no attestation-standard footing |
| **Radicle (Heartwood)** | strongest signing — Ed25519/DID per change + signed refs | anti-stale by **wholesale per-revision reset** (untouched files too); revision-OID-keyed, not hunk-content-keyed |
| **kenjutu** | right granularity — **hunk-level**, survives rebase, decays | tiny/experimental, jj-only, unsigned, single-user |
| **SLSA Source Track v1.2 (VSA)** | signed + revision-bound two-person review | attests *"branch required 2 reviewers,"* not *"a human attended to this hunk"*; **review predicate explicitly left undefined** |
| **in-toto issue #77** | proposes a human-review predicate | **open, stalled since 2021**; literally names "reviews for diffs and how they chain" as unsolved — a gap CARA could fill |
| **Gerrit `copyCondition`** | keeps a +2 if the diff is unchanged | per-patchset diff-*equality*, **includes context lines** (CARA excludes them); not a persistent per-hunk hash |
| **GitHub per-file "Viewed"** | the one mainstream **decay-on-content** mechanic | whole-file, ephemeral, per-user, no hash; wrongly resets untouched files (community #86527) |

Adjacent prior art to build on and distinguish from: **IETF
`draft-morrison-identity-attributed-commits`** (May 2026) — tier-structured signed trailers,
signs the *tree hash not commit id* to survive rebase. Same instincts (tiers +
sign-content-not-id) but for **authorship, not review**; a natural ally to cite, not a rival.

## Property matrix

| Property | git-appraise | Gerrit | trailers/DCO | Radicle | crev | kenjutu | CARA |
|---|---|---|---|---|---|---|---|
| Stored in git | ✅ notes | ✅ NoteDb | ✅ commit msg | ✅ COBs | ✅ proof repos | ✅ git objects | ✅ |
| **Content-addressed (hunk payload)** | ❌ commit+line | ❌ change-id | ❌ commit | ❌ revision OID | ~ crate digest | ✅ hunk | ✅ |
| Signed | ✅ GPG (opt) | ❌ | ❌ | ✅ Ed25519 | ✅ | ❌ | ✅ (human) |
| Role / tier | ❌ | ~ labels | ~ trailer-key | ~ delegate | ~ WoT | ❌ | ✅ |
| **Decays on content change** | ❌ orphans | ❌ anti-decay | ❌ | ~ by revision | ~ by crate | ✅ | ✅ |
| Coverage gate | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Maintained | dormant | active | universal | active | active | experimental | — |

No row but CARA's combines content-keyed-to-hunk **+** signed **+** role-tiered **+**
decays **+** gated.

## Compliance angle — the "frozen lie" thesis holds

- **EU AI Act Art.14** (binding 2026-08-02) creates the demand but specifies **no evidence
  format**; tooling responding to it (Augment "Intent", MintMCP) emits *"who clicked accept"*
  logs — not signed content-addressed proof.
- **DO-178C / IEC 62304** — review evidence is **document-and-process**; re-review on change
  is a human obligation, not a property of the artifact. No cryptographic/content-addressed
  approach exists.
- **SOC2** — accepts exactly the PR-approval-click; GitHub's only mitigation is blunt
  wholesale stale-dismissal.
- **OpenSSF Scorecard "Code-Review"** — counts approval events; never inspects *what* was
  reviewed. Confirms the status quo CARA rejects.

"A signed review fact bound to the exact change that expires when that change does" is, per
this survey, currently true of nothing shipped.

## Positioning (as an open standard)

- **Build on SLSA + Sigstore** ("the primitives are accepted") → then describe what's new. Do
  **not** claim "no one signs code" — they do (provenance/authorship); the new part is *review
  semantics + payload-decay*.
- **Biggest opportunity: in-toto #77.** Contribute `cara.review/v1` upstream as the
  human-review predicate — joining an existing standards body and envelope and helping close a
  four-year-open issue, rather than forking a parallel standard around it.
- **Storage substrate is settled prior art:** adopt git-appraise's `refs/notes/...` pattern +
  JSON-per-line + `cat_sort_uniq` (Apache-2.0, credit it). Distinguish from Gerrit's Change-Id
  (anti-decay) and GitHub line-anchoring (decays by accident) — different goals, not rivals.

## Sources

in-toto: [attestation framework](https://github.com/in-toto/attestation) ·
[issue #77 human-review predicate](https://github.com/in-toto/attestation/issues/77) ·
[SLSA v1.2 Source Requirements](https://slsa.dev/spec/v1.2/source-requirements) ·
[SLSA VSA](https://slsa.dev/spec/v0.1/verification_summary).
Sigstore: [gitsign](https://github.com/sigstore/gitsign) ·
[gitsign predicate proposal #105](https://github.com/sigstore/gitsign/issues/105).
git-native: [git-appraise](https://github.com/google/git-appraise) ·
[Gerrit NoteDb](https://gerrit-review.googlesource.com/Documentation/note-db.html) ·
[Gerrit copyCondition](https://gerrit-review.googlesource.com/Documentation/config-labels.html) ·
[Radicle Heartwood](https://github.com/radicle-dev/heartwood) ·
[git-bug](https://github.com/git-bug/git-bug) ·
[kenjutu](https://github.com/Yuki-bun/kenjutu) ·
[git patch-id](https://git-scm.com/docs/git-patch-id).
content-decay reviews: [crev / cargo-crev](https://github.com/crev-dev/cargo-crev).
anchoring: [Reviewable change-tracking](https://www.reviewable.io/blog/tracking-changes-in-a-code-review/) ·
[GitHub reviewing changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request) ·
[Hypothes.is fuzzy anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/) ·
[diff-cover](https://github.com/Bachmann1234/diff_cover).
compliance: [EU AI Act Art.14](https://artificialintelligenceact.eu/article/14/) ·
[OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md).
authorship: [draft-morrison-identity-attributed-commits-01](https://datatracker.ietf.org/doc/html/draft-morrison-identity-attributed-commits-01).
