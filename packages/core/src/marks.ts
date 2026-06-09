// Marking rules and the event-log projection (ADR-0002, ADR-0005).
//
// Marks key off the atom hash — never line numbers, never the agent's grouping.
// Persistence is an append-only event log (ADR-0005); current state is a pure
// fold recomputed on each read. `ts` is stamped by ClockPort at the service layer.
// Every mutating event carries its channel-inferred author (ADR-0011 §5).

import type {
  Atom,
  AtomHash,
  Comment,
  Disposition,
  MarkAuthor,
  ReviewProgress,
  Section,
} from "./model.ts";

export interface MarkedEvent {
  readonly type: "marked";
  readonly ts: number;
  readonly atomHash: AtomHash;
  readonly disposition: Disposition;
  readonly author: MarkAuthor;
}

export interface UnmarkedEvent {
  readonly type: "unmarked";
  readonly ts: number;
  readonly atomHash: AtomHash;
  readonly author: MarkAuthor;
}

export interface CommentedEvent {
  readonly type: "commented";
  readonly ts: number;
  readonly atomHash: AtomHash;
  readonly body: string;
  readonly author: MarkAuthor;
}

export interface AnsweredEvent {
  readonly type: "answered";
  readonly ts: number;
  /** The id of the comment being answered (ADR-0011 §1). Ignored if no such comment exists. */
  readonly commentId: string;
  readonly body: string;
  readonly author: MarkAuthor;
}

/** A context-level "done reviewing" marker (ADR-0011 §4). Persisted so a fresh process reads it. */
export interface CompletedEvent {
  readonly type: "completed";
  readonly ts: number;
}

export type MarkEvent =
  | MarkedEvent
  | UnmarkedEvent
  | CommentedEvent
  | AnsweredEvent
  | CompletedEvent;

/** A disposition with its author, so the UI can badge the mark's tier (ADR-0011 §5). */
export interface MarkRecord {
  readonly disposition: Disposition;
  readonly author: MarkAuthor;
}

export interface ReviewState {
  /** Current disposition per atom hash. Absence means unaddressed. */
  readonly marks: ReadonlyMap<AtomHash, MarkRecord>;
  readonly comments: readonly Comment[];
  /** The human has signalled "done reviewing" (ADR-0011 §4). */
  readonly completed: boolean;
}

/**
 * Fold the event log to current state. Pure; order-dependent (ADR-0005).
 *
 * `commentId` is the ordinal among `commented` events (`c0`, `c1`, …) — deterministic
 * and clock-independent (fixed-clock tests collide on `ts`; the ordinal does not).
 * `status` here reflects only the log (addressed ⟺ answered); the master-list-aware
 * `addressed-by-edit` case is finished by `deriveCommentStatus` where the list is known.
 */
export function project(events: readonly MarkEvent[]): ReviewState {
  const marks = new Map<AtomHash, MarkRecord>();
  const comments: Comment[] = [];
  const indexById = new Map<string, number>();
  let completed = false;
  let ordinal = 0;

  for (const event of events) {
    switch (event.type) {
      case "marked":
        marks.set(event.atomHash, { disposition: event.disposition, author: event.author });
        break;
      case "unmarked":
        marks.delete(event.atomHash);
        break;
      case "commented": {
        const id = `c${ordinal++}`;
        indexById.set(id, comments.length);
        comments.push({
          id,
          atomHash: event.atomHash,
          body: event.body,
          ts: event.ts,
          author: event.author,
          answer: null,
          status: "open",
        });
        break;
      }
      case "answered": {
        const index = indexById.get(event.commentId);
        if (index === undefined) break; // answer to an unknown comment — ignored
        const target = comments[index]!;
        comments[index] = { ...target, answer: event.body, status: "addressed" };
        break;
      }
      case "completed":
        completed = true;
        break;
    }
  }

  return { marks, comments, completed };
}

/**
 * A comment's lifecycle status against the live master list (ADR-0011 §1): addressed
 * when an answer is attached, or when its atom has dropped out of the master list —
 * the reviewed lines were edited, the hash changed, so the fix needs no verb (ADR-0002).
 */
export function deriveCommentStatus(
  comment: Pick<Comment, "atomHash" | "answer">,
  masterListHashes: ReadonlySet<AtomHash>,
): "open" | "addressed" {
  return comment.answer !== null || !masterListHashes.has(comment.atomHash) ? "addressed" : "open";
}

/** A Section completes when every atom in it is addressed (done or skipped). */
export function isSectionComplete(
  section: Section,
  marks: ReadonlyMap<AtomHash, MarkRecord>,
): boolean {
  return section.atoms.length > 0 && section.atoms.every((atom) => marks.has(atom.hash));
}

/**
 * Progress over the canonical master list (ADR-0004), never the grouping. When agent
 * marks carry reviewer labels (ADR-0011 §6), a per-reviewer addressed breakdown is
 * attached; it is absent entirely when no mark is labelled. Marks are one-record-per-atom
 * (last-write-wins), so an atom dispositioned by two reviewer labels is credited to the
 * later writer only — the breakdown is last-writer attribution, not a per-lens tally.
 */
export function reviewProgress(
  masterList: readonly Atom[],
  marks: ReadonlyMap<AtomHash, MarkRecord>,
): ReviewProgress {
  let addressed = 0;
  const byReviewer = new Map<string, number>();
  for (const atom of masterList) {
    const record = marks.get(atom.hash);
    if (record === undefined) continue;
    addressed++;
    const { reviewer } = record.author;
    if (reviewer !== null) byReviewer.set(reviewer, (byReviewer.get(reviewer) ?? 0) + 1);
  }

  const progress: ReviewProgress = {
    total: masterList.length,
    addressed,
    unaddressed: masterList.length - addressed,
  };
  if (byReviewer.size === 0) return progress;
  return {
    ...progress,
    byReviewer: [...byReviewer].map(([reviewer, count]) => ({ reviewer, addressed: count })),
  };
}
