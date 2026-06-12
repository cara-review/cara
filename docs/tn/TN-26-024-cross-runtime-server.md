---
number: 26-024
title: Cross-runtime server runtime — Node-portable transport for native npx
kind: proposal
status: active
issue: "#42"
tags: [transport, bun, node, npx, distribution, hexagonal, security]
---

# TN-26-024: Cross-runtime server runtime

`cara` is published to npm as a Bun-native bin, so `npx cara` only works on machines that already have Bun (the bin shebang routes to `bun`; `Bun.serve` doesn't exist under Node). That blocks the core distribution goal — a friend with just Node can't run it. Background for the **ADR-0008 amendment**.

## The key finding

The Bun-specific *runtime* surface is **one file**: `packages/node/src/server/server.ts` uses `Bun.serve`, `trpc-bun-adapter`, and `Bun.file`. Everything else in the runtime (git adapters, the Anthropic adapter, the review store, the CLI) already uses Node built-ins, and the web side is static assets. So this is not "Bun vs npx" — it's one transport-API choice.

## Decision (Option C)

Keep Bun for dev/build/test; make the **runtime** cross-runtime so the published bundle runs under plain Node (and still under Bun):

- `Bun.serve` → `node:http` `createServer`
- `trpc-bun-adapter` → `@trpc/server`'s ws adapter (`applyWSSHandler` + the `ws` library on the HTTP upgrade)
- `Bun.file` → `node:fs` (`createReadStream` / `stat`)
- Published bundle retargeted to Node with `#!/usr/bin/env node`; `bun index.js` stays the dev entry.

Result: native `npx cara` (and `node dist/index.js`) on any Node machine — no Bun, no compiled binaries — while Bun remains a fully-supported runtime.

## What stays / changes

- **Stays:** the tRPC transport + the type-only `AppRouter` contract import (ADR-0008 §2), subscriptions (the grouping-progress stream), structured-data-only, **Origin/Host hardening + path containment** (re-ported to the node:http handler), the Bun toolchain for dev/build/test, 127.0.0.1-only bind.
- **Changes:** `ws` returns as a *runtime* dependency (reverses one bullet of CDR-0001's "drop ws"); `trpc-bun-adapter` dropped; the published bin targets Node.

## Security

The loopback Host check (DNS-rebinding) and loopback Origin check (CSRF) move from the `Bun.serve` `fetch` to the node:http request handler (Host, for HTTP) and the `upgrade` handler (Host + Origin, for WS). Path containment is unchanged (router + serveHttp). Re-ported verbatim and re-reviewed (security review).

## Rejected

- **Revert #23 entirely** — throws away the genuinely valuable, runtime-independent toolchain wins (bun install/test/build, no Vite) to fix a one-file problem.
- **Per-platform compiled binaries + a Node shim** (esbuild model) — universal npx, but ~1–2 days of CI/packaging plumbing and large binaries; disproportionate given the one-file Bun-runtime surface. This amendment makes that approach (a #38 sibling) unnecessary.

## Status

Owner-approved 2026-06-08; ratified as the ADR-0008 amendment.
