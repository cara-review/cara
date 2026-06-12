// The application layer (ADR-0003): the single inbound port. Orchestrates the
// driven ports into the use-cases and holds no domain logic of its own — it
// composes the pure domain (master list, repair, marks fold, methodology) over
// the ports.
//
// Adapter-neutral: speaks only port interfaces and domain types. No git, fs,
// HTTP, or LLM specifics ever appear here. The core is LLM-free (ADR-0011): the
// agent is a driving actor over a CLI, grouping arrives inbound as `unknown`.
//
// State: marks live in the ReviewStore (durable, ADR-0005); the computed Review
// (master list + disposable grouping, ADR-0004) is cached per context in memory
// for the browser session, so mark/unmark/comment/answer re-fold marks without
// re-diffing. The stateless agent verbs (`getAtoms`/`submit`/`dispatch`) recompute
// the master list from git each call — deterministic across processes (ADR-0002).
// `presentGrouping` recomputes likewise but additionally appends a `presented` marker
// (ADR-0012 §3), so it alone among the agent verbs is log-writing.

import type { Atom, AtomHash, Comment, Review, ReviewContext } from "./model.ts";
import type {
  ClockPort,
  CommentView,
  DiffSource,
  DiffSpec,
  EditorPort,
  GapReport,
  InstructionsSource,
  LineRange,
  OpenItem,
  ReviewService,
  ReviewSnapshot,
  ReviewStore,
} from "./ports.ts";
import { buildMasterList } from "./master-list.ts";
import { findMissingSummaries, repairGrouping, SummariesRequiredError } from "./grouping.ts";
import { buildMethodology, METHODOLOGY_VERSION } from "./methodology.ts";
import {
  deriveCommentStatus,
  isAccounted,
  project,
  repoProgress,
  resolveCommentLine,
  reviewProgress,
  type ReviewState,
} from "./marks.ts";

/** The driven ports the service orchestrates. Manual constructor injection, no DI framework. */
export interface ReviewServiceDeps {
  readonly diffSource: DiffSource;
  readonly store: ReviewStore;
  readonly instructions: InstructionsSource;
  readonly editor: EditorPort;
  readonly clock: ClockPort;
}

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  // Disposable computed reviews (ADR-0004), cached so browser mutations skip re-grouping.
  const reviews = new Map<ReviewContext, Review>();

  /** Rebuild the snapshot from a cached review and the live event log. */
  async function buildSnapshot(context: ReviewContext, review: Review): Promise<ReviewSnapshot> {
    const state = project(await deps.store.load(context));
    const masterHashes = hashSet(review.masterList);
    const byHash = atomsByHash(review.masterList);
    return {
      context,
      review,
      marks: [...state.marks].map(([atomHash, record]) => ({
        atomHash,
        disposition: record.disposition,
        author: record.author,
      })),
      comments: state.comments.map((comment) => {
        const atom = byHash.get(comment.atomHash);
        return {
          ...comment,
          status: deriveCommentStatus(comment, masterHashes),
          line: atom ? resolveCommentLine(atom, comment.pointer) : null,
        };
      }),
      progress: reviewProgress(review.masterList, state.marks, state.comments),
      completed: state.completed,
      pendingReshape: state.pendingReshape,
    };
  }

  function cachedReview(context: ReviewContext): Review {
    const review = reviews.get(context);
    if (!review) throw new Error(`No open review for context "${context}" — call present first.`);
    return review;
  }

  /**
   * The shared recompute the agent verbs (`getAtoms`/`presentGrouping`/`submit`/
   * `dispatch`) use: resolve the context and rebuild the canonical master list from
   * git. Deterministic across processes (ADR-0002), so each verb is self-contained and
   * one source of identity drives both the event log (context) and the atoms (spec).
   * The recompute itself reads only git; `presentGrouping` additionally appends a
   * `PresentedEvent` (ADR-0012 §3) so reshape resolution is observable from the log.
   */
  async function freshReview(
    spec: DiffSpec,
  ): Promise<{ context: ReviewContext; masterList: readonly Atom[] }> {
    const [rawHunks, context] = await Promise.all([
      deps.diffSource.diff(spec),
      deps.diffSource.resolveContext(spec),
    ]);
    return { context, masterList: buildMasterList(rawHunks) };
  }

  /** Append a mutating event to the live log and return the refreshed browser snapshot. */
  async function appendToReview(
    context: ReviewContext,
    event: Parameters<ReviewStore["append"]>[1],
  ): Promise<ReviewSnapshot> {
    const review = cachedReview(context);
    await deps.store.append(context, event);
    return buildSnapshot(context, review);
  }

  return {
    async getAtoms(spec) {
      const { context, masterList } = await freshReview(spec);
      const methodology = buildMethodology(await deps.instructions.load());
      const state = project(await deps.store.load(context));

      const masterHashes = hashSet(masterList);
      const byHash = atomsByHash(masterList);
      const openItems: OpenItem[] = [];
      for (const comment of state.comments) {
        if (deriveCommentStatus(comment, masterHashes) !== "open") continue; // addressed → not carried
        const atom = byHash.get(comment.atomHash);
        if (atom === undefined) continue; // unreachable for "open" (present ⇒ has atom), defensive
        openItems.push(toOpenItem(comment, atom, "open"));
      }

      const atoms = masterList.map((atom) => ({ ...atom, removedLines: removedLineCount(atom) }));
      return { context, methodology, methodologyVersion: METHODOLOGY_VERSION, atoms, openItems };
    },

    async presentGrouping(spec, grouping, opts) {
      const { context, masterList } = await freshReview(spec);
      if (opts?.requireSummaries !== false) {
        const missing = findMissingSummaries(grouping);
        if (missing.length > 0) throw new SummariesRequiredError(missing);
      }
      const review = repairGrouping(masterList, grouping);
      reviews.set(context, review);
      // Log-writing (ADR-0012 §3): the marker reshape resolution reads from the event log.
      await deps.store.append(context, { type: "presented", ts: deps.clock.now() });
      return buildSnapshot(context, review);
    },

    async requestReshape(context, body) {
      return appendToReview(context, { type: "reshape-requested", ts: deps.clock.now(), body });
    },

    async snapshot(context) {
      return buildSnapshot(context, cachedReview(context));
    },

    async mark(context, atomHash, disposition, author) {
      return appendToReview(context, {
        type: "marked",
        ts: deps.clock.now(),
        atomHash,
        disposition,
        author,
      });
    },

    async unmark(context, atomHash, author) {
      return appendToReview(context, { type: "unmarked", ts: deps.clock.now(), atomHash, author });
    },

    async comment(context, atomHash, body, author, line) {
      return appendToReview(context, {
        type: "commented",
        ts: deps.clock.now(),
        atomHash,
        body,
        author,
        ...(line ? { line } : {}),
      });
    },

    async submit(spec, batch, author) {
      const { context, masterList } = await freshReview(spec);
      // Batch-level descriptive metadata (ADR-0015), stamped on every fact; never gate-trusted.
      const meta = batch.meta ? { meta: batch.meta } : {};

      for (const m of batch.marks ?? []) {
        await deps.store.append(context, {
          type: "marked",
          ts: deps.clock.now(),
          atomHash: m.atomHash,
          disposition: m.disposition,
          author,
          ...meta,
        });
      }
      for (const c of batch.comments ?? []) {
        await deps.store.append(context, {
          type: "commented",
          ts: deps.clock.now(),
          atomHash: c.atomHash,
          body: c.body,
          author,
          ...(c.line ? { line: c.line } : {}),
          ...meta,
        });
      }
      for (const a of batch.answers ?? []) {
        await deps.store.append(context, {
          type: "answered",
          ts: deps.clock.now(),
          commentId: a.commentId,
          body: a.answer,
          author,
          ...meta,
        });
      }

      const state = project(await deps.store.load(context));
      return {
        gap: buildGapReport(masterList, state),
        progress: reviewProgress(masterList, state.marks, state.comments),
      };
    },

    async repoCoverage(spec) {
      // Denominator: this range's live master list (ADR-0004). Numerator: every fact across all
      // contexts, existence-folded by atom hash (ADR-0014) — content reviewed anywhere counts.
      const { context, masterList } = await freshReview(spec);
      const events = await deps.store.loadAll();
      const byPath = new Map<string, Atom[]>();
      for (const atom of masterList) {
        const atoms = byPath.get(atom.path) ?? [];
        atoms.push(atom);
        byPath.set(atom.path, atoms);
      }
      return {
        context,
        progress: repoProgress(masterList, events),
        byFile: [...byPath].map(([path, atoms]) => ({ path, progress: repoProgress(atoms, events) })),
      };
    },

    async dispatch(spec) {
      const { context, masterList } = await freshReview(spec);
      const state = project(await deps.store.load(context));
      const masterHashes = hashSet(masterList);
      const byHash = atomsByHash(masterList);

      // A comment whose atom is gone (the reviewed lines were edited away) is
      // addressed-by-edit with no current location to point the agent at, so it is
      // left out — its mark survives in the log regardless (ADR-0002).
      const comments: CommentView[] = [];
      for (const comment of state.comments) {
        const atom = byHash.get(comment.atomHash);
        if (atom === undefined) continue;
        comments.push({
          ...toOpenItem(comment, atom, deriveCommentStatus(comment, masterHashes)),
          tier: comment.author.tier,
          reviewer: comment.author.reviewer,
          ...(comment.meta ? { meta: comment.meta } : {}),
        });
      }

      return {
        context,
        comments,
        progress: reviewProgress(masterList, state.marks, state.comments),
        reshape: state.pendingReshape,
      };
    },

    async markComplete(context) {
      await deps.store.append(context, { type: "completed", ts: deps.clock.now() });
    },

    async openInEditor(path, line) {
      await deps.editor.open(path, line);
    },
  };
}

/** The canonical hashes of a master list, for membership and status checks. */
function hashSet(masterList: readonly Atom[]): ReadonlySet<AtomHash> {
  return new Set(masterList.map((atom) => atom.hash));
}

/**
 * Index atoms by hash for locating a comment against the live change. When byte-identical
 * hunks share a hash (ADR-0002 identity), the FIRST in git order wins — a comment is
 * hash-keyed (occurrence-agnostic), so its location must be deterministic; git order is the
 * atoms' permanent order, and `repairGrouping` likewise claims the lowest duplicate index first.
 */
function atomsByHash(masterList: readonly Atom[]): ReadonlyMap<AtomHash, Atom> {
  const byHash = new Map<AtomHash, Atom>();
  for (const atom of masterList) if (!byHash.has(atom.hash)) byHash.set(atom.hash, atom);
  return byHash;
}

/** The hashes of every atom carrying a comment — the comment side of accounted (ADR-0012 §f). */
function commentedSet(state: ReviewState): ReadonlySet<AtomHash> {
  return new Set(state.comments.map((comment) => comment.atomHash));
}

/** Project a folded comment onto its live atom as a located OpenItem (line pointer resolved). */
function toOpenItem(comment: Comment, atom: Atom, status: "open" | "addressed"): OpenItem {
  return {
    id: comment.id,
    atomHash: comment.atomHash,
    path: atom.path,
    lineRange: locate(atom),
    line: resolveCommentLine(atom, comment.pointer),
    body: comment.body,
    answer: comment.answer,
    status,
  };
}

/**
 * Completeness over the master list (ADR-0011): an atom is accounted by a disposition
 * OR a comment. This is wider than `ReviewProgress.addressed` (disposition only) — a
 * comment-only atom is accounted (gap-closed) yet still unaddressed (not dispositioned).
 *
 * Accounting is by atom hash (ADR-0002 identity): when byte-identical hunks share a
 * hash, addressing the content accounts every occurrence — marks are hash-keyed and
 * cannot disposition occurrences independently, so content-identity is the only coherent
 * rule. `total` still counts every occurrence (master-list surface area, ADR-0004).
 */
function buildGapReport(masterList: readonly Atom[], state: ReviewState): GapReport {
  const commented = commentedSet(state);
  const missing: GapReport["missing"][number][] = [];
  let accounted = 0;
  for (const atom of masterList) {
    if (isAccounted(atom, state.marks, commented)) accounted++;
    else missing.push({ atomHash: atom.hash, path: atom.path, lineRange: locate(atom) });
  }
  return { total: masterList.length, accounted, missing };
}

/** Removed-line count of an atom — a mechanical fact of its own diff lines (ADR-0002), for the deletion nudge. */
function removedLineCount(atom: Atom): number {
  let count = 0;
  for (const line of atom.lines) if (line.kind === "removed") count++;
  return count;
}

/** An atom's location on the side it lives: head for an edit/add, base for a deletion. */
function locate(atom: Atom): LineRange {
  return atom.status === "deleted"
    ? { start: atom.oldStart, count: atom.oldLines }
    : { start: atom.newStart, count: atom.newLines };
}
