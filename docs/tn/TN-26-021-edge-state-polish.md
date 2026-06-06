---
number: 26-021
title: Edge-state polish — connection lifecycle, empty, all-done
kind: plan
status: active
issue: "#19"
tags: [web, ui, states, connection, reconnect]
---

# TN-26-021: Edge-state polish

Light plan. Polish the whole-window and shell edge states on the Monaco surface +
shell, building on `apps/web/src/ui/states.ts`. Scope: connecting / loading,
reconnecting after a dropped backend, disconnected (gave up), empty diff, and an
all-done terminal signal. Keep to the existing design tokens.

## Current state

- `states.ts` `overlay()` covers `loading | empty | closed | error` and always
  replaces the grid.
- `store.ts` `Connection = "connecting" | "open" | "closed" | "error"`; the
  transport maps socket `open/close/error` straight onto it. No reconnect — a
  killed backend leaves a dead "Disconnected" screen forever.
- Status bar already shows a connection dot + label and a reviewed-count.

## Gaps → changes

1. **Auto-reconnect (rpc.ts).** `WebSocketTransport` is the only place `WebSocket`
   is touched, so reconnect lives there (no boundary change; still WS-only per
   ADR-0003). On socket close, retry with capped backoff; fire a new
   `"reconnecting"` lifecycle event while retrying, and the terminal `"close"`
   only once retries are exhausted. Re-wire message + lifecycle handlers onto each
   new socket. Reset backoff on a successful open.

2. **Connection states (store.ts).** Add `"reconnecting"` to `Connection`. Map
   transport `reconnecting → "reconnecting"`. On a successful re-open the store's
   existing `open` handler refetches the snapshot, so recovery is seamless.

3. **Overlay only when there's nothing to show (states.ts).** When a snapshot is
   present the grid stays visible and connection trouble is surfaced
   non-blockingly via the status bar (the user keeps their place; reconnect
   refetches). The grid-replacing overlay is reserved for *no snapshot yet*:
   `connecting`, `reconnecting`, `disconnected`, `loading` (socket open, awaiting
   `open`), `error` (open() rejected). Empty diff (snapshot present, master list
   empty) keeps its overlay.

4. **Status bar (view.ts + styles.css).** Add the `reconnecting` label + dot
   (distinct from open/closed). When the review is complete
   (`unaddressed === 0 && total > 0`) the count reads "All N changes reviewed"
   with an accent/check — the non-blocking all-done signal (dispatch/Go is a
   separate future terminal state, #14).

## Out of scope

Dispatch/Go terminal screen (#14), huge-diff nav perf, resurfaced-after-change
signalling, "Other changes" grouping — those live in their own issues.

## Verify

`npm test` + lint, then the real app: an empty-diff range shows the empty state;
killing the backend mid-review shows "Reconnecting…" with the grid intact, and
restarting it recovers without a reload.
