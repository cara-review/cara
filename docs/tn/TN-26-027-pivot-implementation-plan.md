---
number: 26-027
title: Pivot implementation plan — LLM-free core, CLI agent protocol, dual-mode
kind: plan
status: active
issue: "#47"
tags: [pivot, plan, core, cli, porcelain, web, agent-protocol, dual-mode, tests]
---

# TN-26-027: Pivot implementation plan

Component plan executing [TN-26-026](TN-26-026-cli-agent-protocol-pivot.md). Pre-supposes the ADR fallout has landed (new CLI-protocol ADR; ADR-0003/0004 amended; ADR-0009 superseded). Precise enough that three implementers (core, CLI/porcelain, web) work without re-deriving decisions. Read TN-26-026 first; it is the ratified intent. Touchpoint inventory: `.agent-state/pivot-audit.md` (task #3).

**End state:** core is a pure, LLM-free, content-addressed accounting engine. One LLM lives in the porcelain, outside the boundary. Four agent-invoked verbs + `instructions` drive everything. Dual-mode (human browser / autonomous CLI) from one bin. Marks carry channel-inferred author tier. No silent fallbacks.

## Sequencing

1. **Core** (axis a) — types, ports, use-case split. Unblocks everything.
2. **Server + CLI verbs** (axis b) — atoms/present/dispatch/submit/instructions over the LLM-free service.
3. **Porcelain** (axis c) — `review` wrapper, toml config, multi-reviewer. Depends on 2.
4. **Web** (axis d) — parallel to 3 once 2 lands (snapshot shape fixed).
5. **Instructions rename + methodology** (axis e) — folds into 1–2.
6. **Tests** (axis f) — continuous; e2e gate after 3+4.

Removals (no back-compat, no aliases — ADR-0004 floor preserved): `AgentPort`, `AgentChat`, `GroupingRequest`, `ChatRequest`, `ChatAnswer`, the `ask`/`open` use-cases. Full touchpoints in the audit.

**Reconciliation with the audit** (`.agent-state/pivot-audit.md`):
- **Label field name = `reviewer`** (ADR-0011 §6), not `label`. The task's "label" and the ADR's `reviewer` are the same field; this plan uses `reviewer` throughout (authoritative).
- **Answers are keyed by `commentId`, not `atomHash`** — ADR-0011 §1 ("`submit {commentId, answer}`"). The audit's `AnsweredEvent{atomHash,...}` is superseded by the `commentId` form below; one atom can carry several comments, so the answer must target a comment.
- **OPEN DECISION — the UI "Go"/`CommentSink` egress.** ADR-0011 says the autonomous deliverable is the event log + verb returns, implying the markdown-file egress is obsolete; the audit marks the UI `dispatch` procedure **KEEP** (human-mode export, separate from the CLI verb). Not settled by the ADR. **This plan keeps `CommentSink`/`MarkdownCommentSink`** and renames the egress use-case `dispatch` → **`exportComments`** to free the verb name; the CLI `dispatch` verb maps to the new `dispatch(context, spec): DispatchView` read. Confirm with the owner at axis-b review — if Go is dropped, delete `CommentSink`/`ReviewDispatch`/`DispatchReceipt`/`MarkdownCommentSink` and `exportComments`.
- **Strict store validator, no migration** (CLAUDE.md — pre-release, no back-compat): `JsonlReviewStore`'s `isMarkEvent` validates the new shapes strictly (author + new event types); existing local `.jsonl` logs are gitignored runtime state and are regenerated, never migrated.

---

## (a) Core — `packages/core/src`

### Author tier (`marks.ts`, `model.ts`)

```ts
// model.ts — provenance, channel-inferred (TN-26-026 decision #5). No override path exists.
export interface MarkAuthor {
  readonly tier: "human" | "agent";
  readonly reviewer: string | null;   // ADR-0011 §6 label e.g. "security"; null for human / unlabelled agent
}
```

- Every mutating event carries `author: MarkAuthor`: `MarkedEvent`, `UnmarkedEvent`, `CommentedEvent`, and the new `AnsweredEvent`.
- `project()` carries author through onto `Comment` and onto the marks map value.
- Marks map value changes from `Disposition` to a record so the UI can badge tier:

```ts
export interface MarkRecord { readonly disposition: Disposition; readonly author: MarkAuthor; }
export interface ReviewState {
  readonly marks: ReadonlyMap<AtomHash, MarkRecord>;
  readonly comments: readonly Comment[];
}
```
`reviewProgress`/`isSectionComplete` only call `.has`/iterate keys — unaffected by the value-type change.

### Comment lifecycle + answers (`marks.ts`, `model.ts`)

```ts
export interface AnsweredEvent {
  readonly type: "answered";
  readonly ts: number;
  readonly commentId: string;       // stable id of the comment being answered
  readonly body: string;            // untrusted markdown overlay (escape on render)
  readonly author: MarkAuthor;
}
export type MarkEvent = MarkedEvent | UnmarkedEvent | CommentedEvent | AnsweredEvent;

export interface Comment {
  readonly id: string;              // stable: "c" + ordinal among commented events for the context
  readonly atomHash: AtomHash;
  readonly body: string;
  readonly ts: number;
  readonly author: MarkAuthor;
  readonly answer: string | null;   // latest answered body for this id, else null
  readonly status: "open" | "addressed";
}
```

- **`commentId` derivation:** ordinal index among `commented` events in the context's log (`c0`, `c1`, …). Deterministic, clock-independent (fixed-clock tests collide on `ts`; ordinal does not), append-only stable.
- **`status` derivation** — pure fn in `marks.ts`, computed where the master list is known (snapshot/dispatch build):
  ```ts
  export function deriveCommentStatus(
    comment: Pick<Comment, "atomHash" | "answer">,
    masterListHashes: ReadonlySet<AtomHash>,
  ): "open" | "addressed";
  // addressed ⟺ answer !== null  OR  !masterListHashes.has(comment.atomHash)
  ```
  Payload-changed = the reviewed lines were edited → atom hash changes → hash drops out of the live master list = addressed-by-edit (no verb needed; TN-26-026 "fixes need no verb"). Answer attached = addressed-by-answer.
- `project()` folds `answered` onto the matching comment by `id` (last write wins); leaves `status` for `deriveCommentStatus` (needs master list).

### Methodology (new `methodology.ts`)

clear-diff owns the methodology (decision #10), version-locked to the `present` grouping schema.
```ts
export const METHODOLOGY_VERSION = 1;
export const SYSTEM_METHODOLOGY: string;   // the canonical loop + grouping importance rules + vocabulary
export function buildMethodology(instructions: ReviewInstructions): string;
```
- `SYSTEM_METHODOLOGY` absorbs the grouping guidance currently hard-coded in `anthropic-agent.ts` `SYSTEM_PROMPT` (Chapters by importance 1–4, Sections by theme, ~2–5 chapters, vocabulary, never expose "atom"/"hunk"). It now lives in core as the single source emitted by `getAtoms` and `clear-diff instructions` — version-locked, no doc drift.
- `buildMethodology` merges system text + `Project reviewer guidance:` (CLEAR_DIFF.md) + `Personal reviewer guidance:` blocks, stamped with `METHODOLOGY_VERSION`.

### Ports (`ports.ts`)

- **Remove:** `AgentPort`, `GroupingRequest`, `AgentChat`, `ChatRequest`, `ChatAnswer`.
- `AppConfig` shrinks to `{ readonly editorCommand: string | null }` (drop `groupingModel` — grouping is no longer a core concern; the porcelain holds llm config in toml, never core).
- Keep: `DiffSource`, `WorkspaceReader`, `ReviewInstructions`, `InstructionsSource`, `ReviewStore`, `EditorPort`, `ClockPort`, `ConfigPort`, `LineRange`. Keep `CommentSink`/`ReviewDispatch`/`DispatchReceipt`/`CommentRecord` pending the Go open-decision (above) — if dropped, remove all four.
- New inbound contract types (below), exported from `index.ts`.

```ts
export interface AtomsView {
  readonly context: ReviewContext;
  readonly methodology: string;
  readonly methodologyVersion: number;
  readonly atoms: readonly Atom[];          // full incl. git-verbatim diff lines (diff-blind clause narrowed, ADR-0004 amended)
  readonly openItems: readonly OpenItem[];  // open comments carried from prior rounds
}
export interface OpenItem {
  readonly id: string;
  readonly atomHash: AtomHash;
  readonly path: string;
  readonly lineRange: LineRange;
  readonly body: string;
  readonly answer: string | null;
  readonly status: "open" | "addressed";    // always "open" in openItems by definition; carried for symmetry
}
export interface DispatchView {
  readonly context: ReviewContext;
  readonly comments: readonly CommentView[];
  readonly progress: ReviewProgress;
}
export interface CommentView extends OpenItem {
  readonly tier: "human" | "agent";
  readonly reviewer: string | null;
}
export interface SubmitBatch {
  readonly marks?: readonly { readonly atomHash: AtomHash; readonly disposition: Disposition }[];
  readonly comments?: readonly { readonly atomHash: AtomHash; readonly body: string }[];
  readonly answers?: readonly { readonly commentId: string; readonly answer: string }[];
}
export interface GapReport {
  readonly total: number;
  readonly accounted: number;                // atoms with a disposition OR a comment
  readonly missing: readonly { readonly atomHash: AtomHash; readonly path: string; readonly lineRange: LineRange }[];
}
export interface SubmitResult { readonly gap: GapReport; readonly progress: ReviewProgress; }
```

### `ReviewService` (`review-service.ts`, `ports.ts`)

```ts
export interface ReviewService {
  getAtoms(spec: DiffSpec): Promise<AtomsView>;
  presentGrouping(spec: DiffSpec, grouping: unknown): Promise<ReviewSnapshot>;
  mark(context: ReviewContext, atomHash: AtomHash, disposition: Disposition, author: MarkAuthor): Promise<ReviewSnapshot>;
  unmark(context: ReviewContext, atomHash: AtomHash, author: MarkAuthor): Promise<ReviewSnapshot>;
  comment(context: ReviewContext, atomHash: AtomHash, body: string, author: MarkAuthor): Promise<ReviewSnapshot>;
  answer(context: ReviewContext, commentId: string, body: string, author: MarkAuthor): Promise<ReviewSnapshot>;
  submit(spec: DiffSpec, batch: SubmitBatch, author: MarkAuthor): Promise<SubmitResult>;
  dispatch(context: ReviewContext, spec: DiffSpec): Promise<DispatchView>;  // agent-read verb (new)
  exportComments(context: ReviewContext): Promise<DispatchReceipt>;          // UI "Go" egress (renamed from old `dispatch`); pending Go open-decision
  markComplete(context: ReviewContext): Promise<void>;   // human "done" signal, for dispatch --wait
  openInEditor(path: string, line: number): Promise<void>;
}
```

- `ReviewServiceDeps`: **drop `agent`, `chat`**. Keep `diffSource`, `store`, `instructions`, `editor`, `clock`, and `sink` (only while Go survives — drop with the egress otherwise). No new ports — methodology is a pure fn; grouping arrives inbound as `unknown`.
- **`getAtoms`**: `buildMasterList(diff(spec))` → resolve context → `buildMethodology(instructions.load())` → load events → `openItems` = open comments (status derived against the fresh master list). Caches the master list per context (in-process; cross-process verbs recompute from git — deterministic).
- **`presentGrouping`**: recompute master list from `spec` (stateless across processes), `repairGrouping(masterList, grouping)` → cache review → `buildSnapshot`. Browser boot is the CLI's job, not the service's.
- **`mark`/`unmark`/`comment`/`answer`**: append the event with `author`, rebuild snapshot. `commentId` is never stored — `project` re-derives it by ordinal on every fold, so the returned id is stable.
- **`submit`**: apply `batch.marks` → `marked` events, `batch.comments` → `commented`, `batch.answers` → `answered`, all with `author`. Then compute `GapReport` over the fresh master list (`accounted` = atoms with disposition or comment). Idempotent enough to resubmit; repeated identical marks just re-append (fold is last-write-wins).
- **`dispatch`** (agent-read verb): load events, recompute master list from `spec`, project comments, derive `status`/`tier`/`reviewer` per comment, return `DispatchView`. Distinct from `exportComments` (the UI Go egress, renamed from the old `dispatch`).
- **`markComplete`**: append a context-level `completed` marker OR signal the server (see §b `wait`) — store the completion in the event log as a `completed` event so a fresh process can read it. Add `CompletedEvent { type:"completed"; ts }` to `MarkEvent`; `project` exposes `completed: boolean`.

`ReviewSnapshot` (`ports.ts`) gains: `marks: { atomHash, disposition, author }[]`; `comments: Comment[]` (now with `id`, `author`, `answer`, `status`); `completed: boolean`.

---

## (b) Server + CLI verbs — `packages/node/src`

### CLI surface (`src/cli/` — split `cli.ts`)

- `src/cli/parse.ts` — argv → command union: `{verb:"atoms"|"present"|"dispatch"|"submit"|"instructions"|"review", spec, flags}`. Bare `clear-diff` → `review` (porcelain). `--pr` still rejected.
- `src/cli/verbs.ts` — the four plumbing verbs + `instructions`. Each composes the **LLM-free** backend, calls the service, prints a JSON envelope with a `next` hint to stdout. **Plumbing verbs never read `[grouping]`/`[llm]` config** (decision #7) — zero key awareness.
- `src/cli/output.ts` — JSON envelope writer; `next` hints (self-narrating protocol, decision #6/#11). One source for hints so they version-lock.
- `src/cli/wait.ts` — `dispatch --wait` client: server discovery + three-state.
- `src/cli/review.ts` — porcelain (axis c).
- `index.ts` bin → `runCli(argv)` dispatches on the parsed verb.

### JSON wire shapes (stdout; one object per invocation)

`clear-diff atoms [spec]`
```json
{ "context": "feature-x",
  "methodology": "…merged text…", "methodologyVersion": 1,
  "atoms": [{ "hash":"…","status":"modified","path":"…","previousPath":null,
              "oldStart":1,"oldLines":0,"newStart":1,"newLines":3,
              "lines":[{"kind":"added","text":"…"}] }],
  "openItems": [{ "id":"c0","atomHash":"…","path":"…","lineRange":{"start":1,"count":3},
                  "body":"…","answer":null,"status":"open" }],
  "next": "Group these into chapters/sections, then run: clear-diff present <grouping.json>" }
```

`clear-diff present [grouping] [--no-open]` — grouping read from a file arg or stdin; shape `{ chapters:[{title,summary?,sections:[{title,summary?,atomHashes:string[]}]}] }`:
```json
{ "context":"feature-x", "opened":true, "url":"http://127.0.0.1:53124",
  "progress":{"total":41,"addressed":0,"unaddressed":41},
  "next":"Wait for the human (they'll say 'done'), or auto-pick-up: clear-diff dispatch --wait" }
```
`--no-open` → `"opened":false`, no `url` (autonomous: grouping persisted, no browser); `next` → "Run: clear-diff submit '{…}'".

`clear-diff dispatch [--wait]` (no `--wait`):
```json
{ "context":"feature-x",
  "comments":[{"id":"c0","atomHash":"…","path":"…","lineRange":{"start":12,"count":1},
               "body":"…","answer":null,"status":"open","tier":"human","reviewer":null}],
  "progress":{"total":41,"addressed":38,"unaddressed":3},
  "next":"Address each open comment — edit code (hash changes → auto-addressed) or run: clear-diff submit '{\"answers\":[…]}'" }
```
`--wait` three-state (adds `state`; payload only on `done`):
```json
{ "state":"done", "comments":[…], "progress":{…}, "next":"Address open comments, or all clear → finish." }
{ "state":"reviewInProgress", "progress":{…}, "next":"Human still reviewing. Re-run: clear-diff dispatch --wait" }
{ "state":"reviewIdle", "progress":{…}, "next":"No UI activity for ~5 min. Stop polling; await the human." }
```

`clear-diff submit <batch>` (batch from arg/stdin; `--label <name>` or `batch.label` → agent label):
```json
{ "context":"feature-x",
  "gap":{"total":41,"accounted":38,"missing":[{"atomHash":"…","path":"…","lineRange":{"start":7,"count":2}}]},
  "progress":{"total":41,"addressed":38,"unaddressed":3},
  "next":"3 atoms unaccounted. Mark or comment each, then resubmit: clear-diff submit '{…}'" }
```
Clean gap → `next`: "All 41 accounted. Review complete."

`clear-diff instructions` — **plain text** (not JSON): `buildMethodology(instructions)` + a verb reference block (the four verbs + the loop), generated from the same source as the `next` hints. Version-locked to `present`.

### Channel-inferred tier (no override — structural)

- **WS/browser → `{tier:"human", label:null}`.** Set in `router.ts` `createContext`; `mark`/`unmark`/`comment`/`answer`/`done` read it. No flag can produce `human` from the CLI.
- **CLI `submit` → `{tier:"agent", label: <--label|batch.label|null>}`.** `atoms`/`present`/`dispatch` are reads (no author).

### Server (`src/server/`)

- `router.ts`:
  - `createContext` → `{ author: { tier:"human", label:null } }`.
  - `mark`/`unmark`/`comment` pass `ctx.author`; add `answer({context,commentId,body})` and `done({context})` (→ `markComplete`) mutations. Remove `ask`. The UI `dispatch` procedure stays (→ `exportComments`, the Go egress) unless Go is dropped; the CLI `dispatch` verb is served by the new `dispatch` use-case, not this procedure.
  - **Activity tracking:** module-level mutable `{ lastEventTs:number, completed:boolean }`; every mutation bumps `lastEventTs = clock.now()`; `done` sets `completed = true`.
  - **`wait` procedure** (`{context, maxBlockMs?, idleMs?}`) — server blocks internally and returns one of the three states:
    - `completed` true → `{state:"done", view:DispatchView}`
    - `now - lastEventTs > idleMs` (~300 000) → `{state:"reviewIdle", progress}`
    - `maxBlockMs` (~240 000) elapsed, still active → `{state:"reviewInProgress", progress}`
    - both thresholds are flags on `dispatch --wait` (`--block-ms`, `--idle-ms`).
- **Server discovery:** `present` (when it boots a server) writes `.agent-state/reviews/<context>/server.json` = `{ url, pid, ts }`; the server deletes it on close. `dispatch --wait` reads it, connects, calls `wait`. **No server file / dead pid** → `dispatch --wait` returns `done` from the store immediately (nothing to wait on — autonomous, or the human already closed).
- `compose.ts`: drop `selectAgent`/`selectChat`/`AnthropicAgent*`/`Fake*`/`MarkdownCommentSink`; service deps shrink to git/store/instructions/editor/clock. `ConfigPort` → `editorCommand` only (toml-backed via the porcelain config; env stays as the test override).
- `contract.ts`: drop `ChatAnswer`; add `Comment`(updated), `DispatchView`, `MarkAuthor` (keep `DispatchReceipt` while Go survives). `OpenEvent` unchanged in spirit; `snapshot` now carries the richer comment/mark shapes.

---

## (c) Porcelain — `clear-diff review` (`src/cli/review.ts`, `src/cli/config.ts`)

The single LLM wrapper. Drives the same plumbing in-process (composes the LLM-free service + an Anthropic client; never shells out to itself).

- **Config (`src/cli/config.ts`)** — `~/.clear-diff/config.toml`, parsed with `smol-toml` (Node-portable; not `Bun.TOML`). Schema (TN-26-026):
  ```toml
  [grouping] mode = "llm"          # "llm" | "git-order"
  [llm]      provider="anthropic"; model="claude-sonnet-4-6"; api_key_env="ANTHROPIC_API_KEY"
  [editor]   command = "code"
  ```
  → `PorcelainConfig { grouping:{mode}, llm:{provider,model,apiKeyEnv}|null, editor:{command:string|null} }`. **No silent fallbacks** (decision #8): missing file → loud error carrying a paste-ready minimal config; `editor.command` feeds the core `ConfigPort`.
- **`review` flow:**
  1. `getAtoms(spec)`.
  2. `grouping.mode`:
     - `"git-order"` → synth a floor grouping (single "Other changes" chapter, or git-order sections) → `presentGrouping`. **No nag.**
     - `"llm"` → **lazy key resolution**: read `process.env[llm.apiKeyEnv]` *only here, at the first LLM call*; empty/unset → loud error (`grouping.mode=llm but $ANTHROPIC_API_KEY is unset`), **never auto-drop to git-order**. Build the grouping prompt from `SYSTEM_METHODOLOGY` (shared with core/instructions) → Anthropic forced-tool call (the `propose_grouping` tool + id→hash relabel transplant from today's `anthropic-agent.ts`) → `presentGrouping`.
  3. Human-in-loop: boot browser via `present`; converge through the human loop. Autonomous: `--no-open` + `submit`/`dispatch` until gap clean.
- **Answer calls (autonomous Q&A):** when an open comment needs an answer, the porcelain LLM reads the atom's diff (the old `AnthropicAgentChat` prompt + untrusted-data fence, moved here, fully outside core) → `submit {answers:[{commentId,answer}]}`.
- **Headless multi-reviewer:** `clear-diff review --autonomous --reviewers security,perf,style` (or `[reviewers]` in toml). N passes, each an LLM review producing marks+comments for its lens → `submit --label <lens>`. Marks/comments carry distinct labels; tiers all `agent`; concurrent JSONL appends are order-independent (ADR-0005 fold). Gap report aggregates across reviewers. Default: one unlabelled reviewer.
- **`FakeAgent`/`FakeAgentChat`** repurpose as porcelain LLM stubs (`src/cli/fake-llm.ts`) for tests/`--fake` — they leave core (core has no AgentPort).

---

## (d) Web — `apps/web/src`

- **Remove the chat pane** (TN-26-022): delete `ui/chat-pane.ts`; strip `ask` from `backend.ts`/`protocol.ts`/`store.ts`/`view.ts`; 3-pane layout (`ui/layout.ts`) → 2-pane (nav + diff). Composer stays freeform (no intent buttons — decision #9).
- **Inline answers:** answers render **at the atom** (in `ui/comments.ts`/`ui/diff-pane.ts`), reusing the **TN-26-023 sanitized renderer** (`ui/markdown.ts`) — now general comment/answer rendering, no longer chat-specific. Untrusted overlay: escape on render, never drives an action.
- **Tier badges on marks:** snapshot marks carry `author{tier,label}`; render a small badge on each mark glyph (`ui/glyph.ts`/`ui/nav.ts`) — `human` vs `agent:<label>`. Lets a human adjudicate an agent pre-review (hybrid mode).
- **Markdown Chapter/Section summaries:** render `chapter.summary`/`section.summary` through `ui/markdown.ts` (sanitized subset) instead of plain text (decision #11).
- **"Done reviewing" control:** a header button → `done` RPC (`markComplete`) — the human synchroniser signal that flips `dispatch --wait` to `done`.
- `store.ts`/`selectors.ts`: thread `comment.status`/`comment.answer`/`mark.author`/`completed` through the snapshot; show open-vs-addressed state on comments.

---

## (e) Instructions rename + methodology (`packages/node/src/instructions.ts`, repo files)

- `FileInstructions`: `PROJECT_FILE` `clear-diff.md` → **`CLEAR_DIFF.md`** (project root); personal `~/.clear-diff.md` → **`~/.clear-diff/CLEAR_DIFF.md`**.
- Rename the repo's own `clear-diff.md` → `CLEAR_DIFF.md`; update references (CLAUDE.md, concept.md, README, ADR-0004/TN cross-refs).
- `atoms` emits the merged methodology = `SYSTEM_METHODOLOGY` (core, owns the loop + grouping rules) + project + personal layers, version-locked to the `present` schema (decision #10). `ReviewInstructions`/`InstructionsSource` ports unchanged.

---

## (f) Tests

- **Core unit — 100% coverage.** New/updated: author-tier fold (`marks.test.ts`); `deriveCommentStatus` (open / addressed-by-answer / addressed-by-edit); `commentId` ordinal stability under fixed clock; `AnsweredEvent`/`CompletedEvent` fold; `GapReport` (accounted = disposition∪comment; missing list); `buildMethodology` (layer merge + version stamp); `getAtoms`/`presentGrouping`/`submit` use-cases (`review-service.test.ts` — drop agent/chat fakes, inject git/store/clock fakes). Removed: `ask` tests, sink/dispatch-egress tests.
- **CLI protocol contract tests** (`src/cli/*.test.ts`): each verb's JSON shape + presence of `next`; tier inference (WS = human, CLI submit = agent+label); `dispatch --wait` three-state via fake clock + injected activity (`done`/`reviewInProgress`/`reviewIdle`); `instructions` emits methodology + verb reference; server-discovery file write/read/cleanup.
- **e2e — three axes** (Playwright + spawned bin, scrubbed `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`, temp repo):
  1. **Headless multi-reviewer:** `atoms` → N×`submit --label` → `dispatch`; assert gap converges to clean, labels/tiers persisted, concurrent appends consistent.
  2. **Agent-session human-in-loop (simulated):** `atoms` → `present --no-open` → simulate human marks/`done` over WS → `dispatch --wait` returns `done` with the marked tree; tier badges = human.
  3. **Standalone wrapper (FakeLLM stub):** bare `clear-diff review` with a stub LLM client → grouping + answers → full converge loop; assert no real key required, no silent fallback.
- **Edge cases (asserted across the above):** empty diff (`atoms` → `[]`, `next` "No changes"); no config (porcelain loud error + sample; plumbing verbs still work); key missing (`mode=llm` → loud error at the LLM call, never git-order); idle abandonment (`reviewIdle`); force-push / worktree change mid-review (master list recomputed; edited-away atoms → comments auto-addressed; `repairGrouping` drops dangling ids, unplaced → "Other changes"; stale marks not counted); submit gap report always returned, resubmit until clean.

## Out of scope

`clear-diff gate`/risk tiers, RCR artifact + verifier, standing/cross-context store, fleet mode, MCP adapter, lens fan-out (TN-26-026). The event-log + tier substrate must not preclude them.
