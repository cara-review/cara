---
number: 26-003
title: Core domain — atoms, identity, master list, grouping, marking, and all ports
kind: plan
status: active
issue: "#5"
tags: [core, domain, ports, identity, hexagonal]
---

# TN-26-003: Core domain and port interfaces

Wave 1, critical path. `packages/core` only: pure, zero runtime deps, fully unit-tested with `node --test`. Four adapter agents (DiffSource, ReviewStore, FakeAgent, ReviewService) build against the seams defined here, so seam stability is the priority.

Implements ADR-0002 (two layers + content-hash identity), ADR-0004 (agent-untrusted master list + bijection repair), ADR-0005 (event-log marks projection). Respects ADR-0003 direction: core imports nothing and compiles with `types: []`, so identity hashing is a **pure in-repo SHA-256** (no `node:crypto`, no async Web Crypto).

## Module layout (`packages/core/src`)

```
model.ts          domain + contract types; branded AtomHash / ReviewContext
hash/sha256.ts    pure sync SHA-256 (hex). Tested against known vectors
identity.ts       line normalisation, atom payload, hashAtom
master-list.ts    buildMasterList: RawHunk[] -> Atom[] (deterministic, git order)
grouping.ts       repairGrouping: (masterList, unknown) -> Review (bijection repair)
marks.ts          MarkEvent, project (event fold), disposition rules, completion, progress
ports.ts          all driven ports + inbound ReviewService + request/response shapes
index.ts          barrel re-export
```

## Types (the contract)

- **`RawHunk`** (DiffSource → domain): `status` (added/modified/deleted/renamed), `path` (current), `previousPath` (rename only, else null), old/new start+count ranges, `lines: DiffLine[]` (typed added/removed, git order; `-U0` ⇒ no context lines).
- **`DiffLine`**: `{ kind: "added" | "removed"; text }` — text is the line content, no `+`/`-` prefix.
- **`Atom`** = `RawHunk` shape + `hash: AtomHash`. The indivisible mechanical unit; never surfaced as "atom" to users.

## Identity (ADR-0002)

- **Payload** = added/removed lines in git order, **normalised**, context excluded (there is none under `-U0`). Normalisation: line endings → `\n`, trailing whitespace stripped. Each line serialised as `+`/`-` prefix + normalised text, joined by `\n`.
- **Identity** = `sha256hex(path + "\0" + payload)`. Path included so identical payloads in different files are distinct atoms.
- **Rename-aware path**: `path` is the current location. The domain consumes git's `-M`, so a rename is not exploded into delete+add (which would resurface every line). Deeper cross-run mark-survival across a rename is best-effort, per ADR-0002 ("identity is best-effort, not perfect tracking").
- **Identical payloads collapse to one identity**, so a mark on that hash applies to all. The master list still keeps every hunk as a distinct entry (surface-area count); placement/bijection is tracked by master-list index, not hash (see repair).

## Master list (ADR-0004)

`buildMasterList(hunks): Atom[]` — deterministic, zero agent involvement, preserves git order (DiffSource yields hunks in file-then-position order; we keep it). The canonical set. Counts and completion derive from this, never from the grouping.

## Grouping + deterministic repair (ADR-0004)

`repairGrouping(masterList, proposed: unknown): Review`. The agent's output is the most untrusted input in the system, so the entry point takes `unknown` and is fully defensive.

1. **Coerce** the unknown proposal into chapters → sections → atom-hash references; drop malformed pieces; coerce titles to strings (fallback "Untitled"), summaries to `string | null`.
2. **Bijection over master-list indices** (not hashes, so duplicate-payload atoms stay distinct): each referenced hash claims the smallest still-unplaced master index with that hash; unknown hashes and exhausted references are dropped.
3. **Sweep** every unplaced index into a trailing **"Other changes"** chapter (single section), git order.
4. **Order**: chapters by importance and sections by relevance = the agent's own order, preserved; atoms within a section forced to git order (master index); "Other changes" pinned last. Empty sections/chapters dropped.

Result: ∪ sections == master list, exactly. Garbage in ⇒ everything sweeps to "Other changes" — the "git order, weak chapters" floor (ADR-0004), never broken or partial.

## Marking (ADR-0002, ADR-0005)

- **Disposition** = `done | skipped`, keyed by **atom hash**. Skip ≠ delete — a skipped atom stays in the master list.
- **Event log** (ADR-0005): `MarkEvent` = `marked | unmarked | commented`, each `{ ts, type, atomHash, ... }`. `project(events)` folds to current state (pure). `ts` supplied by `ClockPort` at the service layer.
- **Completion**: a Section completes when every atom in it has a disposition (done *or* skipped — accounted-for). `reviewProgress` derives `{ total, addressed, unaddressed }` from the master list.

## Ports (the seams)

Driven (core defines the interface; adapters infer their impl):

| Port | Shape |
|---|---|
| `DiffSource` | `diff(spec: DiffSpec): Promise<RawHunk[]>` |
| `WorkspaceReader` | `readFile(path, side: FileSide): Promise<string \| null>` |
| `AgentPort` | `proposeGrouping(req: GroupingRequest): Promise<unknown>` — untrusted overlay (ADR-0004) |
| `ReviewStore` | `load(ctx): Promise<MarkEvent[]>`, `append(ctx, event): Promise<void>` (event log, ADR-0005) |
| `EditorPort` | `open(path, line): Promise<void>` |
| `ConfigPort` | `load(): Promise<AppConfig>` |
| `InstructionsSource` | `load(): Promise<ReviewInstructions>` (personal + project `cara.md`) |
| `ClockPort` | `now(): number` (epoch ms) |

Inbound: **`ReviewService`** — `open(spec)`, `mark(ctx, atom, disposition)`, `unmark(ctx, atom)`, `comment(ctx, atom, body)`, `openInEditor(path, line)`; mutations return a fresh `ReviewSnapshot` (review + marks + comments + progress) for the UI to re-render. Snapshot uses plain arrays/records (JSON-friendly for WS, per ADR-0003 "structured data only"). `AgentPort` returns `unknown`; the proposal reaches the UI only after `repairGrouping`.

## Test plan (`node --test`, `.ts`)

- SHA-256 against known vectors (`""`, `"abc"`).
- Identity: normalisation (CRLF, trailing ws), path-distinguishes-identical-payloads, payload excludes ranges.
- Master list: order preserved; hash per atom; duplicate payloads kept as distinct entries.
- Repair: bijection (count in == count out), unknown-hash dropped, duplicate reference, multi-section atom claimed once, full sweep on garbage, "Other changes" pinned last, git order within section.
- Marks: project fold (marked/unmarked/commented), section completion on last mark, skip counts as addressed, progress from master list.

## Out of scope

Adapter implementations (git, fs store, fake agent), the `ReviewService` concrete impl, HTTP/WS, CLI, UI — later waves build against these seams.
