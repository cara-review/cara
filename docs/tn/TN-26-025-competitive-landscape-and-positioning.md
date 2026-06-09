---
number: 26-025
title: Competitive landscape and positioning — agent-grouped, completeness-gated diff review
kind: research
status: active
issue: "#46"
tags: [research, positioning, prior-art, mcp, completeness, atom-identity]
---

# TN-26-025: Competitive landscape and positioning

Landscape research for clear-diff's distinctive bets — **provable per-hunk completeness**, **content-hash payload marks decoupled from grouping** (ADR-0002/0005), and the **agent-untrusted master list** (ADR-0004). Born from the design discussion on an MCP-as-external-agent shape and interactive agentic diffing. Source of intent for "where clear-diff sits."

> Citations are vendor docs / repos / papers, read as primary sources. Benchmark catch-rates are vendor-run — directional, not ground truth. Absence-of-prior-art is a weaker claim than presence.

## The gap, stated up front

**No surveyed tool offers a structural completeness guarantee** (provably examines every changed hunk, with an auditable per-hunk reviewed state). Coverage is universally best-effort. The combination clear-diff targets (content-hash payload marks + mandatory hunk coverage + strict mechanical/semantic layer split) is **unclaimed**. Each ingredient exists somewhere; the composition does not.

## 1. Autonomous AI reviewers — all best-effort, none complete

LLM reviewers that ingest a diff and emit comments. Coverage is probabilistic, not provable; none keep a per-hunk reviewed ledger.

- **Cursor BugBot** — runs **8 parallel passes with randomized hunk order** + majority voting, *because* a single LLM pass under-attends to the middle of a long diff ("lost in the middle"). The clearest public evidence that single-pass LLM review skips parts — mitigated stochastically, not guaranteed. ([building-bugbot](https://cursor.com/blog/building-bugbot))
- **Qodo Merge / PR-Agent** — **PR-compression** deliberately ranks and *clips* diff content to one prompt; lower-ranked hunks get dropped on large PRs. Clearest "silently skips by design" case. ([qodo-merge-docs](https://qodo-merge-docs.qodo.ai/), [pr-agent](https://deepwiki.com/qodo-ai/pr-agent))
- **GitHub Copilot review** — only one that *transparently admits* incompleteness ("may exceed context window — reviews what it can and notes when it could not review all files") + documented file exclusions. ([docs](https://docs.github.com/en/copilot/concepts/agents/code-review))
- **CodeRabbit** — closest to coverage *tracking*: incremental re-review with persisted prior-findings state + per-file summaries. But tracks *findings/commits*, not line coverage, and skips file classes (lock/generated/minified) by default. ([auto-review docs](https://docs.coderabbit.ai/configuration/auto-review))
- **Greptile / Cubic / Bito / Ellipsis / Korbit / Graphite Diamond** — repo-graph or diff-centric LLM review, best-effort, no coverage ledger. Diamond is high-precision/low-recall (stays silent on most issues); Greptile highest measured recall ~82% (still ~18% missed). Graphite acquired by Cursor Dec 2025; Diamond + BugBot merging.

**Cross-cutting anchoring reality:** GitHub auto-marks *line-anchored* comments "outdated" when the line changes; *top-level* comments silently go stale. Most tools inherit this. The sophisticated approach (CodeRabbit) is finding-level continuity (auto-resolve fixed, re-emit unfixed), **not** content re-anchoring.

## 2. Deterministic / coverage + anchoring lineage — the half clear-diff lives in

- **Kenjutu** ([Yuki-bun/kenjutu](https://github.com/Yuki-bun/kenjutu)) — **the nearest neighbour.** "Track review progress hunk-by-hunk through history rewrites" (Jujutsu). Hunk-level marks, persisted as **git objects** (no DB), a **"remaining diff"** model (deliberately chosen over inter-diff/revision tracking). Key difference: anchors to **jj change-IDs**, jj-only — not a content hash of the hunk payload, not plain git. **Recommend a direct teardown.**
- **Reviewable.io** — coverage tracking keyed to **(file × revision)**, never *mandatory*. Ignores files reverted to base. Closest on the coverage axis but revision-keyed, not content-keyed. ([tracking changes](https://www.reviewable.io/blog/tracking-changes-in-a-code-review/))
- **Gerrit** — patch-set model; **ported comments** map unresolved comments onto the latest patchset via **diff-position porting**, not content identity. ([ported comments](https://www.gerritcodereview.com/2020-11-18-gerrit-news-jun-nov-2020.html))
- **Phabricator / Differential** — "ghost" inline comments ported forward; **deliberately over-ports** because "the algorithm cannot read the comment." Pure diff-heuristic, admits mis-placement. ([differential inlines](https://secure.phabricator.com/book/phabricator/article/differential_inlines/))
- **GitHub PRs** — per-*file* "viewed" checkbox (resets on file change); inline comments anchor to (commit, line) and go stale. The baseline failure mode clear-diff avoids.
- **git range-diff** — compares two patch series via a cost matrix over the "diff of diffs" + Jonker–Volgenant assignment; descends from **tbdiff** / `interdiff`. Matches *commits*, not a stable per-hunk identity. ([git-range-diff](https://git-scm.com/docs/git-range-diff))
- **Histogram diff** — empirically produces hunks better matching developer intent (Nugroho et al., *EMSE* 2020). Direct justification for `-U0 --histogram` → more stable hunk boundaries → more stable content hashes. ([Springer](https://link.springer.com/article/10.1007/s10664-019-09772-z))
- **Content-hash anchoring as a primitive** — independently converged on by AI-agent *edit* tools (per-line hash, reject on mismatch, no silent relocation), but for safe edits, not review-mark persistence.

## 3. MCP / agentic-loop primitives

- **MCP Apps (SEP-1865)** — the UI rail for "server renders a review UI, actions route back to the agent as tool calls." Anthropic's announcement uses **a diff viewer with hunk selection** as the flagship example. Proposal / early SDK (Nov 2025) — track it. ([SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp), [blog](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/))
- **Diffity** ([nilbuild/diffity](https://github.com/kamranahmedse/diffity)) — closest *shipped* loop: server runs git itself, human comments on the diff, `/diffity-resolve` makes the agent apply the changes. But flat diff view (no agent-supplied grouping); completeness is incidental, not enforced. Ships via Skills, not MCP.
- **GitHub MCP server** — canonical PR-review server: `pull_request_read` (get_diff), `pull_request_review_write`, pending-review comments. GitHub owns the canonical diff; agent reads + writes comments. No grouping returned to the server.
- **T3 Code #345** — *proposal* to expose open review comments + a resolve action over MCP so an external agent acts on human comments. Exactly the comments-out loop, unbuilt. ([#345](https://github.com/pingdotgg/t3code/issues/345))

## 4. Alibaba `open-code-review` (the flagged tool)

[alibaba/open-code-review](https://github.com/alibaba/open-code-review) (~5.7k★, Go CLI, "agent-native"). The closest **production** cousin to the hybrid thesis — explicit deterministic layer + LLM agent, switchable `--audience human/agent`, findings → host agent → optional fixes. Validates "trusted core + LLM agent split" at scale. But the resemblance is **shallow**:

- Deterministic layer works at **file** granularity and *filters/triages* files (deliberately drops some) — coverage-**reducing**, the opposite of a completeness invariant.
- Grouping is deterministic **file-bundling**, not agent-semantic.
- Comments anchor by **line number**, with an explicit `start==end==0` "failed to locate" sentinel — fragile against the regrouping clear-diff's atom-hash design survives.
- **No per-hunk review state**; stateless per run.

## Where clear-diff sits — the novel combination

| Dimension | State of the art | clear-diff |
|---|---|---|
| Completeness | Best-effort; none provable | **Provable per-hunk coverage as a hard gate** (ADR-0004 bijection) |
| Per-hunk review state | None (Kenjutu: hunk marks, but jj-only) | Marks on atoms, **content-hashed payload**, plain git |
| Comment anchoring | Line/position porting (stale or heuristic) | **Content hash** → regrouping free, unrelated edits don't disturb, reviewed-line edits resurface — by construction |
| Mechanical vs semantic | Conflated, or grouping is deterministic (OCR) | **Two layers never mixed** — git mechanical truth / agent disposable semantics |
| Agent trust | Agent trusted to cover the diff | **Agent untrusted over the master list** (ADR-0004) |

**Distinctive bets:** (a) payload content-hash identity on **git** — not VCS change-IDs (Kenjutu), diff-porting (Gerrit/Phabricator), or (commit,line) (GitHub); (b) **mandatory coverage + strict layer split**. Nearest neighbour is **Kenjutu**; nearest production cousin is **Alibaba OCR**; the UI rail is **MCP Apps**.

## Follow-ups

- **Kenjutu teardown** — its git-object mark persistence and "remaining diff" model are the closest design precedent.
- **Track MCP Apps (SEP-1865)** — the rail for an MCP-as-external-agent shape with a rendered human UI.
- Freedom-to-operate analysis (comment-drift patents) kept private — see `.agent-state/`, not this public TN.
