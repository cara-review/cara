// The seams (ADR-0003). Core defines every port interface; adapters in
// packages/node implement them and infer their own types. Inference-first: the
// port interface is the explicit annotation, the implementation is not.

import type {
  Atom,
  AtomHash,
  Comment,
  Disposition,
  RawHunk,
  Review,
  ReviewContext,
  ReviewProgress,
} from "./model.ts";
import type { MarkEvent } from "./marks.ts";

// --- Driven (secondary) ports -----------------------------------------------

/** What to diff. PR support arrives later (concept.md). */
export type DiffSpec =
  | { readonly kind: "worktree" } // current worktree vs origin/main
  | { readonly kind: "range"; readonly base: string; readonly head: string }
  | { readonly kind: "pr"; readonly number: number };

/** Run git and parse to RawHunks (`git diff -U0 --histogram -M`). GitCli, later GitHubPR. */
export interface DiffSource {
  diff(spec: DiffSpec): Promise<readonly RawHunk[]>;
}

/** Which side of the diff to read a file from. "head" is the worktree for a worktree review. */
export type FileSide = "base" | "head";

/** File content at a ref (`git show`). Null when the file does not exist that side. */
export interface WorkspaceReader {
  readFile(path: string, side: FileSide): Promise<string | null>;
}

/** Personal (`~/.clear-diff.md`) and project (`clear-diff.md`) instructions. */
export interface ReviewInstructions {
  readonly personal: string | null;
  readonly project: string | null;
}

export interface GroupingRequest {
  readonly atoms: readonly Atom[];
  readonly instructions: ReviewInstructions;
}

/**
 * Propose a grouping (structure only) over the atoms — the only untrusted port
 * (ADR-0004). It returns ids + titles + summaries, never the diff. Output is
 * `unknown` and reaches the UI only after repairGrouping. Anthropic, Fake for tests.
 */
export interface AgentPort {
  proposeGrouping(request: GroupingRequest): Promise<unknown>;
}

/**
 * Persist dispositions and comments per context as an append-only event log
 * (ADR-0005). Never holds the atom set (ADR-0004) — that is recomputed live.
 */
export interface ReviewStore {
  load(context: ReviewContext): Promise<readonly MarkEvent[]>;
  append(context: ReviewContext, event: MarkEvent): Promise<void>;
}

/** Open a file at a line in the user's editor (spawn `code` / `zed`). */
export interface EditorPort {
  open(path: string, line: number): Promise<void>;
}

export interface AppConfig {
  /** Command used to open files, e.g. "code" or "zed". Null when unset. */
  readonly editorCommand: string | null;
}

export interface ConfigPort {
  load(): Promise<AppConfig>;
}

export interface InstructionsSource {
  load(): Promise<ReviewInstructions>;
}

/** Timestamps. System clock in production, fixed in tests. */
export interface ClockPort {
  now(): number;
}

// --- Inbound (primary) port -------------------------------------------------

/**
 * Everything the UI needs after any operation. Plain data (JSON-friendly for WS).
 * `review` carries full atoms including their diff `lines` (git-verbatim, ADR-0004);
 * the UI still renders evidence from `WorkspaceReader` file texts and drives
 * decorations from atom ranges (ADR-0003). Lines are structured data, never markup.
 */
export interface ReviewSnapshot {
  readonly context: ReviewContext;
  readonly review: Review;
  readonly marks: ReadonlyArray<{ readonly atomHash: AtomHash; readonly disposition: Disposition }>;
  readonly comments: readonly Comment[];
  readonly progress: ReviewProgress;
}

/**
 * The single inbound port (ADR-0003): orchestrates the driven ports and holds
 * the use-cases. Mutations return a fresh snapshot for the UI to re-render.
 */
export interface ReviewService {
  open(spec: DiffSpec): Promise<ReviewSnapshot>;
  mark(context: ReviewContext, atomHash: AtomHash, disposition: Disposition): Promise<ReviewSnapshot>;
  unmark(context: ReviewContext, atomHash: AtomHash): Promise<ReviewSnapshot>;
  comment(context: ReviewContext, atomHash: AtomHash, body: string): Promise<ReviewSnapshot>;
  openInEditor(path: string, line: number): Promise<void>;
}
