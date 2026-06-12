---
tn: TN-26-012
title: Real Claude (Sonnet) AgentPort adapter
kind: plan
status: superseded
superseded-by: 26-026
issue: 18
---

# Real Claude (Sonnet) AgentPort adapter

> **Superseded by [TN-26-026](TN-26-026-cli-agent-protocol-pivot.md) / [ADR-0011](../adr/0011-cli-agent-protocol.md).** The pivot drops `AgentPort` as a driven port (ADR-0003 amended) — the core is now LLM-free and grouping arrives *inbound* over the CLI. The Anthropic adapter is deleted from the core; the single LLM moves *outside* the boundary to the `cara review` porcelain.

Implement the real `AgentPort` using the Anthropic SDK + Claude Sonnet, alongside the
existing `FakeAgent`. The agent proposes a grouping overlay over git's atoms; it never
authors diff content (ADR-0004).

## Boundary

`AgentPort.proposeGrouping(request) → unknown` is the one untrusted port. The adapter:

- builds a forced tool-use request whose tool schema returns the proposal overlay
  `{ chapters: [{ title, summary?, sections: [{ title, summary?, atomHashes: string[] }] }] }`;
- returns the tool input **verbatim as `unknown`** — it does **not** call `repairGrouping`.
  `ReviewService.open` already feeds the proposal through `repairGrouping`, which owns the
  ADR-0004 bijection (every master-list atom placed exactly once; garbage degrades to a
  trailing "Other changes"). Repair, don't retry — no retry loops.

The Sonnet response shape (content blocks, tool_use) stays behind the port; the domain only
ever sees `unknown`. No adapter-concept leakage.

## Decisions

- **Model** `claude-sonnet-4-6` (owner-requested Sonnet; confirmed current via the `claude-api`
  skill).
- **Forced structured output** via `tool_choice: { type: "tool", name: "propose_grouping" }`.
  No extended/adaptive thinking (incompatible with a forced single tool, and unneeded — the
  proposal is untrusted and repaired downstream).
- **Key handling** — `new Anthropic()` reads `ANTHROPIC_API_KEY` from the environment. No
  hardcoded key, no committed key, no path to any external tool/config. Public OSS.
- **Instructions** — `request.instructions.personal` / `.project` (the #26 seam) fold into the
  user prompt so project guidance is applied *before* grouping.
- **Composition root** — `compose.ts` selects `AnthropicAgent` when `ANTHROPIC_API_KEY` is set,
  else falls back to `FakeAgent`. A `config.agent` override still wins (tests).
- **Progress streaming** during grouping is deferred to the tRPC subscription channel (#23).
  A synchronous `proposeGrouping` that returns when grouping completes is sufficient now.

## Tests

Mock the SDK client (inject a stub `messages.create`) — no live API calls in the suite, no key.
Assert: request shape (model, forced tool, atoms + instructions rendered into the prompt),
response parsing returns the tool input, `repairGrouping` accepts the output, and the
empty-response path degrades safely.
