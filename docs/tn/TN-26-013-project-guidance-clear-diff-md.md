---
number: 26-013
title: Project guidance — CARA.md → InstructionsSource → AgentPort
kind: plan
status: superseded
superseded-by: 26-026
issue: "#26"
tags: [guidance, instructions, hexagonal, docs]
---

# TN-26-013: Project guidance — CARA.md → InstructionsSource → AgentPort

> **Superseded by [TN-26-026](TN-26-026-cli-agent-protocol-pivot.md) / [ADR-0011](../adr/0011-cli-agent-protocol.md).** The guidance layer survives, but two facts here are now stale: the file is **`CARA.md`** (project root) + **`~/.cara/CARA.md`** (personal); and it no longer feeds `AgentPort` (gone) — it is merged into the methodology the engine emits on the **`atoms`** verb. Read this for the layered-guidance intent only.

Wire the project-guidance layer end-to-end and author the repo's own guidance file, so the grouping agent takes project guidance into account *before* grouping (concept.md: `~/.cara/CARA.md` personal + `CARA.md` project).

## Finding: the pipeline is already built and tested

The ports + types + wiring landed with #5/#7/#8. No new port, no new types, no ADR. The chain, verified:

- `ReviewInstructions { personal: string | null; project: string | null }` — core/ports.ts.
- `GroupingRequest { atoms; instructions: ReviewInstructions }` — core/ports.ts.
- `InstructionsSource.load(): Promise<ReviewInstructions>` — core/ports.ts (the guidance port).
- `ReviewService.open` calls `instructions.load()` and forwards the result into `proposeGrouping({ atoms, instructions })` — review-service.ts.
- `FileInstructions` reads `~/.cara/CARA.md` (personal) + repo `CARA.md` (project), null when absent — node/instructions.ts.
- `compose` wires `new FileInstructions(homedir(), cwd)` into the service — node/server/compose.ts.
- Tests: `FileInstructions` present/absent (node/instructions.test.ts); `open` forwards loaded instructions to the agent via spy (review-service.test.ts:171).

The adapter-concept boundary holds: the filename and filesystem reads live behind `InstructionsSource`; the domain sees only domain-neutral `personal`/`project` markdown strings.

## Scope of this issue

1. **Author repo-root `CARA.md`** — the *project* layer of guidance for reviewing cara itself. The one genuinely-missing artefact. Streamlined per the doc convention.
2. **Verify** the chain above is connected (done — no code change).
3. **Consumption is #18's** — ninja-18's real Claude AgentPort folds `request.instructions.personal`/`.project` into the grouping prompt. Coordinated: the `GroupingRequest.instructions` seam is frozen, shared, not redefined.

## CARA.md content

Steers grouping/chaptering for this repo. Concise markdown, no fixed schema (free-text, like CLAUDE.md). Covers:

- Architecture is load-bearing: flag hexagonal layer violations and **adapter-concept leakage** into the domain as top-priority chapters.
- The two-layers-never-mixed rule (mechanical git atoms vs disposable semantic grouping).
- The agent-untrusted master-list invariant (ADR-0004).
- Prioritise core domain + port changes; relegate test/fixture/doc churn.
- Honour the vocabulary: Chapters/Sections; never surface "atom"/"hunk" to users.

## Out of scope

Personal `~/.cara/CARA.md` (per-user, uncommitted). Prompt construction (#18).

---

*2026-06-14 — name sweep: `clear-diff` → `cara`, rewritten for consistency. The pre-rename name survives in git history.*
