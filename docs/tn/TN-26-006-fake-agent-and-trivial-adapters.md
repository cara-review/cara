---
number: 26-006
title: FakeAgent and trivial driven adapters
kind: plan
status: active
issue: "#8"
tags: [node, adapters, fake-agent, hexagonal]
---

# TN-26-006: FakeAgent and trivial driven adapters

Wave 2, parallel-safe. `packages/node` only: the first driven adapters behind the core ports (ADR-0003). No core changes; these implement seams already frozen by TN-26-003.

The headline is **FakeAgent**: a deterministic `AgentPort` so the whole pipeline runs offline, before any real LLM (ADR-0004). The rest are trivial adapters for the non-git, non-store ports.

## Leakage rule (CLAUDE.md › Architecture policy)

Adapter specifics (child-process spawning, env var names, home-dir lookup, the agent's proposal JSON shape) stay in `packages/node`. The core sees only domain-neutral port types. FakeAgent's proposal is returned as the port's `unknown`; core's `repairGrouping` owns coercion. No new core types.

## Module layout (`packages/node/src`)

```
fake-agent.ts    FakeAgent: deterministic grouping over the real atom set (untrusted overlay)
clock.ts         SystemClock + fixedClock(ms) for tests
editor.ts        SpawnEditor + editorArgs (pure); spawns AppConfig.editorCommand
config.ts        EnvConfig: AppConfig from process.env
instructions.ts  FileInstructions: ~/.cara.md + repo cara.md
index.ts         barrel — additive re-exports (keep existing wiring probe)
```

## FakeAgent (ADR-0004)

- `proposeGrouping(request) → Promise<unknown>`. Deterministic: same atom set ⇒ identical proposal.
- Strategy: one chapter (`"Changes"`), one section per file `path`, sections ordered by first
  appearance of the path in `request.atoms`, `atomHashes` in git order. Section title = path.
- Returns the untrusted overlay shape `repairGrouping` targets:
  `{ chapters: [{ title, sections: [{ title, atomHashes }] }] }`, typed `unknown` at the seam.
- The diff is never echoed — only ids + titles (the agent has no channel to the lines, ADR-0004).

## Trivial adapters

- **`SystemClock`** — `now()` = `Date.now()`. `fixedClock(ms)` for deterministic tests.
- **`SpawnEditor`** — `open(path, line)` spawns `editorCommand` detached. `editorArgs(command, path, line)`
  is a pure helper: `code`-family → `["--goto", "path:line"]`; others (e.g. `zed`) → `["path:line"]`.
  Spawn fn is injectable so `open` is testable without launching an editor.
- **`EnvConfig`** — `load()` reads `editorCommand` from `CARA_EDITOR` (null when unset). `env`
  injectable for tests. File-based config is deferred until `AppConfig` grows beyond one field.
- **`FileInstructions`** — `load()` reads personal `~/.cara.md` and project `cara.md`,
  each `null` when absent. Home and repo dirs injected at construction (testable against temp dirs).

## Tests (`node --test`)

- FakeAgent: determinism (same atoms ⇒ deep-equal proposal); core's `repairGrouping` accepts the
  output and the bijection holds (every master atom placed exactly once, no "Other changes" leftover).
- `editorArgs`: code vs zed forms. `SpawnEditor.open`: injected spawn captures command + args.
- `EnvConfig`: env present / absent. `SystemClock`/`fixedClock`. `FileInstructions`: present / absent files.

## Out of scope

Real Anthropic adapter, `DiffSource`/`WorkspaceReader` (git), `ReviewStore`, `ReviewService`,
HTTP/WS server, composition root wiring. Separate tickets.
