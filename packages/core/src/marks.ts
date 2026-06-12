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
  CommentLinePointer,
  Disposition,
  FactMeta,
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
  /** Self-reported descriptive metadata (ADR-0015); never gate-trusted. Omitted when none. */
  readonly meta?: FactMeta;
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
  /** Optional within-hunk line pointer (ADR-0012 §2); omitted when block-level. */
  readonly line?: CommentLinePointer;
  /** Self-reported descriptive metadata (ADR-0015); never gate-trusted. Omitted when none. */
  readonly meta?: FactMeta;
}

export interface AnsweredEvent {
  readonly type: "answered";
  readonly ts: number;
  /** The id of the comment being answered (ADR-0011 §1). Ignored if no such comment exists. */
  readonly commentId: string;
  readonly body: string;
  readonly author: MarkAuthor;
  /** Self-reported descriptive metadata (ADR-0015); never gate-trusted. Omitted when none. */
  readonly meta?: FactMeta;
}

/** A context-level "done reviewing" marker (ADR-0011 §4). Persisted so a fresh process reads it. */
export interface CompletedEvent {
  readonly type: "completed";
  readonly ts: number;
}

/**
 * A review-level reshape request (ADR-0012 §3): the human asks the agent to reorganise
 * the grouping. Not a comment — no `atomHash`, no author tier. It is a human note by
 * construction: only the browser channel may call `requestReshape` (the CLI agent never
 * does), so the channel infers the tier as marks/comments do (ADR-0011 §5). It never affects
 * counts or the bijection. `body` is the human's free-text note.
 */
export interface ReshapeRequestedEvent {
  readonly type: "reshape-requested";
  readonly ts: number;
  readonly body: string;
}

/**
 * The log analogue of `present` (the resolution marker for reshape): every `presentGrouping`
 * appends one. A reshape is pending iff the newest reshape-requested `ts` is strictly greater
 * than the newest `presented` `ts`, so re-presenting clears a request mechanically.
 */
export interface PresentedEvent {
  readonly type: "presented";
  readonly ts: number;
}

export type MarkEvent =
  | MarkedEvent
  | UnmarkedEvent
  | CommentedEvent
  | AnsweredEvent
  | CompletedEvent
  | ReshapeRequestedEvent
  | PresentedEvent;

/** A disposition with its author, so the UI can badge the mark's tier (ADR-0011 §5). */
export interface MarkRecord {
  readonly disposition: Disposition;
  readonly author: MarkAuthor;
  /** Self-reported descriptive metadata (ADR-0015); never gate-trusted. Omitted when none. */
  readonly meta?: FactMeta;
}

export interface ReviewState {
  /** Current disposition per atom hash. Absence means unaddressed. */
  readonly marks: ReadonlyMap<AtomHash, MarkRecord>;
  readonly comments: readonly Comment[];
  /** The human has signalled "done reviewing" (ADR-0011 §4). */
  readonly completed: boolean;
  /** Body of an unresolved reshape request (ADR-0012 §3), else null. Cleared by the next present. */
  readonly pendingReshape: string | null;
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
  // Reshape resolution from the log alone (ADR-0012 §3): a request makes it pending; the
  // next present clears it. Decided by log order, not ts magnitude — so a present and a
  // request in the same tick resolve by which came last in the log, never dropping a
  // request that post-dates a present under a fixed clock.
  let pendingReshape: string | null = null;

  for (const event of events) {
    switch (event.type) {
      case "marked":
        marks.set(event.atomHash, {
          disposition: event.disposition,
          author: event.author,
          ...(event.meta ? { meta: event.meta } : {}),
        });
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
          pointer: event.line ?? null,
          line: null, // resolved against the live atom by resolveCommentLine
          ...(event.meta ? { meta: event.meta } : {}),
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
      case "reshape-requested":
        pendingReshape = event.body;
        break;
      case "presented":
        pendingReshape = null;
        break;
    }
  }

  return { marks, comments, completed, pendingReshape };
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

/**
 * Resolve a comment's line pointer to a 1-based location on the atom (ADR-0012 §2). Pure;
 * content-addressed — never a line number from the agent. Matching is by exact `text` on
 * the pointer's side, first occurrence; the location is the side's start plus the offset
 * among that side's lines (added → newStart; removed → oldStart).
 *
 *  - null pointer            → null (block-level comment).
 *  - pointer matches a line  → that line's number on its side.
 *  - pointer set, no match   → end-of-hunk fallback (last head line, or oldStart for a pure
 *                              deletion), so a changed line never resolves to a wrong line.
 */
export function resolveCommentLine(atom: Atom, pointer: CommentLinePointer | null): number | null {
  if (pointer === null) return null;
  const start = pointer.side === "added" ? atom.newStart : atom.oldStart;
  let offset = 0;
  for (const line of atom.lines) {
    if (line.kind !== pointer.side) continue;
    if (line.text === pointer.text) return start + offset;
    offset++;
  }
  return atom.newLines > 0 ? atom.newStart + atom.newLines - 1 : atom.oldStart;
}

/**
 * Gap-closed accounting (ADR-0012 §f, ADR-0011): an atom is accounted by a disposition OR a
 * comment, keyed by hash (ADR-0002 identity). The single home for the rule — both
 * `reviewProgress.accounted` and `buildGapReport` derive from it, so they agree by construction.
 */
export function isAccounted(
  atom: Atom,
  marks: ReadonlyMap<AtomHash, MarkRecord>,
  commentedHashes: ReadonlySet<AtomHash>,
): boolean {
  return marks.has(atom.hash) || commentedHashes.has(atom.hash);
}

/** A Section completes when every atom in it is addressed (done or skipped). */
export function isSectionComplete(
  section: Section,
  marks: ReadonlyMap<AtomHash, MarkRecord>,
): boolean {
  return section.atoms.length > 0 && section.atoms.every((atom) => marks.has(atom.hash));
}

/**
 * Coverage over the canonical master list (ADR-0004), never the grouping. Folded by
 * **existence** over the raw event log (not the last-write-wins `marks` Map): per atom hash
 * we keep the set of distinct disposition authors `(tier, reviewer)` and the set of tiers that
 * commented it, then count those over the master list. So an atom dispositioned by two reviewer
 * labels (or both tiers) credits BOTH, never just the later writer — multi-role coverage on one
 * context is counted, not collapsed.
 *
 * - `addressed` / `unaddressed`: atoms with ≥1 surviving disposition from any role.
 * - `byReviewer[label]`: atoms a given reviewer label dispositioned (absent when no mark is
 *   labelled, ADR-0011 §6).
 * - `scrutiny[tier]`: a per-tier footprint, NOT a partition (TN-26-029) — an atom an agent
 *   swept and a human commented counts in both rows. `accounted` per tier is its sweep
 *   (marked or commented); `commented` is the subset it commented, so a bare-disposition
 *   sweep stays visible regardless of what other tiers did to the same atom.
 * - `accounted`: atoms with ≥1 disposition OR comment from any role.
 *
 * `applyUnmark` distinguishes the two folds (output shape identical, so the gate evaluator
 * and snapshot consumers are untouched):
 * - `true` (single context, ordered log): `unmarked` retracts the atom's footprint for the
 *   *unmarking role only*. A disposition is keyed by its full author identity `(tier, reviewer)`,
 *   so an unmark removes only the matching role's mark — two reviewer labels of the same tier
 *   (e.g. `agent:security` and `agent:perf`) are distinct dispositions, and retracting one leaves
 *   the other (its tier and label) standing. Each role's retraction nets only its own attention.
 * - `false` (repo-wide, ADR-0014 §3): `unmarked` is ignored. Cross-context there is no "later"
 *   to net against, and a `marked` fact is itself evidence the role attended that content; a
 *   marked-then-unmarked atom still counts as attended repo-wide (an over-count bounded by
 *   unmark frequency, acceptable for an advisory readout, ADR-0014 §7).
 */
export function coverageProgress(
  masterList: readonly Atom[],
  events: readonly MarkEvent[],
  applyUnmark: boolean,
): ReviewProgress {
  // Per atom: the set of distinct disposition authors `(tier, reviewer)`, keyed so an unmark
  // retracts exactly the matching role (tier alone is too coarse — two labels share a tier).
  const dispositions = new Map<AtomHash, Map<string, MarkAuthor>>();
  const commentedTiers = new Map<AtomHash, Set<MarkAuthor["tier"]>>();
  const authorKey = (author: MarkAuthor): string => `${author.tier} ${author.reviewer ?? ""}`;
  for (const event of events) {
    if (event.type === "marked") {
      const authors = dispositions.get(event.atomHash) ?? new Map<string, MarkAuthor>();
      authors.set(authorKey(event.author), event.author);
      dispositions.set(event.atomHash, authors);
    } else if (event.type === "unmarked") {
      if (!applyUnmark) continue;
      dispositions.get(event.atomHash)?.delete(authorKey(event.author));
    } else if (event.type === "commented") {
      const tiers = commentedTiers.get(event.atomHash) ?? new Set<MarkAuthor["tier"]>();
      tiers.add(event.author.tier);
      commentedTiers.set(event.atomHash, tiers);
    }
  }

  let addressed = 0;
  let accounted = 0;
  const byReviewer = new Map<string, number>();
  const scrutiny = new Map<MarkAuthor["tier"], { accounted: number; commented: number }>();
  for (const atom of masterList) {
    const authors = dispositions.get(atom.hash);
    const commTiers = commentedTiers.get(atom.hash);
    // Derive the surviving disposition tiers and reviewer labels from the per-author set
    // (an unmark may have emptied it).
    const dispoTiers = new Set<MarkAuthor["tier"]>();
    const dispoLabels = new Set<string>();
    for (const author of authors?.values() ?? []) {
      dispoTiers.add(author.tier);
      if (author.reviewer !== null) dispoLabels.add(author.reviewer);
    }
    const hasDispo = dispoTiers.size > 0;
    const hasComm = commTiers !== undefined && commTiers.size > 0;
    if (hasDispo) {
      addressed++;
      for (const label of dispoLabels) byReviewer.set(label, (byReviewer.get(label) ?? 0) + 1);
    }
    if (!hasDispo && !hasComm) continue;
    accounted++;
    for (const tier of new Set([...dispoTiers, ...(commTiers ?? [])])) {
      const cell = scrutiny.get(tier) ?? { accounted: 0, commented: 0 };
      cell.accounted++;
      if (commTiers?.has(tier)) cell.commented++;
      scrutiny.set(tier, cell);
    }
  }

  const progress: ReviewProgress = {
    total: masterList.length,
    addressed,
    accounted,
    unaddressed: masterList.length - addressed,
    scrutiny: (["human", "agent"] as const).flatMap((tier) => {
      const cell = scrutiny.get(tier);
      return cell ? [{ tier, ...cell }] : [];
    }),
  };
  if (byReviewer.size === 0) return progress;
  return { ...progress, byReviewer: [...byReviewer].map(([reviewer, count]) => ({ reviewer, addressed: count })) };
}

/**
 * Single-context progress: existence-based coverage with `unmarked` applied (the ordered log
 * nets each role's own retractions). See {@link coverageProgress}.
 */
export function reviewProgress(masterList: readonly Atom[], events: readonly MarkEvent[]): ReviewProgress {
  return coverageProgress(masterList, events, true);
}

/**
 * Repo-wide progress (ADR-0014): existence-based coverage over the cross-context fact union
 * (`ReviewStore.loadAll`), with `unmarked` ignored (the input is unordered). See {@link coverageProgress}.
 */
export function repoProgress(masterList: readonly Atom[], events: readonly MarkEvent[]): ReviewProgress {
  return coverageProgress(masterList, events, false);
}
