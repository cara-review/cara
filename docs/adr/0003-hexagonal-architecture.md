---
status: accepted
amended-by: [0008, 0011]
---

# Hexagonal architecture: ports and adapters, boundaries enforced by packages

> **Amended by [ADR-0011](0011-cli-agent-protocol.md) (TN-26-026, Refs #47).** The
> agent is no longer a **driven** port the core fetches grouping from. `AgentPort` and
> `AgentChat` (ADR-0009) leave the driven-port table; the **agent becomes a driving
> actor** invoking CLI verbs, and the LLM-wrapper porcelain (`clear-diff review`) is a
> **driving adapter**. Grouping arrives **inbound** (untrusted, repaired to a bijection),
> never fetched. `ConfigPort` is sourced from `~/.clear-diff/config.toml`. See the
> amendment at the foot of this ADR.

clear-diff is a hexagon: a pure domain + application core surrounded by adapters. Form
factor (local web app, ADR-0001) and roadmap (CLI, phone, cloud config) mean many
interchangeable front-ends and back-ends over one unchanged core. So the core owns the
logic; every IO touchpoint sits behind a port. Full ports-and-adapters is a deliberate
choice over the repo's default minimalism, justified by testability and the multi-frontend
roadmap.

## Layers

- **domain** (pure, no IO) — `Review`, `Chapter`, `Section`, `Atom`; content-hash identity
  + normalisation; marking rules; ordering invariants; grouping validation.
- **application** — `ReviewService`, the single inbound port. Orchestrates the driven
  ports; holds the use-cases.
- **adapters**
  - **driving** (primary): HTTP/WS web server, CLI, later phone. All call `ReviewService`.
  - **driven** (secondary): the ports below.

## Driven ports

| Port | Responsibility | Adapter(s) |
|---|---|---|
| `DiffSource` | run git → `RawHunk[]`; resolve the review context for a spec (ADR-0005) | GitCli (→ GitHubPR later) |
| `WorkspaceReader` | file content at a ref | `git show` |
| `AgentPort` | propose grouping (structure only) | Anthropic (→ Fake for tests). See ADR-0004 |
| `ReviewStore` | persist marks / comments / grouping per context | fs JSON (→ sqlite) |
| `EditorPort` | open file at line | spawn `code`/`zed` |
| `ConfigPort` | editor cmd, prefs | fs / env |
| `InstructionsSource` | load `clear-diff.md` (personal + project) | fs |
| `ClockPort` | timestamps | system / fixed |

`LoggerPort` deferred — retrofit if it ever earns its keep. Rule for adding a port: a
driven dependency with real behaviour or a fake worth having gets one; a single-impl-forever
triviality stays a function.

## Dependency rule (declared deps + review)

> **Amended by [ADR-0008](0008-bun-trpc-transport-and-type-only-contract-imports.md):**
> the web↔node boundary is narrowed from "never by import" to "never by *runtime*
> import." A **type-only** contract import (`import type { AppRouter } from
> "@clear-diff/node/contract"`, runtime-erased) is permitted; the enforced boundary is
> that the prod web bundle contains **zero node runtime code** (build-time verified).
> Data still flows only over the WebSocket, as structured data.

- `core` imports nothing; `packages/node` depends on `core`; `apps/web` reaches `node`
  only over WS at runtime — never a runtime import (type-only contract imports permitted,
  ADR-0008).
- Held by **declared dependencies + mandatory architectural review**, not lint:
  - `packages/core` — domain + application + port interfaces. Pure TS, zero runtime deps.
  - `packages/node` — driven adapters + Bun.serve/tRPC WS server + composition root.
  - `apps/web` — Bun-bundled UI (CDR-0001).
- Composition root = the `node` server bootstrap, the one place concrete adapters are
  constructed and injected. **Manual constructor injection, no DI framework.**
- The cross-package boundary is a contract, not a structural impossibility. Bun hoists
  workspace packages into the root `node_modules`, so `core` *can* resolve a bare `@clear-diff/node`
  specifier even without declaring it. Three guarantees hold the boundary instead:
  - **declared deps** — `core` declares no dependency on `node`/`web`; an adapter import is
    undeclared and caught in review.
  - **mandatory architectural review** on every change.
  - **compile-enforced domain purity** — `core` production sources compile with `types: []`,
    so `node:*` / builtin imports fail to typecheck.

## What crosses the boundaries

- **`DiffSource` → `RawHunk[]`** (path, ranges, typed lines). The domain maps
  `RawHunk → Atom` and computes identity, so every source (git, PR) yields identical
  identity (ADR-0002). Adapters parse; the domain decides what an atom *is*.
- **Backend → UI: structured data only** — atoms (hash + current line-ranges) plus file
  texts via `WorkspaceReader`. Never pre-rendered diff HTML, so any viewer (Monaco,
  CodeMirror) and any front-end stays swappable; the UI drives folding/decorations from
  atom ranges.

## TypeScript

- `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `useUnknownInCatchVariables`.
- No `any`, implicit or explicit (lint-enforced). `unknown` + narrow at boundaries.
- Inference-first; annotate only at seams. The **port interfaces are the explicit
  annotations**; implementations infer. Generics where they earn reuse.

## Consequences

- Every front-end (web/CLI/phone) and every viewer is an interchangeable adapter; Electron
  is just a driving adapter over an unchanged `ReviewService`.
- Domain + application are fully unit-testable against fakes — zero git, LLM, or fs. This
  is the main payoff: the load-bearing identity logic (ADR-0002) is tested in isolation.
- Cost: a build step + workspace wiring. Accepted.

## Rejected

- **Single package + lint-enforced boundaries** — discipline, not structure; an adapter
  leaks past one `eslint-disable`.
- **DI container** — abstraction beyond need.
- **Pre-rendered diff from the backend** — locks to one renderer, breaks the phone app and
  viewer swaps.
- **Plain JS** — throws away the compile-time checks that make a port a real boundary.

## Amendment (2026-06-09): agent inverts from driven to driving

Background: TN-26-026, issue #47. Owner-approved in-session 2026-06-09.

The pivot removes the built-in grouping LLM. The port table changes:

- **`AgentPort` removed** as a driven port. Grouping is no longer fetched; it arrives
  **inbound** over the CLI (`present`), untrusted, and is repaired to a bijection over the
  master list before anything renders (ADR-0004, as amended). The agent is now a **driving
  actor**, not a secondary dependency.
- **`AgentChat` removed** (ADR-0009 superseded by ADR-0011). No chat surface; Q&A routes
  back to the caller as a comment answer.
- **LLM-wrapper porcelain (`clear-diff review`) is a driving adapter** — an outer module
  that drives the same plumbing verbs (`atoms`/`present`/`dispatch`/`submit`). The core
  carries no LLM, no model, no API key.
- **`ConfigPort` source is `~/.clear-diff/config.toml`** (was "fs / env"). It subsumes the
  old `AppConfig.groupingModel`; plumbing verbs never read `[grouping]`/`[llm]`.
- `InstructionsSource` loads `CLEAR_DIFF.md` (project root + `~/.clear-diff/`), merged with
  system methodology, version-locked to the `present` schema (renamed from `clear-diff.md`).

The CLI was always a driving adapter (above); this amendment makes the **agent itself** a
driving actor over it. The hexagon, the package boundaries, and the dependency rule are
otherwise untouched — the change is which side of the boundary the agent sits on.
