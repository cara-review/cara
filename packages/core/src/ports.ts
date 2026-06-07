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
  /**
   * The stable per-review context for a spec (ADR-0005): head branch for a
   * worktree, `base..head` for a range, PR number for a PR. The adapter owns
   * this — context identity is git/source knowledge, not derivable from the
   * spec shape alone, so the domain never computes it.
   */
  resolveContext(spec: DiffSpec): Promise<ReviewContext>;
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

export interface ChatRequest {
  /** The focused Chapter's atoms, carrying their git-verbatim diff `lines`. */
  readonly atoms: readonly Atom[];
  readonly question: string;
  readonly instructions: ReviewInstructions;
}

/**
 * Answer a Chapter-scoped reviewer question (ADR-0009). The sibling of `AgentPort`
 * and the one capability that *reads* diff content — a ratified, narrow relaxation
 * of ADR-0004's diff-blind invariant. It only reads to answer: it never defines or
 * changes the review. Output is `unknown`, validated at the boundary to a string and
 * treated as untrusted overlay text (escape on render, never drives an action).
 * The diff content it receives is attacker-influenced (git content) — a
 * prompt-injection surface the adapter must delimit and never expose tools/secrets to.
 */
export interface AgentChat {
  answer(request: ChatRequest): Promise<unknown>;
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

/** Where a change sits, in the change's own terms. Line numbers, never the agent's grouping. */
export interface LineRange {
  readonly start: number;
  readonly count: number;
}

/**
 * One comment positioned for a downstream actor (ADR-0007): stable identity
 * (atom hash, ADR-0002), current location, and the user-authored body. Built
 * from the master list + comment events — domain-neutral, no sink format in it.
 */
export interface CommentRecord {
  readonly atomHash: AtomHash;
  readonly path: string;
  readonly lineRange: LineRange;
  readonly body: string;
}

/** The payload `Go` pushes out: the accumulated comments, sink-format-agnostic. */
export interface ReviewDispatch {
  readonly comments: readonly CommentRecord[];
}

/**
 * Confirmation of a dispatch. `location` is an opaque locator of what the sink
 * wrote — a file path for MarkdownFile, a URL for a later GitHubPR — the domain
 * never interprets it, only relays it to the UI.
 */
export interface DispatchReceipt {
  readonly count: number;
  readonly location: string;
}

/**
 * Driven egress port (ADR-0007): push the accumulated comments out of the review
 * (the `Go` use-case). MarkdownFile first; GitHubPR later, same port. The domain
 * never knows which sink, nor its output format. Distinct from ReviewStore: that
 * is persistence, this is export.
 */
export interface CommentSink {
  dispatch(context: ReviewContext, payload: ReviewDispatch): Promise<DispatchReceipt>;
}

export interface AppConfig {
  /** Command used to open files, e.g. "code" or "zed". Null when unset. */
  readonly editorCommand: string | null;
  /**
   * Model id for the grouping agent. Grouping is structural, so it defaults to a
   * fast tier; chat keeps a stronger model. The domain never interprets the value —
   * it is an opaque adapter detail threaded to the AgentPort adapter (ADR-0004).
   */
  readonly groupingModel: string;
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
  /** `Go` (ADR-0007): gather the commented atoms into a ReviewDispatch and push it out the sink. */
  dispatch(context: ReviewContext): Promise<DispatchReceipt>;
  /**
   * Chapter-scoped Q&A (ADR-0009): resolve the Chapter's atoms from the live review,
   * have the agent read them to answer the question. Ephemeral — mutates no review state.
   */
  ask(context: ReviewContext, chapterIndex: number, question: string): Promise<ChatAnswer>;
  openInEditor(path: string, line: number): Promise<void>;
}

/** A Q&A answer (ADR-0009): untrusted overlay prose, escape on render. */
export interface ChatAnswer {
  readonly answer: string;
}
