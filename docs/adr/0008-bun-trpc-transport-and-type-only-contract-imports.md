---
status: accepted
---

# Bun + tRPC transport, with type-only contract imports across the web↔node seam

Background: TN-26-017. The Bun + tRPC direction, the ADR-0003 amendment, and the CDR-0001 promotion this ADR carries are owner-approved in #23 (the issue is the record of approval) and ratified here.

The skeleton ships a bespoke `{id,method,params}` RPC over `ws` with hand-rolled validation. Rather than build that and swap it later, #23 builds the WebSocket server **once** as `Bun.serve` + tRPC. This ADR ratifies the tRPC transport, amends ADR-0003 to permit **type-only** contract imports across the web↔node seam (the runtime boundary stays enforced), and records the Bun toolchain decision for promotion to **CDR-0001**.

## Context

- ADR-0003 fixes the boundary: `apps/web` reaches `packages/node` "only over HTTP/WS, never by import", with data as structured-data-only.
- tRPC's end-to-end type safety needs the web client to import the router **type** (`AppRouter`) — a compile-time-only reference, erased at runtime.
- #10 hardened the bespoke transport (Origin/Host checks, path containment, structured-data-only); those invariants must survive the swap.
- #22 Playwright e2e is RPC-agnostic and stays green as the regression net.

## Decision

### 1. Transport: tRPC over Bun.serve WebSocket

- Replace the bespoke RPC with a **tRPC router** over `Bun.serve` WS.
- **zod** validates every input at the boundary, replacing #10's hand-rolled validation.
- Retain structured-data-only, Origin/Host hardening, and path containment.
- A tRPC **subscription** channel carries `open` as a stream: grouping progress (an elapsed tick while the agent groups, then the resolved Section titles revealed one by one), then the snapshot. The progress is synthesised in the transport layer — the core grouping stays a single use-case, **no new port** — so the diff-blind invariant (ADR-0004) is untouched.

### 2. ADR-0003 amendment: type-only contract imports

ADR-0003's "never by import" is **narrowed to runtime**:

- **Permitted:** `apps/web` may import the contract **type-only** from the node package — `import type { AppRouter } from "@clear-diff/node/contract"`, runtime-erased. The dedicated `/contract` subpath is a pure type surface (the router type + domain types); it carries no server runtime, so importing it never drags `Bun.serve` / node builtins into the web program.
- **Enforced boundary is the runtime one:** no node runtime code in the web bundle; data flows only over WS.
- **Verification:** the prod web bundle is checked to contain zero backend/node code. This build-time check *is* the boundary now that a type import is allowed.

ADR-0003's dependency rule now reads "type-only contract imports permitted; no node *runtime* code in the web bundle," pointing here.

### 3. Bun toolchain → CDR-0001

The Bun toolchain (runtime, `bun test`, `bun install`, Bun bundler/dev server replacing Vite, bun pre-push hook; drop `ws`/Vite/npm) is a **convention**, not an architectural boundary. It is promoted to **CDR-0001** (the first Convention Decision Record), referencing TN-26-017.

## What stays unchanged

- Hexagonal core stays runtime-agnostic pure TS, compiled with `types: []`. Ports come for free.
- **No new ports, no layer changes** beyond the type-only carve-out.
- The web never imports node *runtime* code; all data still crosses over WS as structured data (ADR-0003, ADR-0004).

## Consequences

- The WS server is written once; no bespoke-then-tRPC churn.
- End-to-end type safety from a single source of truth (`AppRouter`); the dev-11 local `protocol.ts` mirror is deleted.
- The boundary's teeth move from "no import at all" to "no runtime import + bundle verification" — a real check, not a structural impossibility (consistent with ADR-0003's existing "declared deps + review" stance).
- Bun is a hard toolchain dependency; contributors need it installed.

## Rejected

- **Bespoke RPC now, tRPC later** — builds the WS server twice; #23 rejects the churn.
- **Runtime-shared contract package** — a third package web imports at runtime; reintroduces a runtime web→node coupling the amendment is careful to avoid.
- **Keep Vite alongside Bun** — owner chose full-Bun; two bundlers is needless surface.
- **Hand-rolled validation** — zod at the tRPC boundary subsumes #10's manual checks with less code.

## Amendment (2026-06-08): cross-runtime server runtime

Background: TN-26-024, issue #42. Owner-approved 2026-06-08.

§1 chose tRPC over **`Bun.serve`**. That tied the published runtime to Bun (`Bun.serve` has no Node equivalent), so `npx clear-diff` only ran where Bun was installed — blocking the distribution goal. The Bun-specific runtime surface turned out to be a single file (`server.ts`). This amendment narrows the **runtime-API** choice without touching the transport decision:

- **`Bun.serve` → `node:http`**, **`trpc-bun-adapter` → `@trpc/server`'s ws adapter** (`applyWSSHandler` + the `ws` library on the HTTP upgrade), **`Bun.file` → `node:fs`**. The published bundle targets Node (`#!/usr/bin/env node`); `bun index.js` stays the dev entry.
- **Result:** the published CLI runs under plain Node (`npx clear-diff`, `node dist/index.js`) on any machine, and still under Bun. No compiled binaries, no platform packages.
- **Unchanged:** the tRPC transport, the type-only `AppRouter` import (§2), subscriptions, structured-data-only, the loopback **Origin/Host hardening** + path containment (re-ported to the node:http request + upgrade handlers, re-reviewed), and the Bun toolchain for dev/build/test (§3 / CDR-0001).
- **CDR-0001 note:** `ws` returns as a *runtime* dependency (reversing that one "drop ws" bullet); the rest of the Bun toolchain convention stands. Bun is no longer a *runtime* requirement for end users, only a dev/build toolchain.

This makes the per-platform-binary / Node-shim approach (a #38 sibling) unnecessary.
