// Domain + contract types for clear-diff core.
//
// Two layers, never mixed (ADR-0002):
//   - Mechanical (git, stable): RawHunk -> Atom, identity by content hash.
//   - Semantic (agent, disposable): Chapter / Section groupings over atoms.
// The agent's grouping is untrusted (ADR-0004); the master list is canonical.

/** Content-hash identity of an atom (ADR-0002). Branded so a raw string is not an id. */
export type AtomHash = string & { readonly __brand: "AtomHash" };

/** Stable per-review key (head branch, `base..head`, or PR number). Survives sessions. */
export type ReviewContext = string & { readonly __brand: "ReviewContext" };

/** Brand a resolved key as a ReviewContext. The DiffSource adapter is the only caller (ADR-0005). */
export function reviewContext(value: string): ReviewContext {
  const key = value.trim();
  if (key.length === 0) throw new Error("ReviewContext cannot be empty.");
  return key as ReviewContext;
}

/** One added or removed line of a hunk. Text is the content, no `+`/`-` prefix. */
export interface DiffLine {
  readonly kind: "added" | "removed";
  readonly text: string;
}

/** What happened to the file a hunk belongs to. */
export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

/**
 * The DiffSource -> domain contract: one git hunk from `git diff -U0 --histogram -M`.
 * `-U0` means there are no context lines, so `lines` is added/removed only.
 */
export interface RawHunk {
  readonly status: ChangeStatus;
  /** Current path (post-rename); the deleted path when status is "deleted". */
  readonly path: string;
  /** The pre-rename path when status is "renamed", else null. */
  readonly previousPath: string | null;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

/** A RawHunk with its computed content-hash identity. The indivisible mechanical unit. */
export interface Atom extends RawHunk {
  readonly hash: AtomHash;
}

// --- Semantic layer: the repaired, canonical review structure ---------------

export interface Section {
  readonly title: string;
  /** Untrusted AI overlay (ADR-0004); null when none. Display-only, never authoritative. */
  readonly summary: string | null;
  /** Atoms in git order. */
  readonly atoms: readonly Atom[];
}

export interface Chapter {
  readonly title: string;
  readonly summary: string | null;
  readonly sections: readonly Section[];
}

export interface Review {
  /** Chapters by importance; sections by relevance; atoms always git order. */
  readonly chapters: readonly Chapter[];
  /** Canonical atom set (ADR-0004). Counts and completion derive from this. */
  readonly masterList: readonly Atom[];
}

// The untrusted agent proposal (ADR-0004) is not a domain type: it arrives as
// `unknown` and is coerced by repairGrouping. Its intended shape is documented there.

// --- Marks (ADR-0002, ADR-0005) ---------------------------------------------

/** A reviewer's disposition of an atom. Skip is not delete (ADR-0004). */
export type Disposition = "done" | "skipped";

/**
 * Who authored a mutating event, inferred from the channel it arrived on (ADR-0011 §5):
 * a browser session is `human`, a CLI invocation is `agent`. There is no override — an
 * agent cannot stamp a mark `human`. `reviewer` (ADR-0011 §6) is an optional descriptive
 * label within the `agent` tier (e.g. "security") so several headless reviewers stay
 * distinguishable; it is always null for `human`.
 */
export interface MarkAuthor {
  readonly tier: "human" | "agent";
  readonly reviewer: string | null;
}

/**
 * An optional within-hunk pointer for a comment (ADR-0012 §2): a single line by content
 * + side, never a line number — the same content-addressed identity rule as marks
 * (ADR-0002). Display metadata only: it never splits an atom, never affects the bijection
 * or counts. Resolved to a location at read time by `resolveCommentLine`; an edit that
 * changes the pointed line drops the match and the comment falls back to the hunk end.
 */
export interface CommentLinePointer {
  readonly side: "added" | "removed";
  readonly text: string;
}

/** A comment drafted against an atom (you direct, the agent writes). */
export interface Comment {
  /** Stable id: "c" + ordinal among the context's commented events. Re-derived on each fold. */
  readonly id: string;
  readonly atomHash: AtomHash;
  readonly body: string;
  readonly ts: number;
  readonly author: MarkAuthor;
  /** Latest answer body for this comment, else null. Untrusted overlay (escape on render). */
  readonly answer: string | null;
  /** Addressed when the reviewed lines were edited away (hash gone) or an answer is attached. */
  readonly status: "open" | "addressed";
  /** The within-hunk line pointer (ADR-0012 §2), else null. Block-level when null. */
  readonly pointer: CommentLinePointer | null;
  /**
   * The resolved location of `pointer` on the live atom (`resolveCommentLine`), else null —
   * null for a block-level comment or when the atom is not in hand at fold time.
   */
  readonly line: number | null;
}

export interface ReviewProgress {
  readonly total: number;
  readonly addressed: number;
  /**
   * Gap-closed: atoms accounted by a disposition OR a comment (ADR-0012 §f). Wider than
   * `addressed` (disposition only) — a comment-only atom is accounted yet still unaddressed.
   * Completion downstream reads `accounted`, so a comment-only atom can reach done.
   */
  readonly accounted: number;
  readonly unaddressed: number;
  /**
   * Scrutiny breakdown per author tier (TN-26-029): of the atoms a tier touched (marked or
   * commented), how many carry a comment from that tier (real engagement) versus a bare
   * disposition (a sweep). The swept count is `accounted - commented`. Dispositioned ≠
   * reviewed — a tier that accounts hundreds but comments on a handful has swept, not
   * scrutinised, them; "471 accounted / 4 commented" is meant to read as the warning it is.
   * A per-tier footprint, not a partition: an atom one tier swept and another commented
   * counts in both rows, so no tier's sweep total is masked by another's comment. Counts are
   * surface-area (per occurrence) like `accounted`. Visibility only: it never gates or
   * blocks. Tiers with nothing accounted are omitted; entries are ordered [human, agent].
   */
  readonly scrutiny: ReadonlyArray<{
    readonly tier: MarkAuthor["tier"];
    readonly accounted: number;
    readonly commented: number;
  }>;
  /**
   * Addressed-atom count per agent reviewer label (ADR-0011 §6), present only when at
   * least one mark carries a label. Descriptive metadata within the `agent` tier — it
   * never affects `total`/`addressed`/`unaddressed`.
   */
  readonly byReviewer?: ReadonlyArray<{ readonly reviewer: string; readonly addressed: number }>;
}
