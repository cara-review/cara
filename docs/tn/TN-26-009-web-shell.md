---
number: 26-009
title: Web — app shell, 3-pane layout, nav tree, WS client + state store
kind: plan
status: active
issue: "#11"
tags: [web, ui, shell, websocket, state, hexagonal]
---

# TN-26-009: Web app shell + state foundation

Wave 4. `apps/web` only. Builds the **shell and the shared foundation** the diff
surface (#12) sits on: the 3-pane layout, the nav tree, the header, and — load-bearing —
the typed WS client + app state store. Not the diff rendering, marking interactions,
keyboard model, command palette, chat messaging, or comment composer (#12 / later).

Honours ADR-0003 (web reaches the backend over WS only, never by import) and ADR-0004
(counts/progress are canonical from `masterList`; Chapter/Section `summary` is the
untrusted AI overlay — escaped on render, display-only). Vocabulary: only **Chapters**
and **Sections** ever surface; never "atom"/"hunk".

## Approach: vanilla TS, no UI framework

The scaffold is vanilla Vite TS and the repo's ethos is simplicity-first, so the shell is
plain TS + DOM with a small reactive store and pure render functions — no React/Svelte
(adding one would be an architectural choice unto itself). The store and all logic stay
**DOM-free** so they unit-test under `node --test` (the established pattern); DOM render
functions are thin and untested by node.

## Backend contract (pending #10 import)

#10 has not landed on `main`, so the wire contract lives locally in `protocol.ts` as the
documented JSON shapes. **On rebase once #10 lands**, swap the local
`ClientRequest`/`ServerResponse`/`ResultMap`/`Method` (+ snapshot shapes) for type-only
imports from `@cara/node`. Single-file swap by design.

One WebSocket, **same-origin** — the node server hosts HTTP (the built UI) and the WS on
one port, so the client connects `ws://${location.host}` with no port injection (a `?ws=`
override exists only for dev against a separate backend). RPC: client `{id, method, params}`
→ server `{id, ok:true, result} | {id, ok:false, error}`, correlated by `id`.
Methods: `open`{}, `mark`{context,atomHash,disposition}, `unmark`, `comment`{...,body},
`openInEditor`{path,line}, `readFile`{path,side}.

## Module layout (`apps/web/src`)

```
protocol.ts    wire contract: JSON shapes + RequestParams/ResultMap/Method/Client+ServerResponse
                 (local mirror; → import from @cara/node on rebase)
rpc.ts         Transport interface, WebSocketTransport (browser), RpcClient (id-correlated)
store.ts       AppStore: UI state, subscribe/notify, actions, transport lifecycle binding
selectors.ts   pure derivations: marksMap, sectionRollup, navTree
dom.ts         el() element factory + fill() helper (textContent only, no innerHTML)
view.ts        builds the 3-pane skeleton + status bar; updates regions; overlay vs grid
ui/glyph.ts    mark-state glyph (shape + label, never colour-only)
ui/header.ts   brand + context + progress meter + Go + ⌘K
ui/nav.ts      renderNav into a stable host (Chapters → Sections, glyphs, counts, active)
ui/diff-pane.ts   sticky section header (glyph+title) + AI-summary band + stable diff mount
ui/chat-pane.ts   static chat chrome (Chapter Q&A header + scope + composer placeholder)
ui/states.ts   loading / empty / error / disconnected screens
main.ts        composition: build transport→rpc→store, wire to DOM, connect
styles.css     design tokens (light + dark via prefers-color-scheme) + layout
test-support.ts   shared test fixtures (FakeTransport, atom/section builders)
vite-env.d.ts     ambient declarations for *.css and import.meta.env.DEV
```

Removes the scaffold stubs `app.ts` / `app.test.ts` (greeting placeholder).

## State + actions (the foundation #12 builds on)

```ts
type Connection = "connecting" | "open" | "closed" | "error";
interface AppState {
  connection: Connection;
  snapshot: ReviewSnapshot | null;
  error: string | null;
  activeSection: { chapter: number; section: number } | null;  // index path; no domain ids
  expandedChapters: ReadonlySet<number>;
}
```

Sections/Chapters have **no id** in the domain — addressed by index path within a snapshot
(grouping is regenerated each `open`). `AppStore`:
- `subscribe(listener)` / `getState()`
- `bindTransport(transport)` — maps open/close/error to `connection`; on open, calls `open()`
- `open()` → rpc `open`, store snapshot, focus + expand the first chapter that has sections
  (a failed `open` stores `error`, which the overlay surfaces instead of spinning)
- `mark(atomHash, disposition)` / `unmark(atomHash)` / `comment(atomHash, body)` — pull
  `context` from the current snapshot, rpc, store fresh snapshot, **return it**
- `openInEditor(path, line)` / `readFile(path, side)` — pass-through to rpc
- `setActiveSection(path)` / `toggleChapter(index)`

All mutations return the fresh `ReviewSnapshot` (per the contract) *and* notify subscribers,
so #12 can either await or subscribe.

## Selectors (pure, tested)

- `marksMap(snapshot)` → `Map<AtomHash, Disposition>` from the snapshot's marks array.
- `sectionRollup(section, marks)` → `{state, addressed, total}`. State: any change unaddressed
  → `unreviewed`; all addressed and all `skipped` → `skipped`; else `done`. `addressed`/`total`
  back the partly-reviewed reading. Derived from the **canonical marks** keyed by atom hash,
  never from grouping-held state (ADR-0004).
- `navTree(snapshot)` → chapters → sections with `{title, summary, count, state, addressed}`;
  `count = section.atoms.length` (post-repair the grouping partitions the master list, so
  section counts roll up to the canonical total).
- Header progress reads `snapshot.progress` (`{total, addressed, unaddressed}`) — canonical.

## Rendering

Shell skeleton built once; state changes update dynamic regions via `replaceChildren`.
**All dynamic text via `textContent`** (never `innerHTML`) — structurally escapes the
untrusted AI summaries and any backend strings (ADR-0004). The review **context** string
is rendered verbatim (the UI must not parse/reformat git-ish refs — leakage avoidance).

Shell regions:
- **Header** `h-12`: brand (`pl-16`, clears macOS traffic lights) · context · progress
  meter + "N changes left" · `⌘K` affordance + Go (rendered, inert in this PR).
- **Nav** `w-64`: STRUCTURE label, Chapter rows (chevron, expand) → Section rows
  (mark glyph + title + count); active section highlighted (inset accent bar).
- **Diff** `flex-1`: sticky section header (glyph + active title), AI-summary band
  (escaped, labelled, secondary), then `<div data-diff-surface>` mount point for #12.
- **Chat** `w-80`: Chapter Q&A header + active chapter scope; static composer placeholder.
- **Status bar**: connection + counts. Panes are **static** (resize/collapse is a later issue).

States: `connecting` → calm loading; `error`/`closed` → message; `open` & empty masterList
→ "Nothing to review"; otherwise the full shell.

## Tokens (light + dark)

From `docs/design/initial-prototypes.md`, verbatim: one accent `#5E6AD2`; neutral + diff
palettes per mode. CSS custom properties on `:root`, dark overrides under
`@media (prefers-color-scheme: dark)` — follows the system appearance live. Type stacks
name Inter / JetBrains Mono first with native fallbacks (`-apple-system` / Menlo); **fonts
are not bundled in this PR** (self-hosting is its own follow-up; CDN is disallowed by
local-first). 4px spacing scale, hairline borders, restrained elevation, 120–200ms motion.

## Test plan (`node --test`, `.ts`, DOM-free)

- `rpc.test.ts` — id correlation; success resolves typed result; `ok:false` rejects with
  the error; unknown/late id ignored; out-of-order responses; uses a fake transport.
- `store.test.ts` — `open` expands first chapter + selects first section; `mark` updates
  snapshot + returns it + notifies; connection transitions on transport open/close/error;
  empty-diff snapshot handled.
- `selectors.test.ts` — `sectionState` (unreviewed/done/skipped/partial), `marksMap`,
  `navTree` counts roll up to master-list total, progress passthrough.

## Out of scope (→ #12 / later)

Diff rendering & evidence (reads `readFile`), block ticking + Section marking UI, keyboard
model, command palette, chat messaging, comment composer, pane resize/collapse + persistence,
split/unified modes, the Go dispatch flow, bundled fonts.
