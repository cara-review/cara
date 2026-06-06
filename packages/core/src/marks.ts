// Marking rules and the event-log projection (ADR-0002, ADR-0005).
//
// Marks key off the atom hash — never line numbers, never the agent's grouping.
// Persistence is an append-only event log (ADR-0005); current state is a pure
// fold recomputed on each open. `ts` is stamped by ClockPort at the service layer.

import type { Atom, AtomHash, Comment, Disposition, ReviewProgress, Section } from "./model.ts";

export interface MarkedEvent {
  readonly type: "marked";
  readonly ts: number;
  readonly atomHash: AtomHash;
  readonly disposition: Disposition;
}

export interface UnmarkedEvent {
  readonly type: "unmarked";
  readonly ts: number;
  readonly atomHash: AtomHash;
}

export interface CommentedEvent {
  readonly type: "commented";
  readonly ts: number;
  readonly atomHash: AtomHash;
  readonly body: string;
}

export type MarkEvent = MarkedEvent | UnmarkedEvent | CommentedEvent;

export interface ReviewState {
  /** Current disposition per atom hash. Absence means unaddressed. */
  readonly marks: ReadonlyMap<AtomHash, Disposition>;
  readonly comments: readonly Comment[];
}

/** Fold the event log to current state. Pure; order-dependent (ADR-0005). */
export function project(events: readonly MarkEvent[]): ReviewState {
  const marks = new Map<AtomHash, Disposition>();
  const comments: Comment[] = [];
  for (const event of events) {
    switch (event.type) {
      case "marked":
        marks.set(event.atomHash, event.disposition);
        break;
      case "unmarked":
        marks.delete(event.atomHash);
        break;
      case "commented":
        comments.push({ atomHash: event.atomHash, body: event.body, ts: event.ts });
        break;
    }
  }
  return { marks, comments };
}

/** A Section completes when every atom in it is addressed (done or skipped). */
export function isSectionComplete(
  section: Section,
  marks: ReadonlyMap<AtomHash, Disposition>,
): boolean {
  return section.atoms.length > 0 && section.atoms.every((atom) => marks.has(atom.hash));
}

/** Progress over the canonical master list (ADR-0004), never the grouping. */
export function reviewProgress(
  masterList: readonly Atom[],
  marks: ReadonlyMap<AtomHash, Disposition>,
): ReviewProgress {
  const addressed = masterList.reduce((n, atom) => (marks.has(atom.hash) ? n + 1 : n), 0);
  return { total: masterList.length, addressed, unaddressed: masterList.length - addressed };
}
