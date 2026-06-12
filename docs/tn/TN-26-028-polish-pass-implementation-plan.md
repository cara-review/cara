---
number: 26-028
title: Polish-pass implementation plan — field-test findings on the pivot
kind: plan
status: active
issue: "#47"
tags: [pivot, plan, polish, core, cli, porcelain, web, reshape, methodology, tests]
---

# TN-26-028: Polish-pass implementation plan

Field-test findings on the landed pivot (ADR-0011 / [TN-26-026](TN-26-026-cli-agent-protocol-pivot.md), built per [TN-26-027](TN-26-027-pivot-implementation-plan.md)). The pivot is verified and release-ready (`.agent-state/pivot-verification.md`); this plan closes eight findings from hands-on three-axis use. Implementer-ready for core, CLI/server, porcelain, web, e2e, and docs. Read TN-26-027 first for the substrate; this plan only adds.

The four design-level findings (a, b, d, e) are ratified in **[ADR-0012](../adr/0012-field-test-amendments.md)** (amends ADR-0004 + ADR-0011; task #11, adr-author-2). ADR-0012 fixes the *decisions*; this plan fixes the *mechanics* (event lifecycle, wire shapes, modules) it left open. The **settled rulings** below are authoritative (owner, in-session).

**End state:** Chapter/Section summaries enforced at the boundary; comments may point at a content-addressed line; gap-closed progress counts comment-only atoms; cognitive-load methodology sizing; a review-level **Reshape** loop; one server per context, live-refreshed on re-present; self-narrating hints that state exact invocation shapes. No new LLM in core, no relaxed invariant.

## Settled rulings (owner, authoritative)

Each maps to a finding and a workstream. Implement exactly; do not widen.

- **(a) Summaries mandatory.** `presentGrouping` rejects any grouping whose agent-supplied chapters/sections lack a non-empty summary, returning the missing list. The floor grouping is exempt (explicit opt-out); the engine-swept "Other changes" chapter is never validated.
- **(b) Line-pointer comments.** A comment may carry an optional pointer to a single line by **content + side** (never a line number). Resolved to a location at read time; end-of-hunk fallback when the content no longer matches. **Marks stay block-level** (atom-keyed, unchanged).
- **(c) Methodology sizing.** Replace the "~2–5 chapters" sizing prose with a **cognitive-load** rule (a Section holds what a reviewer can grasp at once) and a **homogeneous-run exception** (a long run of near-identical change may be one Section). Bump `METHODOLOGY_VERSION` → 2.
- **(d) Reshape.** A **review-level request** (not a comment): new event type + a `dispatch` output field. Browser affordance ("Reshape…" palette action + header button → text box). The agent receives it via `dispatch` and acts by **re-presenting**. See *Shared lifecycle: Reshape* below.
- **(e) Single server per context + live-refresh.** `present` detects a live server (discovery + pid liveness) and **hands it the new grouping** — the running server re-runs `presentGrouping` and pushes a fresh snapshot to connected browsers over the existing WS (live-refresh; marks intact). It boots a new server only when none is live; stale discovery is cleaned. See *Shared lifecycle: present → live server* below.
- **(f) Gap-closed progress bug.** `ReviewProgress` must count a **comment-only** atom as gap-closed. The port doc already defines accounting as "disposition OR comment"; the browser/dispatch progress counts disposition only, so a comment-only atom can never reach completion. Fix: progress carries `accounted` (disposition ∪ comment).
- **(g) Porcelain "Other changes" bug.** Porcelain LLM grouping lands everything (or nearly) in "Other changes". Root cause confirmed in task #13 (`.agent-state/porcelain-grouping-bug.md`): off-by-one id rendering + a `MAX_TOKENS` truncation that silently falls to the floor — see *Workstream (c)*. Porcelain grouping/lens prompts must also emit the now-mandatory summaries.
- **(h) Invocation discoverability.** `instructions` and the `next` hints must state **exact** invocation shapes: the `--range` flag, the positional payload, and stdin `-`. Field test showed a cold agent cannot tell how to pass a grouping/batch.

## Sequencing

1. **Core** (workstream a) — new event types, summary gate, line-pointer resolution, `accounted`, methodology text + version bump. Unblocks everything. (Task #14.)
2. **CLI + server** (workstream b) — present→live-server handover, `reshape`/live-refresh channel, instructions/`next` shape strings. Depends on 1. (Task #15.)
3. **Porcelain** (workstream c) — fix grouping id mapping, emit summaries, handle the reshape field. Depends on 1–2. (Task #16.)
4. **Web** (workstream d) — line-anchored composer, Reshape affordance, live-refresh subscribe, summary surfacing. Parallel to 3 once 1–2 land. (Task #17.)
5. **Tests** (workstream f) — continuous; e2e gate after 3+4. (Task #18.)
6. **Docs** (workstream e) — concept/ADR/README sweep, same change as the code it documents. (Task #19.)

**Delivery:** each workstream commits to `main` after a passing `bun run lint && bun run test` (and `test:e2e` where it applies). Never `--no-verify`. SSH push works; on push failure verify locally and leave the commit local (team-lead pushes).

---

## Shared lifecycle definitions

Two cross-cutting lifecycles every implementer must hold the same. Defined once here.

### Reshape — request → resolve

A human looking at the grouping can ask the agent to reorganise it (ADR-0012 §3). Modelled as a persisted, review-level request that the next `present` resolves.

- **Request (browser → core):** `ReshapeRequestedEvent { type:"reshape-requested"; ts; body }`. Human-authored (browser channel); `body` is the human's free-text note. One general channel covers ADR-0012's three modes — regroup ("split the tests out"), filter ("show only the public-interface changes"), and question-answered-as-a-view — since the agent chooses how to respond. It is **not** a comment: no `atomHash`, no author tier beyond the implicit human channel, and it never affects counts or the bijection.
- **Resolution marker (core):** every `presentGrouping` appends `PresentedEvent { type:"presented"; ts }` to the log. A reshape is **pending** iff the newest `reshape-requested.ts` is greater than the newest `presented.ts` (a request raised after the last grouping was shown, not yet answered by a fresh one). Re-presenting therefore clears it mechanically — no clear verb.
- **Egress (core → agent):** `DispatchView.reshape: string | null` = the pending request body, else null. The agent reads it on `dispatch`/`dispatch --wait`, regroups (or filters, or answers-as-a-view), and runs `present` again. (`dispatch --wait` already returns the dispatch view on `done`; reshape rides the same payload.) A **filter** response is just a partial grouping — `repairGrouping` sweeps the unplaced rest into "Other changes", so no atom is hidden (ADR-0012 §3).
- **Why a `presented` marker and not "latest grouping file mtime":** `dispatch` recomputes from the **store** across processes (the agent may be a different process than the server). Resolution must be observable from the event log alone. `PresentedEvent` is the log analogue of `CompletedEvent`. ADR-0012 ratifies the reshape *channel* and leaves this resolution mechanism to the plan.

### present → live server (single server per context)

Today `present --open` and the porcelain always `spawnDetachedServer`, so a second `present` for the same context spawns a second server and orphans the first. New rule: at most one server per context; a re-present refreshes the live one.

`present` (and the porcelain's human-loop boot) decision tree, keyed by `readDiscovery(stateDir, context)`:

1. **Live server found** (`info !== null && isAlive(info.pid)`): hand it the new grouping (see channel below). Do **not** spawn. Emit `opened:true` with the existing `info.url` and `"reshaped":true`.
2. **Stale discovery** (`info !== null && !isAlive(info.pid)`): `removeDiscovery`, then boot as in (3).
3. **No discovery**: boot a detached server (today's path).

**Hand-off channel.** `present` connects to the live server over the existing WS (the same `callWait` transport) and calls a new **mutation** `reshape({ context, grouping })`. The server runs `service.presentGrouping(spec, grouping)` (recomputing the master list, ADR-0002), caches the new review, then triggers a **reconnect-broadcast** so every connected browser re-loads the now-current snapshot. Marks are store-persisted (ADR-0005), so the reload re-reads them intact.

**Channel = reconnect-broadcast, NOT a subscription.** ADR-0012 ratifies single-server-with-live-refresh at the concept level and leaves the transport to the plan, but the transport is itself constrained by **ADR-0008** (the pivot's query/mutation-only contract — Risk seam #3 removed all subscriptions). Re-introducing a tRPC **subscription** would reverse that contract — a new cross-boundary streaming channel, which is **human-gated** (CLAUDE.md architecture policy: ADR + explicit owner approval *before* build; the agent stops, does not code around it). Reconnect-broadcast needs no new streaming surface (`reshape` is a plain mutation; the refresh rides the existing reconnect→`snapshot`-query path), so it stays within ADR-0008 and ships without a gate. The subscription is recorded below only as a gated alternative — **do not build it without an ADR-0008 amendment.**

**Stale-discovery cleanup** also runs lazily wherever discovery is read (`dispatch --wait`, porcelain `defaultWait`): a dead pid → treat as no server and `removeDiscovery`.

---

## (a) Core — `packages/core/src`

### Events + projection (`marks.ts`, `model.ts`)

Add three event types and extend the fold:

```ts
// marks.ts
export interface ReshapeRequestedEvent { readonly type: "reshape-requested"; readonly ts: number; readonly body: string; }
export interface PresentedEvent       { readonly type: "presented";          readonly ts: number; }
export type MarkEvent =
  | MarkedEvent | UnmarkedEvent | CommentedEvent | AnsweredEvent | CompletedEvent
  | ReshapeRequestedEvent | PresentedEvent;
```

- `CommentedEvent` gains the optional line pointer (ruling b):
  ```ts
  export interface CommentLinePointer { readonly side: "added" | "removed"; readonly text: string; }
  export interface CommentedEvent {
    readonly type: "commented"; readonly ts: number; readonly atomHash: AtomHash;
    readonly body: string; readonly author: MarkAuthor;
    readonly line?: CommentLinePointer;   // exactOptionalPropertyTypes: omit when absent
  }
  ```
- `project()` extends `ReviewState`:
  ```ts
  export interface ReviewState {
    readonly marks: ReadonlyMap<AtomHash, MarkRecord>;
    readonly comments: readonly Comment[];
    readonly completed: boolean;
    readonly pendingReshape: string | null;   // body of an unresolved reshape request
  }
  ```
  Fold: track `latestReshapeTs`/`latestReshapeBody` on `reshape-requested` and `latestPresentedTs` on `presented`; at the end, `pendingReshape = latestReshapeTs > latestPresentedTs ? latestReshapeBody : null`. Carry the pointer onto `Comment` (`pointer: CommentLinePointer | null`). The `commentId` ordinal logic is unchanged (still ordinal among `commented` events).
- `Comment` (`model.ts`) gains `readonly pointer: CommentLinePointer | null` and `readonly line: number | null` (the resolved location; null until a master list is known — set by the read-time resolver, below).

### Line-pointer resolution (`marks.ts` or `master-list.ts`)

Pure fn, called where the atom is in hand (snapshot/dispatch/atoms build):

```ts
export function resolveCommentLine(atom: Atom, pointer: CommentLinePointer | null): number | null;
//  pointer null            → null (block-level comment; UI anchors at the atom's head line as today)
//  pointer matches a line  → that line's number on its side
//                            (added → newStart + offset-among-added;
//                             removed → oldStart + offset-among-removed)
//  pointer set, no match   → end-of-hunk fallback: the atom's last head line
//                            (newLines>0 ? newStart+newLines-1 : oldStart)
```

Matching is by exact `text` within `atom.lines` filtered to `pointer.side`; first occurrence wins. This is content-addressed: an edit that changes the pointed line drops the match → fallback, never a wrong line. **Marks are untouched** — they remain atom-keyed; the pointer only refines comment display/egress location.

### Summary gate (`grouping.ts`)

```ts
export interface MissingSummary { readonly chapter: number; readonly section: number | null; }
export function findMissingSummaries(proposed: unknown): readonly MissingSummary[];
```

- Runs on the **raw proposal** (pre-repair) so the engine-swept "Other changes" chapter is never in scope. For each proposed chapter: `section:null` entry if the chapter's `summary` is absent/blank; one `{chapter, section}` entry per section with absent/blank `summary`.
- `repairGrouping` is unchanged — this is a **separate** responsibility (ADR-0012 §1: "repair structure, validate summaries"), correctly a separate function the service calls before repair.
- **Share the shape helpers, don't re-parse.** `findMissingSummaries` walks the same `chapters[].sections[]` shape `repairGrouping` already coerces. Export `asRecord`/`asArray`/`summary` from `grouping.ts` (or a small `grouping-shape.ts`) and have the gate consume the **same `summary()` coercion** — so "blank" means identically the same thing in both, with no second drifting parser.

### Service (`review-service.ts`, `ports.ts`)

- **`presentGrouping(spec, grouping, opts?)`** gains `opts?: { readonly requireSummaries?: boolean }` (default `true`):
  - if `requireSummaries !== false`: `const missing = findMissingSummaries(grouping); if (missing.length) throw new SummariesRequiredError(missing);`
  - then repair + cache as today, **and append `PresentedEvent`** (`{ type:"presented", ts: clock.now() }`) so reshape can resolve. Return the snapshot.
  - `SummariesRequiredError` is a core error type carrying `missing: readonly MissingSummary[]` (adapter renders it; see workstream b).
  - **Contract change (call out, do not smuggle):** `presentGrouping` becomes a **log-writing** verb. Today it is documented as a stateless agent verb that recomputes from git and persists nothing (`review-service.ts:10–14`, `ports.ts:201–204`); appending `PresentedEvent` changes that. The change is necessary — reshape resolution must be observable from the event log alone, across processes (the agent may be a different process than the server), exactly as `CompletedEvent` is. Update the `ports.ts`/`review-service.ts` doc comments so the "stateless, no persistence" framing no longer claims `presentGrouping` writes nothing. Idempotency note: N presents append N `presented` events; the fold reads only the latest `ts`, so duplicates are harmless — intended, not incidental.
- **`requestReshape(context, body)`**: append `ReshapeRequestedEvent`; return the fresh snapshot (browser channel; human note).
- **`dispatch(spec)`** → `DispatchView` gains `reshape: string | null` (from `state.pendingReshape`); each `CommentView`/`OpenItem` gains `line: number | null` (resolved pointer). Build via `resolveCommentLine`.
- **`getAtoms`** open items already carry `lineRange`; add resolved `line` for parity.
- **Gap-closed progress (ruling f):** `reviewProgress` gains the commented-hash input and an `accounted` output:
  ```ts
  export function reviewProgress(
    masterList: readonly Atom[],
    marks: ReadonlyMap<AtomHash, MarkRecord>,
    commentedHashes: ReadonlySet<AtomHash>,
  ): ReviewProgress;   // { total, addressed, accounted, unaddressed, byReviewer? }
  ```
  `addressed` = atoms with a disposition (unchanged); `accounted` = atoms with a disposition **or** a comment; `unaddressed = total - addressed`. Every caller (`buildSnapshot`, `dispatch`, `submit`) passes `new Set(state.comments.map(c => c.atomHash))`.
  - **One home for the rule — do not duplicate the loop.** "accounted = disposition ∪ comment, by atom hash" already lives in `buildGapReport` (`review-service.ts:256–265`) with its ADR-0002 identity reasoning. Do **not** add a second independent loop in `reviewProgress` kept equal by a test. Extract a shared predicate `isAccounted(atom, marks, commentedHashes): boolean` (or compute `accounted` in `reviewProgress`'s existing master-list pass and have `buildGapReport` derive its `accounted` from the same predicate). `GapReport.accounted === progress.accounted` then holds by construction, not by policing.
- `ReviewSnapshot` gains `pendingReshape: string | null`; `comments` carry `pointer`/`line`. The completeness gate downstream reads `accounted`.

### Ports / contract surface (`ports.ts`)

Add `requireSummaries` to the `presentGrouping` signature, `requestReshape` to `ReviewService`, `reshape: string | null` to `DispatchView`, `line: number | null` to `OpenItem`/`CommentView`, `accounted: number` to `ReviewProgress`, `pendingReshape` to `ReviewSnapshot`, the `CommentLinePointer` type, and the optional `line` on the `SubmitBatch.comments` item:

```ts
readonly comments?: readonly {
  readonly atomHash: AtomHash; readonly body: string;
  readonly line?: { readonly side: "added" | "removed"; readonly text: string };
}[];
```

### Methodology (`methodology.ts`)

- `export const METHODOLOGY_VERSION = 2;`
- Replace the "Stay lean: aim for about 2–5 chapters…" paragraph with the cognitive-load rule + homogeneous-run exception. Draft:
  > Size by cognitive load, not by count. A Section holds as much *varied* change as a reviewer can grasp at once — roughly one to two pages of diff. Force the reviewer to track more than one idea, split it; restate one idea across Sections, merge them. There is no target number of Chapters or Sections; let the change decide. **Exception — homogeneous runs:** a long run of near-identical change (the same mechanical edit across many files) belongs in **one** Section however large — one idea to verify, not many. Never fragment repetition; never let varied change run long.
- Add a line making the new summary requirement explicit (ruling a): "Give every Chapter and every Section a one-line summary — it is required, not optional." (The schema/gate enforce; the text tells the agent why.)

---

## (b) CLI + server — `packages/node/src`

### present → live-server handover (`cli/verbs.ts`, `cli/serve.ts`, `cli/discovery.ts`)

- `runPresent`: before booting, `readDiscovery` + `isAlive`. Live → call the hand-off (below) instead of `spawnDetachedServer`; stale → `removeDiscovery` then boot; none → boot. Persist the raw grouping to `groupingPath` in all cases (the server re-reads it on reconnect/replay).
- New `cli/reshape-client.ts` (or fold into `wait.ts`): `handReshapeToServer(url, context, grouping): Promise<void>` — a tRPC client over WS calling `reshape.mutate({ context, grouping })`. Same loopback transport `callWait` uses.
- Wire-shape note: `present`'s envelope gains `"reshaped": true` when it handed to a live server (vs `"opened": true` fresh boot), so the agent/porcelain can tell live-refresh from cold boot.

### Live-refresh channel (`server/router.ts`, `server/server.ts`)

**Chosen channel: reconnect-broadcast** — stays inside ADR-0008's query/mutation contract, no new streaming surface, no human gate. (Subscription = stop-and-gate; see the boxed alternative below.)

- New `reshape` **mutation**: `t.procedure.input(z.object({ context, grouping: z.unknown() })).mutation(...)` → `await service.presentGrouping(spec, grouping, { requireSummaries: true })` → `handler.broadcastReconnectNotification()` → return the snapshot. (CLI is the agent channel; presentGrouping carries no author, so no tier-forgery surface.) The grouping is untrusted → repair + summary gate are the backstop, as on the cold path.
- `broadcastReconnectNotification()` is the existing tRPC-ws handler call (already used on `close`, `server.ts:75`). On reshape it tells connected clients to reconnect; on reconnect the browser re-runs the `snapshot` query and gets the new grouping (workstream d). **As built:** the router takes a single optional `broadcastReconnect?: () => void` on `RpcDeps` (`router.ts:46`), which the composition root wires to `handler.broadcastReconnectNotification` — deferred one macrotask so the `reshape` mutation's own result flushes to its caller first (`server.ts:36,63`). That one callback handle was the only buildable seam: the `reshape` mutation lives in the router but the ws handler is constructed by the server, so the router reaches it through a `RpcDeps` field, not directly. **No event bus, no streaming emitter, no subscription** — the architect's concern was the *subscription* emitter, which this avoids; the lone `broadcastReconnect?` callback is not that.
- New `reshapeRequest` mutation (browser → core, ruling d): `reshapeRequest({ context, body })` → `service.requestReshape` → returns the fresh snapshot (the human sees their request acknowledged; the Done gate is unaffected). No broadcast needed — the originating browser already has the new snapshot from the mutation return.
- **Fix the now-stale router invariant comment.** `router.ts:9–13` asserts "the CLI agent never reaches this router for writes". The `reshape` mutation (called by the CLI present-handover client) makes that false. Update the header to distinguish **tier-bearing** writes (human-only, channel-inferred — still true) from **tier-neutral** operations (the `reshape` grouping handover, which may arrive from the CLI present-client and carries no author). Keep the names distinct: `reshape` = agent grouping handover; `reshapeRequest` = human note.

> **Gated alternative — a tRPC `onSnapshot` subscription. DO NOT BUILD without an ADR-0008 amendment + explicit owner approval (the agent stops and routes to the human).** It would push `ReviewSnapshot` to clients directly (lighter, focus-preserving, no reconnect churn) via a server-side emitter held as an adapter transport handle (not `RpcDeps`). It reverses Risk seam #3's subscription removal, so it is a cross-boundary channel change — human-gated by CLAUDE.md. Recorded for completeness only; the plan ships reconnect-broadcast.

### `SummariesRequiredError` rendering (`cli/verbs.ts`, `cli/output.ts`)

`runPresent` catches `SummariesRequiredError` and emits a usage envelope (no browser boot), e.g.:
```json
{ "error": "summaries_required",
  "missing": [{ "chapter": 1, "section": null }, { "chapter": 1, "section": 0 }],
  "next": "Every Chapter and Section needs a one-line summary. Add the missing ones and re-run: cara present <grouping.json>" }
```
No server is spawned on reject, so there is no boot/refresh churn (edge: summary-missing reject loop — it is a pure pre-boot validation; the agent simply re-presents).

### Instructions + next-hint exact shapes (ruling h) (`cli/output.ts`)

The `next` hints and `VERB_REFERENCE` must spell out payload + spec grammar. Concretely:

- `NEXT.atoms` → `"Group into chapters/sections (every chapter & section needs a one-line summary), then: cara present '<grouping-json>'  (inline JSON, a file path, or - for stdin)"`.
- `NEXT.presentNoOpen` / `NEXT.dispatch` / `submitGap` → include `cara submit '<batch-json>'  (inline JSON | file path | -)` and, where a non-default spec applies, `[--range <base>..<head>]`.
- `dispatch` `next` when `view.reshape !== null` → `"The human asked to reshape: \"<body>\". Re-group and run: cara present '<grouping-json>'"` (truncate body).
- `VERB_REFERENCE`: add a "Passing payloads" line — *"present/submit take their JSON inline ('{…}'), as a file path, or from stdin with '-'. The spec defaults to the worktree vs origin/main; pass --range <base>..<head> for a range (or the positional <base>..<head> form on atoms)."* Keep it version-locked (same source as the hints).

These are string changes only; pin them by the existing contract tests (assert each `next` contains `--range`, `-`, and the `'<...>'` payload form).

---

## (c) Porcelain — `cli/review.ts`, `cli/llm.ts`

### "Other changes" grouping bug (ruling g) — root cause

Diagnosed in `.agent-state/porcelain-grouping-bug.md` (task #13). **Three compounding causes in `llm.ts`**, all to fix:

1. **Off-by-one id rendering (primary).** `group()`/`review()` build `idToHash` **1-based** (`req.atoms.map((atom, i) => [i + 1, atom.hash])`) but render with `req.atoms.map(renderForGrouping)` / `.map(renderFull)`, where `Array.map` passes the **0-based** index as the `id` arg. The model sees ids `[0…N-1]`; `idToHash` is keyed `1…N`. So id `0` resolves to nothing (atom[0] only survives by accident when the model's `1` maps to `hash[0]`), every other id maps to the **wrong** atom (one ahead), and the **last atom (index N-1) is never referenced** → always swept to "Other changes". `answer()` is already correct (`renderFull(a, i + 1)`).
   - **Fix:** render 1-based to match `idToHash` — `req.atoms.map((atom, i) => renderForGrouping(atom, i + 1))` and the same in `review()`.
2. **Truncation → silent floor (the severe "ALL atoms" case).** `MAX_TOKENS = 4_000` is too tight for a large diff's grouping output; `stop_reason: "max_tokens"` leaves no parseable `tool_use` block, so `#forcedTool` returns `{}` → `translateGrouping({})` → `{ chapters: [] }` → `repairGrouping` sweeps **every** atom to "Other changes".
   - **Fix:** split the budget — `GROUPING_MAX_TOKENS = 8_000` (must enumerate every id in JSON), keep `REVIEW_MAX_TOKENS = 4_000`. Add a `stop_reason === "max_tokens"` guard in `#forcedTool` that throws a `UserFacingError` ("grouping was too large — try a smaller range") instead of silently returning `{}`. **No silent fallback** (ADR-0011 §7 discipline).
3. **Same off-by-one in `review()`** drops the last atom's marks/comments silently. Fixed by the 1-based render in (1).

**Robustness:** add to the grouping system text "Every change must appear in exactly one section", so `repairGrouping`'s "Other changes" sweep becomes a true anomaly signal, not the normal path.

**Regression tests (porcelain, no network):** (i) a stub returning a well-formed K-chapter grouping over N atoms → exactly K chapters, **no** spurious "Other changes", last atom placed (pins the off-by-one); (ii) `translateGrouping`/`translateFindings` round-trip preserves the last id; (iii) a simulated `max_tokens` truncation → throws, never returns `{}`/empty grouping.

### Mandatory summaries (ruling a)

- `GROUPING_SCHEMA` (`llm.ts`): mark `summary` **required** on both chapter and section objects; tighten the tool description to demand a one-line summary each.
- `translateGrouping` already passes `summary` through; ensure it is a non-empty string (drop to a generated fallback only if the model violates the schema — but prefer to let `presentGrouping`'s gate catch it and retry once).
- `floorGrouping` (git-order, no LLM) has no summaries → call `presentGrouping(spec, grouping, { requireSummaries: false })` on that path. The porcelain composes the service in-process, so it passes the opt-out directly; the plumbing `present` **verb** never opts out (agents must supply summaries).
- Human-loop and headless both: when the LLM path is used, summaries are required; on a `SummariesRequiredError` (model omitted one), retry the grouping call once, then fall to the floor with a logged note (no silent loss).

### Reshape handling (ruling d)

- Human-loop: after a `done` poll, read `dispatch.reshape`. If non-null, the porcelain LLM re-groups (`llm.group`) and re-presents via the **live-server hand-off** (workstream b) — not a fresh boot — so the human's browser live-refreshes. Loop continues (bounded by `MAX_WAIT_ITERS`). If null, proceed to answers as today.
- The porcelain's own `present` boot must use the single-server decision tree (it currently always `spawnDetachedServer`; route through the shared helper).

---

## (d) Web — `apps/web/src`

### Line-anchored comment composer (ruling b)

- `ui/comments.ts`: the composer gains an optional "anchor to this line" affordance. When the human picks a line within the atom (click a diff line, or a small "pin to line" control in the composer), capture `{ side, text }` from that `DiffLine` and pass it to `store.comment(atomHash, body, pointer)`.
- `store.ts` / `backend.ts` / `protocol.ts`: thread the optional `pointer` through `comment(...)`; the `comment` RPC input gains `line?: { side, text }` (zod-validated). Keep it optional — a plain comment stays block-level.
- Render: a comment with a resolved `line` renders its view zone after that line (use `comment.line` when non-null, else today's `headLine(atom)`). Show a subtle "line N" affordance on the comment item.
- Marks unchanged — no line concept on the mark glyph.

### Reshape affordance (ruling d)

- `ui/command-palette.ts`: add a static command `"Reshape this review…"` that opens a small text box (reuse the composer pattern) → `store.requestReshape(body)`.
- `ui/header.ts`: a secondary "Reshape…" button beside Done, same action.
- `store.ts`: `requestReshape(body)` → `backend.requestReshape(context, body)` (new `reshapeRequest` RPC). After it returns the snapshot, show a transient "Reshape requested — waiting for the agent to regroup" hint (the live-refresh will replace the grouping when the agent re-presents).
- Untrusted-text discipline unchanged: the human's reshape body never leaves the browser as markup; it is plain text to the agent.

### Live-refresh (ruling e) — reconnect-reload

- `store.ts` `onConnection`: drop the `snapshot === null` guard so **every** reconnect reloads the snapshot (today it reloads only on first connect). A reshape on the server fires `broadcastReconnectNotification`; the browser reconnects and re-runs the `snapshot` query, picking up the new grouping. Marks/comments come from the snapshot, intact by construction.
- **Preserve focus across the reload.** `loadReview` currently calls `initialFocus` unconditionally; on a reconnect-reload, keep `activeSection` if its `{chapter, section}` path still exists in the new grouping, else fall to `initialFocus`. (Avoids the focus-reset that the subscription would have sidestepped — the one cost of reconnect-broadcast, mitigated here.)
- No subscription client code, no `onSnapshot`. The `reshapeRequest` action's snapshot return updates the originating browser directly (no reconnect needed for the requester).

### Gap-closed progress + summaries (rulings f, a)

- `ui/header.ts`: the "changes left" label and the Done-enable gate read **`accounted`** now (`unaddressed-for-completion = total - accounted`). A comment-only atom counts as gap-closed, so the human can finish. Keep the disposition meter (`addressed/total`) for the fill if desired, but completion = `accounted === total`.
- Summaries are already rendered (`nav.ts`/section headers via `ui/markdown.ts`); no change beyond their now being always present. Optionally surface "missing summary" defensively if a floor grouping (no summaries) is shown — render nothing, not an error.

---

## (e) Docs — sweep with the code (task #19)

- `docs/concept.md`: add Reshape to the semantic-layer/regrouping discussion (a human-initiated regroup request); note gap-closed accounting includes comment-only atoms.
- `docs/adr/0012-field-test-amendments.md` already ratifies the four design rulings (a, b, d, e). This plan's docs task only cross-links it from concept.md/README and fixes any drift; it does not author the ADR.
- `README` / quickstart: update the verb examples to the exact payload forms (`'<json>'` | file | `-`) and `--range`; mention the Reshape loop and that summaries are required.
- `CARA.md` / methodology references: reflect cognitive-load sizing and `METHODOLOGY_VERSION = 2`.
- Run `/streamline-doc` on every doc edited before committing (CLAUDE.md).

---

## (f) Tests

- **Core unit (100%):** reshape fold (`pendingReshape` open/resolved by `presented`; multiple requests; request older than present → null); `resolveCommentLine` (match added/removed, offset arithmetic, no-match → end-of-hunk, null pointer → null); `findMissingSummaries` (chapter-only missing, section missing, all present → empty, floor not in scope); `presentGrouping` rejects missing summaries and appends `PresentedEvent`; `requireSummaries:false` bypasses; `reviewProgress.accounted` (disposition-only, comment-only, both, neither) and `accounted === GapReport.accounted`; `CommentedEvent.line` round-trips through `project`.
- **CLI/server contract:** `present` single-server decision (live → hand-off, stale → clean+boot, none → boot) via injected discovery + `bootServer`/`isAlive` fakes; `reshape` mutation runs `presentGrouping` then `broadcastReconnectNotification`; the web store reloads the snapshot on every reconnect (not just first); `SummariesRequiredError` → `error:"summaries_required"` envelope with the missing list, no boot; every `next` hint and `VERB_REFERENCE` contains `--range`, `-`, and the `'<...>'` payload form (pin ruling h); `dispatch` surfaces `reshape` and a reshape-aware `next`.
- **Porcelain:** the grouping id-mapping regression (well-formed K-chapter grouping → K chapters, no spurious "Other changes"); LLM grouping emits required summaries (stub omitting one → one retry, then floor with note); reshape field drives a re-group + live hand-off (assert hand-off, not re-boot).
- **e2e — three axes (Playwright + spawned bin, scrubbed git env, temp repo):**
  1. Headless: unchanged convergence, plus assert summaries present on the persisted grouping.
  2. Human-in-loop: request a reshape over WS → agent re-presents to the live server → server reconnect-broadcasts → browser reloads the new grouping (live-refresh, marks intact, no second server spawned); comment-only atom lets Done enable.
  3. Standalone wrapper (FakeLLM): grouping has summaries; a forced summary-less stub is rejected then recovered; line-pointed comment resolves and falls back after an edit.

## Edge cases (asserted across the above)

- **Reshape with no live server** (autonomous, or human closed): `requestReshape` still records the event; `dispatch` reports it; the agent re-presents headless (`present --no-open`) — no push, no error.
- **Summary-missing reject loop:** pure pre-boot validation; rejecting never spawns/refreshes a server, so no churn; the agent simply re-presents. No server-side retry counter needed.
- **Line pointer to a context-changed line:** content no longer matches → end-of-hunk fallback (never a wrong line, never a throw).
- **Duplicate `present` race (two presents, same context):** both read discovery; the loser may boot a second server before the winner's discovery write — mitigate by the server overwriting discovery on boot and the hand-off being idempotent (re-present is safe to repeat); last writer's grouping wins, consistent with the marks-are-order-independent model. Document; do not add locking.
- **Stale discovery after a crash:** dead pid cleaned lazily on the next `present`/`dispatch --wait`/porcelain wait.
- **`presented` ordering under a fixed clock:** ts collisions between a reshape-request and a present in the same tick — define the tie as **resolved** (`presented` wins on `>=` from the present side; i.e. pending iff `reshapeTs > presentedTs`, strict), so a same-tick present clears a same-tick request. Pin with a fixed-clock test.

## Out of scope

Everything TN-26-027 deferred (gate/risk tiers, RCR, standing store, fleet, MCP adapter, lens fan-out) stays out. The `byReviewer` last-writer attribution model (verification open item) is a separate owner decision, not this pass. **No new ports, no new streaming channel** — live-refresh rides reconnect-broadcast within ADR-0008's existing query/mutation contract (a tRPC subscription would be a human-gated ADR-0008 change, explicitly out of scope here); no relaxed TS strictness; the master-list bijection and channel-inferred tier invariants are untouched.
