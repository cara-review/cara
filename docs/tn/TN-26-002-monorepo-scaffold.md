---
number: 26-002
title: Monorepo scaffold and strict TypeScript toolchain
kind: plan
status: active
issue: "#4"
tags: [tooling, monorepo, typescript]
---

# TN-26-002: Monorepo scaffold and strict TypeScript toolchain

Wave 0. The workspace skeleton everything else builds on. Scaffold + stubs that typecheck + a passing smoke test. No domain logic (owned by ADR-0002 work).

## Layout (per ADR-0003)

```
package.json            # root: npm workspaces, devDeps, scripts
tsconfig.base.json      # shared strict compilerOptions
eslint.config.js        # flat config, no-any enforced
packages/core/          # @clear-diff/core — pure, zero runtime deps
packages/node/          # @clear-diff/node — depends on core
apps/web/               # @clear-diff/web — Vite UI
```

- Workspaces: `["packages/*", "apps/*"]`.
- **Dependency direction** (ADR-0003): `node` declares `@clear-diff/core` as a dependency; `core` declares none; `apps/web` reaches `node` only over HTTP/WS later, never by import. Not wired yet.
- **Core domain purity is compile-enforced**: `packages/core` production sources get `types: []` (no `@types/node`), so a domain file importing `node:fs`/`node:child_process` is a type error. Node types are scoped to core's tests via `tsconfig.test.json`.
- **Open question flagged to the project owner (human gate):** review found ADR-0003's cross-package boundary guarantee may not hold as written under npm workspace hoisting. Reconciliation is a separate ADR decision — out of scope for this scaffold, not actioned here.

## Toolchain decisions

- **Run TS source directly, no emit step.** Node 25 strips types natively. Tests run on `.ts` via `node --test`; typecheck is `tsc --noEmit`. No `dist/`, no project-reference emit graph.
  - ADR-0003 accepts a build step; it is only needed for distribution/bundling (deferred to #CLI / packaging), not for the scaffold. Adding one later is not an architecture change.
- **`.ts` import specifiers** in relative imports (`./x.ts`) via `allowImportingTsExtensions` + `noEmit`, so tsc and Node's runtime resolver agree. Package entry points resolve through the `exports` field to `./src/index.ts`.
- **Strict set (ADR-0003 / CLAUDE.md), no relaxation:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables`. Module `nodenext`, target `es2023`, `verbatimModuleSyntax`.
- **Lint:** ESLint flat config, `@eslint/js` + `typescript-eslint` recommended, `@typescript-eslint/no-explicit-any: error`. Implicit `any` is caught by tsc strict.
- **Per-workspace `lib`:** core/node = ES2023 only; web = ES2023 + DOM. Each workspace owns its `tsconfig.json` extending the base; root `typecheck` fans out across workspaces.

## Scripts (root)

- `typecheck` — `tsc --noEmit` per workspace (`npm run typecheck --workspaces --if-present`).
- `test` — `npm run typecheck` then `node --test` (discovers `**/*.test.ts`, skips `node_modules`).
- `lint` — `eslint .`.

Pre-push hook runs `npm run lint` + `npm test`. Both must pass.

## Stubs

Each package exports a clearly-placeholder identifier and a smoke test asserting it. `node` imports `@clear-diff/core` to prove the cross-package wiring and dependency direction. `apps/web` keeps DOM bootstrap (`src/main.ts`) separate from a pure module (`src/app.ts`) so its smoke test runs DOM-free under `node --test`.

## Out of scope

- Domain model (`Review`/`Chapter`/`Section`/`Atom`) — ADR-0002 work.
- Ports, adapters, HTTP/WS server — later waves.
- `index.js` bin rewrite — #CLI.
- Real Vite app — web agent's work; this lays the workspace + config only.

## Test plan

- `npm run typecheck` passes across all three workspaces.
- `npm run lint` passes.
- `npm test` runs the smoke tests green.
- core has no runtime dependencies; node depends on core; web does not import node.
