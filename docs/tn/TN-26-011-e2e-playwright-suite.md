---
number: 26-011
title: End-to-end Playwright test suite
kind: plan
status: active
issue: "#22"
tags: [testing, e2e, playwright, web, server, regression-net]
---

# TN-26-011: End-to-end Playwright suite

Wave 6. The committed `@playwright/test` regression net over the runnable skeleton (#10–#12). Boots the **real** server against a **deterministic committed fixture**, drives the actual UI in headless Chromium over the live WebSocket, and asserts the review loop end-to-end. RPC- and runtime-agnostic, so it stays green across the #23 Bun + tRPC migration — it drives UI behaviour, never transport internals.

## Why end-to-end here

Unit tests cover the pure layers (selectors, navigation, diff-model, controller, grouping, marks, store). They cannot prove the **whole stack composes**: git diff → master list → FakeAgent grouping → snapshot over WS → store → DOM → keyboard/marking → JSONL persistence → reload. This suite is that proof, and the migration's safety net.

## Fixture — deterministic, committed

A throwaway git repo built at setup time from committed builder code (`e2e/support/fixture-repo.ts`). **Scrub every `GIT_*` env var first** (the host-repo footgun: `GIT_DIR`/`GIT_WORK_TREE` under the pre-push hook would redirect `git init`/`show` at the real repo). Identity pinned, signing off — mirrors `packages/node/src/git/test-repo.ts`.

Two commits (base → head); the review is the `base..head` **range** (no `origin/main` needed). Content chosen to exercise every surface:

- `src/alpha.ts` — modified, **two non-contiguous hunks** → a gap within one file (tests the "expand hidden lines" affordance + `readFile` context fetch).
- `src/beta.ts` — **added** file.
- `src/gamma.ts` — **deleted** file.
- `src/delta.ts` → `src/delta-renamed.ts` — **renamed with an edit** (status `renamed`, carries `previousPath`).

FakeAgent groups one Section per file under a single "Changes" Chapter, deterministically. Master list = 5 atoms; section counts alpha=2, others=1. A second single-commit repo gives the **empty-diff** state (`sha..sha`).

## Booting the real server

- **Default path** — `runCli([range, "--no-open"], { cwd: repoDir })` returns the `RunningServer`; the suite takes `server.url`. This is the real CLI → real `compose()` (real FakeAgent, git adapters, JSONL store) → real HTTP/WS server, only the browser-open suppressed.
- **Summary path** — the AI-summary band needs an agent that emits summaries, and FakeAgent emits none. We add a **composition-root test seam**: optional `compose({ agent })`, defaulting to `new FakeAgent()`, mirroring the existing `config?` seam. The escaping test boots with an `AnnotatingAgent` whose summaries carry an HTML-injection probe, proving the band renders agent text via `textContent` (ADR-0004), never as markup.

One fixture + server per test (own ephemeral port, own state dir) → isolated and parallel-safe; marks persist in JSONL, so a shared server would leak state. The persistence spec restarts the backend against the same repo + state dir, so a fresh process rebuilds mark state from the log.

## Coverage

| Spec | Asserts |
|---|---|
| structure | Chapters → Sections in nav; counts + header progress from the canonical master list; active Section highlighted. |
| diff-surface | change-block / gap / block across files; "expand hidden lines" fetches context then collapses; file status labels (added/deleted/renamed); rename shows `old → new`. |
| marking | per-block Reviewed tick dims the block; whole-Section `D`/`S`; Section auto-completes on last block tick; auto-advance to next unreviewed; header progress updates. |
| keyboard | `j`/`k`/arrows move the active Section (visible highlight); `D`/`S` act; hot-keys suppressed while a text input is focused. |
| persistence | marks survive `page.reload()` (keyed by atom hash, read back from JSONL). |
| states | empty diff overlay; all-done (Go ready, "0 of N left"); light + dark. |
| summary | AI-summary band present + labelled; agent markup is escaped (no element injected, no script run). |
| vocabulary | rendered DOM text never contains "atom" or "hunk". |

The "edit reviewed lines → block resurfaces unreviewed" case is identity-level (hash keyed on payload) and already proven by core unit tests; not re-driven through the browser.

## Wiring

- `e2e/` (not a workspace): `playwright.config.ts`, `tsconfig.json` (strict), `support/`, `tests/`.
- Scripts: `npm run test:e2e` builds `apps/web` then runs Playwright (Chromium only, headless).
- Pre-push: runs the e2e suite when Chromium is installed; otherwise prints a clear "run `npx playwright install chromium`" notice rather than silently passing. Unit `npm test` is unchanged (globs `.test.ts` under `packages`/`apps`; e2e specs are `.spec.ts` under `e2e/`).

## Out of scope

Command palette, comment composer, chat messaging, Go dispatch, split diff mode — not built in the skeleton. Added to the suite when their issues land.
