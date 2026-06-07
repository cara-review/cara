---
status: accepted
---

# CDR-0001: Bun is the toolchain — runtime, test runner, package manager, bundler

Background: [TN-26-017](../tn/TN-26-017-bun-trpc-toolchain-transport.md); ratified alongside [ADR-0008](../adr/0008-bun-trpc-transport-and-type-only-contract-imports.md). Owner-approved in #23. The first Convention Decision Record.

Bun is a **convention**, not an architectural boundary — it changes how the project is run, tested, and built, never the hexagon (ADR-0003). It is recorded here so the choice is explicit and contributors install it.

## Decision

- **Runtime:** Bun executes TypeScript natively. The `clear-diff` bin is `#!/usr/bin/env bun`.
- **Tests:** `bun test` replaces `node:test`. Specs import `test` from `bun:test`; assertions stay on `node:assert/strict` (Bun implements it). Discovery is scoped to `packages apps` so the Playwright e2e specs are not picked up.
- **Package manager:** `bun install` with `bun.lock`. `package-lock.json` and npm are dropped.
- **Bundler / dev server:** the Bun bundler builds `apps/web` from an HTML entrypoint; Vite is dropped. Monaco workers are built as separate entrypoints (Bun does not auto-bundle `new Worker(new URL(...))`) and resolved relative to the loaded bundle.
- **Quality gate:** the `pre-push` hook runs `bun run lint`, `bun run test`, and `bun run test:e2e` (`bun --bun playwright test`, so the suite's in-process Bun.serve boot runs on Bun).
- **Dropped dependencies:** `ws`, Vite, npm.

## Consequences

- One runtime end to end: native TS exec, no separate transpile/test/bundle toolchains.
- Bun is a hard toolchain dependency; contributors install it (`curl -fsSL https://bun.sh/install | bash`, then inspect — never pipe to a shell blind).
- The Playwright runner is invoked via `bun --bun` so its workers (which boot the backend in-process) run on Bun.

## Rejected

- **Keep npm + node:test + Vite** — three toolchains where one suffices; #23 chose full-Bun.
- **Bun runtime but Vite bundler** — two bundlers is needless surface (ADR-0008).
