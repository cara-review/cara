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

/** A comment drafted against an atom (you direct, the agent writes). */
export interface Comment {
  readonly atomHash: AtomHash;
  readonly body: string;
  readonly ts: number;
}

export interface ReviewProgress {
  readonly total: number;
  readonly addressed: number;
  readonly unaddressed: number;
}
