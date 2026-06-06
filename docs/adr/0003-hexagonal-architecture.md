---
status: accepted
---

# Hexagonal architecture: ports and adapters, boundaries enforced by packages

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
| `DiffSource` | run git, parse to `RawHunk[]` | GitCli (→ GitHubPR later) |
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

- `core` imports nothing; `packages/node` depends on `core`; `apps/web` reaches `node`
  only over HTTP/WS, never by import.
- Held by **declared dependencies + mandatory architectural review**, not lint:
  - `packages/core` — domain + application + port interfaces. Pure TS, zero runtime deps.
  - `packages/node` — driven adapters + HTTP/WS server + composition root.
  - `apps/web` — Vite UI.
- Composition root = the `node` server bootstrap, the one place concrete adapters are
  constructed and injected. **Manual constructor injection, no DI framework.**
- The cross-package boundary is a contract, not a structural impossibility. npm hoists
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
