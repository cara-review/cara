---
number: 26-008
title: Backend — HTTP/WS server, composition root, and clear-diff CLI
kind: plan
status: active
issue: "#10"
tags: [node, adapter, server, websocket, composition-root, cli, hexagonal]
---

# TN-26-008: Backend HTTP/WS server + composition root + CLI

Wave 3. `packages/node` driving adapter: the composition root, the HTTP/WS server that exposes `ReviewService` to the UI, and the `clear-diff` bin. Depends on the landed hexagon (domain + all ports + git/store/fake/trivial adapters + `ReviewService`). Implements the driving side of ADR-0003 (composition root; **structured data only over the wire, never pre-rendered diff HTML**) and serves the UI described in `design-brief.md`.

## Modules

- `src/server/protocol.ts` — the **backend→UI wire contract**: the JSON request/response shapes and WS method set. Carries domain data (`ReviewSnapshot`, file texts) outward; imports only core domain types, never the reverse. This is what `dev-11`/`dev-12` build against.
- `src/server/dispatch.ts` — `handleRequest(deps, req)`: pure-ish RPC dispatch over `ReviewService` + `WorkspaceReader` + the configured `DiffSpec`. Unit-testable with fakes, no sockets.
- `src/server/server.ts` — `startServer(deps, opts)`: `node:http` server + `ws` `WebSocketServer`. HTTP serves the built UI (static, when present) or a placeholder; WS carries the RPC. Binds `127.0.0.1` only (local-first, ADR-0001).
- `src/server/compose.ts` — the **composition root**: the one place concrete adapters are constructed and injected into `createReviewService`. Default `AgentPort` = `FakeAgent` (real Anthropic is a later issue).
- `src/cli.ts` — `parseArgs(argv)` (→ `DiffSpec` + flags) and `runCli`: boot the server, print the URL, open the UI in an `--app`-mode browser window.
- `index.js` — bin bootstrap (`#!/usr/bin/env node`) importing `runCli`. Replaces the stub.

## Wire contract (WS RPC)

One persistent WS connection. Client→server: `{ id, method, params }`. Server→client: `{ id, ok: true, result } | { id, ok: false, error }`. Methods mirror the inbound port plus file reads for evidence:

| method | params | result |
|---|---|---|
| `open` | — (server holds the boot `DiffSpec`) | `ReviewSnapshot` |
| `mark` | `{ context, atomHash, disposition }` | `ReviewSnapshot` |
| `unmark` | `{ context, atomHash }` | `ReviewSnapshot` |
| `comment` | `{ context, atomHash, body }` | `ReviewSnapshot` |
| `openInEditor` | `{ path, line }` | `null` |
| `readFile` | `{ path, side }` | `{ text: string \| null }` |

`open` takes no spec from the client: the CLI fixes the spec at boot, so the UI never constructs git-ish ref strings (leakage avoidance). `readFile` is backed by `WorkspaceReader` (not on the inbound port) so the UI renders evidence from verbatim file texts + atom ranges (ADR-0003/0004) — the backend never serialises rendered diff HTML.

## Composition root

`compose({ cwd, spec, stateDir, editorCommand })`:
`GitDiffSource(cwd)`, `JsonlReviewStore(stateDir)`, `FakeAgent`, `FileInstructions(home, cwd)`, `SpawnEditor(editorCommand)`, `SystemClock` → `createReviewService(...)`. Also builds `GitWorkspaceReader(cwd, refsForSpec(spec))` for `readFile`. Returns `{ service, workspace, spec }`. Editor command resolved via `EnvConfig` at the root, defaulting to `code`.

## CLI

- `clear-diff` → `{ kind: "worktree" }` (worktree vs `origin/main`).
- `clear-diff <base>..<head>` → `{ kind: "range", base, head }`.
- `clear-diff --pr N` → explicit "not yet supported" error.
- `--no-open` suppresses the browser launch (tests, headless).
- Ephemeral port (`listen(0)`); the URL is printed. The UI opens via a chromium `--app=<url>` window, falling back to the OS opener.

## Leakage discipline

Transport concerns (HTTP/WS framing, JSON envelope, browser launch, static serving) live entirely in `src/server` + `src/cli.ts`. The wire contract imports core domain types to carry them outward; nothing pushes HTTP/WS/JSON concepts into core. The composition root is the only place adapter constructors meet.

## Git test hygiene

Any test (or the CLI integration test) that spins up a git repo or shells out to git **scrubs `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`** from the child/test env — under the pre-push hook these leak and operate on the host repo. The existing `test-repo.ts` scrubs `process.env` at import; the CLI integration test spawns the bin with a scrubbed env and a temp-repo cwd, and is verified under a simulated hook env.

## Tests (`node --test`)

- `dispatch.test.ts` — each method maps to the right use-case; bad method / malformed params → error response; `readFile` round-trips `WorkspaceReader`; errors surface as `{ ok: false }`.
- `compose.test.ts` — the root wires a working `ReviewService` + `WorkspaceReader` over a temp repo (open → snapshot, readFile → text).
- `server.test.ts` — real WS round-trip against a temp repo: connect → `open` → `mark` → snapshot reflects the mark; `readFile` returns file text; binds localhost.
- `cli.test.ts` — `parseArgs` (worktree / range / `--pr` rejected / bad input / `--no-open`); bin integration: spawn with `--no-open` + scrubbed env against a temp repo, assert it boots and serves a snapshot over WS.

## Out of scope

Real Anthropic `AgentPort`; PR diffs; the web UI itself (`apps/web`, `dev-11`/`dev-12`); server-push/progress streaming during grouping (FakeAgent is instant; revisit when the real agent lands); diff-source switching from the UI.
