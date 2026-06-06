---
number: 26-017
title: Bun + tRPC toolchain and transport rework
kind: proposal
status: draft
issue: "#23"
tags: [tooling, transport, bun, trpc, hexagonal]
---

# TN-26-017: Bun + tRPC toolchain and transport rework

One coherent post-skeleton wave: rework the toolchain (Bun) **and** the RPC/transport (tRPC) together, so the WebSocket server is built **once** as Bun.serve + tRPC rather than bespoke-then-swapped. Background for **ADR-0008** (status: proposed). The Bun+tRPC direction is **owner-approved in #23**; the **ADR-0003 amendment** and **CDR-0001 promotion** still need explicit owner sign-off on the ADR before implementation.

## Context

- Skeleton (#11, #12) lands a bespoke `{id,method,params}` RPC over `ws` with hand-rolled validation (#10).
- #22 Playwright e2e is the **regression net** — RPC-agnostic, drives the UI — kept green through the rework.
- Building the WS server twice (bespoke now, tRPC later) is waste; #23 chose to build it once.

## Proposal

### Bun (full toolchain)

- Bun runtime (native TS exec); `bun test` replaces `node:test` across core/node/web; `bun install` (drop npm + `package-lock.json`); `#!/usr/bin/env bun` CLI shebang; pre-push hook → bun.
- **apps/web:** Bun bundler + dev server; **drop Vite** (owner chose full-Bun).
- Drop deps: `ws`, Vite, npm.

### tRPC over Bun.serve WS

- Replace the bespoke RPC with a **tRPC router** over `Bun.serve` WebSocket.
- **zod** input validation at the boundary, replacing #10's hand-rolled validation.
- Keep **structured-data-only** (ADR-0003) + #10's **Origin/Host hardening** (CSRF / DNS-rebinding) + path containment.
- **Subscriptions:** stand up the tRPC subscription channel — the home for the deferred grouping-progress stream (real-agent case, #18/#19).
- **Web client:** `import type { AppRouter } from "@clear-diff/node"` (type-only, runtime-erased) + tRPC client. Replaces dev-11's local `protocol.ts` mirror.

### ADR-0003 amendment (type-only carve-out)

- Today ADR-0003 says web reaches node "only over HTTP/WS, never by import". tRPC's typed client needs a **type-only** import of `AppRouter`.
- Carve-out: **type-only contract imports are permitted; the enforced boundary is the runtime one** — no node runtime code in the web bundle (verify zero backend in the prod build); data still flows only over WS.
- On approval, ADR-0008 records the amendment and ADR-0003 is updated to point to it.

### CDR-0001 (first Convention Decision Record)

- Promote the Bun toolchain decision to **CDR-0001** on approval — it's a convention (tooling), not an architectural boundary.

## Boundaries / invariants (unchanged)

- Hexagonal core stays runtime-agnostic pure TS — ports for free. Only adapters, build, test config, and the transport mechanism change.
- **No new ports, no layer changes** beyond the type-only-import carve-out.
- Core still compiles with `types: []`; node/web runtime separation still enforced at the bundle.

## Verification

- Full `bun test` + #22 e2e green on Bun/tRPC.
- `clear-diff` boots + runs end-to-end on Bun.
- Prod web bundle contains **zero** node/backend code (the runtime boundary the amendment relies on).

## Sequencing

- Start only after (a) skeleton (#11, #12) verified runnable, and (b) #22 e2e in as the regression net.
- May split Bun-first then tRPC at execution time if parallelism pays — but the WS server is written once for both.
