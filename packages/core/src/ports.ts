// The seams (ADR-0003). Core defines every port interface; adapters in
// packages/node implement them and infer their own types. Inference-first: the
// port interface is the explicit annotation, the implementation is not.

import type {
  Atom,
  AtomHash,
  Comment,
  CommentLinePointer,
  Disposition,
  MarkAuthor,
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

/** Personal (`~/.clear-diff/CLEAR_DIFF.md`) and project (`CLEAR_DIFF.md`) instructions. */
export interface ReviewInstructions {
  readonly personal: string | null;
  readonly project: string | null;
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

// --- Agent verb contract types (ADR-0011) -----------------------------------
//
// What crosses the CLI boundary. The agent is a driving actor: it pulls `atoms`,
// pushes a grouping via `present`, pulls `dispatch`, and pushes a `submit` batch.
// These are plain data (JSON-friendly); no LLM/transport concept appears in them.

/** The `atoms` response (core → agent): everything needed to group and review a round. */
export interface AtomsView {
  readonly context: ReviewContext;
  readonly methodology: string;
  readonly methodologyVersion: number;
  /** The canonical master list, atoms carrying their git-verbatim diff lines (ADR-0004 amended). */
  readonly atoms: readonly Atom[];
  /** Open comments carried from prior rounds, located against the fresh master list. */
  readonly openItems: readonly OpenItem[];
}

/** An open comment positioned in the current change: stable id + identity + live location. */
export interface OpenItem {
  readonly id: string;
  readonly atomHash: AtomHash;
  readonly path: string;
  readonly lineRange: LineRange;
  /** Resolved within-hunk line pointer (ADR-0012 §2), else null (block-level comment). */
  readonly line: number | null;
  readonly body: string;
  readonly answer: string | null;
  readonly status: "open" | "addressed";
}

/** The `dispatch` response (core → agent): every located comment with its lifecycle + author. */
export interface DispatchView {
  readonly context: ReviewContext;
  readonly comments: readonly CommentView[];
  readonly progress: ReviewProgress;
  /** A pending human reshape request (ADR-0012 §3), else null — the agent re-presents to clear it. */
  readonly reshape: string | null;
}

/** An OpenItem with its author tier + reviewer label, for the agent to triage by lens. */
export interface CommentView extends OpenItem {
  readonly tier: "human" | "agent";
  readonly reviewer: string | null;
}

/** The `submit` payload (agent → core): dispositions and/or comments and/or answers, batched. */
export interface SubmitBatch {
  readonly marks?: readonly { readonly atomHash: AtomHash; readonly disposition: Disposition }[];
  readonly comments?: readonly {
    readonly atomHash: AtomHash;
    readonly body: string;
    /** Optional within-hunk line pointer (ADR-0012 §2): content + side, never a number. */
    readonly line?: CommentLinePointer;
  }[];
  readonly answers?: readonly { readonly commentId: string; readonly answer: string }[];
}

/** Completeness accounting over the master list: every atom must carry a disposition or a comment. */
export interface GapReport {
  readonly total: number;
  /**
   * Gap-closed: atoms with a disposition OR a comment. Wider than
   * `ReviewProgress.addressed` (disposition only) — a comment-only atom is accounted
   * but still unaddressed. Counted by atom hash, so identical hunks (shared hash) are
   * accounted together (ADR-0002 identity).
   */
  readonly accounted: number;
  readonly missing: readonly {
    readonly atomHash: AtomHash;
    readonly path: string;
    readonly lineRange: LineRange;
  }[];
}

/** The `submit` response (core → agent): the gap report + full progress. */
export interface SubmitResult {
  readonly gap: GapReport;
  readonly progress: ReviewProgress;
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
  readonly marks: ReadonlyArray<{
    readonly atomHash: AtomHash;
    readonly disposition: Disposition;
    readonly author: MarkAuthor;
  }>;
  readonly comments: readonly Comment[];
  readonly progress: ReviewProgress;
  /** The human has signalled "done reviewing" (ADR-0011 §4). */
  readonly completed: boolean;
  /** A pending human reshape request (ADR-0012 §3), else null. */
  readonly pendingReshape: string | null;
}

/**
 * The single inbound port (ADR-0003): orchestrates the driven ports and holds
 * the use-cases. The agent is a driving actor over a CLI (ADR-0011); grouping
 * arrives inbound. Mutations return a fresh snapshot for the browser to re-render;
 * the agent verbs (`getAtoms`/`dispatch`/`submit`) return their own view shapes.
 *
 * Provenance invariant (ADR-0011 §5): `author` is set by the *adapter from its
 * channel* — a browser session ⇒ `human`, a CLI invocation ⇒ `agent` — never from
 * caller- or payload-supplied data. Core trusts the channel, not the request; an
 * adapter must never thread a request-supplied tier through. Adding a channel concept
 * to core would itself be a boundary leak, so the obligation lives at the adapter.
 *
 * `commentId` (ordinal `c0`/`c1`…) is stable only within a serialized append stream
 * for a context (ADR-0005 makes marks order-independent, but comment ids are ordinal).
 * Concurrent writers to one context must serialize their appends, or re-read ids
 * before answering, so an `answer` cannot mis-target a comment it never saw.
 */
export interface ReviewService {
  /** `atoms` (ADR-0011): master list + merged methodology + carried-over open items. No grouping. */
  getAtoms(spec: DiffSpec): Promise<AtomsView>;
  /**
   * `present` (ADR-0011): repair the untrusted inbound grouping into the review, return its
   * snapshot. Validates that every agent-authored chapter/section carries a summary
   * (ADR-0012 §1) unless `requireSummaries: false` (the git-order floor opt-out) — a missing
   * summary throws `SummariesRequiredError`. Appends a `PresentedEvent` so a reshape request
   * resolves from the event log alone (it is therefore log-writing, not stateless — N presents
   * append N events; the fold reads only the latest, so duplicates are harmless).
   */
  presentGrouping(
    spec: DiffSpec,
    grouping: unknown,
    opts?: { readonly requireSummaries?: boolean },
  ): Promise<ReviewSnapshot>;
  /** `reshape` request (ADR-0012 §3): record a human review-level note; returns the refreshed snapshot. */
  requestReshape(context: ReviewContext, body: string): Promise<ReviewSnapshot>;
  /** The current snapshot for an in-process (browser) review — boot load and re-poll read. */
  snapshot(context: ReviewContext): Promise<ReviewSnapshot>;
  mark(
    context: ReviewContext,
    atomHash: AtomHash,
    disposition: Disposition,
    author: MarkAuthor,
  ): Promise<ReviewSnapshot>;
  unmark(context: ReviewContext, atomHash: AtomHash, author: MarkAuthor): Promise<ReviewSnapshot>;
  comment(
    context: ReviewContext,
    atomHash: AtomHash,
    body: string,
    author: MarkAuthor,
    line?: CommentLinePointer,
  ): Promise<ReviewSnapshot>;
  /** `submit` (ADR-0011): apply a batch of marks/comments/answers, return the gap report. */
  submit(spec: DiffSpec, batch: SubmitBatch, author: MarkAuthor): Promise<SubmitResult>;
  /**
   * `dispatch` (ADR-0011): every located comment with lifecycle + author, recomputed
   * from git. Context is derived from `spec` (one source of identity) — there is no
   * separate context param, so a comment's events and atoms can never key off
   * mismatched reviews.
   */
  dispatch(spec: DiffSpec): Promise<DispatchView>;
  /** The human "done reviewing" signal (ADR-0011 §4) — flips `dispatch --wait` to done. */
  markComplete(context: ReviewContext): Promise<void>;
  openInEditor(path: string, line: number): Promise<void>;
}
