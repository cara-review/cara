// The application layer (ADR-0003): the single inbound port. Orchestrates the
// driven ports into the use-cases and holds no domain logic of its own — it
// composes the pure domain (master list, repair, marks fold) over the ports.
//
// Adapter-neutral: speaks only port interfaces and domain types. No git, fs,
// HTTP, or LLM specifics ever appear here.
//
// State: marks live in the ReviewStore (durable, ADR-0005); the computed Review
// (master list + disposable grouping, ADR-0004) is cached per context in memory
// for the session, so mark/unmark/comment re-fold marks without re-diffing or
// re-calling the agent. A fresh snapshot is rebuilt from the live event log on
// every mutation.

import type { Atom, AtomHash, Disposition, Review, ReviewContext } from "./model.ts";
import type {
  AgentChat,
  AgentPort,
  ClockPort,
  CommentRecord,
  CommentSink,
  DiffSource,
  EditorPort,
  InstructionsSource,
  LineRange,
  ReviewService,
  ReviewSnapshot,
  ReviewStore,
} from "./ports.ts";
import { buildMasterList } from "./master-list.ts";
import { repairGrouping } from "./grouping.ts";
import { project, reviewProgress } from "./marks.ts";

/** The driven ports the service orchestrates. Manual constructor injection, no DI framework. */
export interface ReviewServiceDeps {
  readonly diffSource: DiffSource;
  readonly store: ReviewStore;
  readonly agent: AgentPort;
  readonly chat: AgentChat;
  readonly instructions: InstructionsSource;
  readonly editor: EditorPort;
  readonly clock: ClockPort;
  readonly sink: CommentSink;
}

export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  // Disposable computed reviews (ADR-0004), cached so mutations skip re-grouping.
  const reviews = new Map<ReviewContext, Review>();

  /** Rebuild the snapshot from the cached review and the live event log. */
  async function buildSnapshot(context: ReviewContext, review: Review): Promise<ReviewSnapshot> {
    const { marks, comments } = project(await deps.store.load(context));
    return {
      context,
      review,
      marks: [...marks].map(([atomHash, disposition]) => ({ atomHash, disposition })),
      comments,
      progress: reviewProgress(review.masterList, marks),
    };
  }

  function cachedReview(context: ReviewContext): Review {
    const review = reviews.get(context);
    if (!review) throw new Error(`No open review for context "${context}" — call open first.`);
    return review;
  }

  return {
    async open(spec) {
      const masterList = buildMasterList(await deps.diffSource.diff(spec));
      const proposal = await deps.agent.proposeGrouping({
        atoms: masterList,
        instructions: await deps.instructions.load(),
      });
      const review = repairGrouping(masterList, proposal);

      const context = await deps.diffSource.resolveContext(spec);
      reviews.set(context, review);
      return buildSnapshot(context, review);
    },

    async mark(context: ReviewContext, atomHash: AtomHash, disposition: Disposition) {
      const review = cachedReview(context);
      await deps.store.append(context, {
        type: "marked",
        ts: deps.clock.now(),
        atomHash,
        disposition,
      });
      return buildSnapshot(context, review);
    },

    async unmark(context: ReviewContext, atomHash: AtomHash) {
      const review = cachedReview(context);
      await deps.store.append(context, { type: "unmarked", ts: deps.clock.now(), atomHash });
      return buildSnapshot(context, review);
    },

    async comment(context: ReviewContext, atomHash: AtomHash, body: string) {
      const review = cachedReview(context);
      await deps.store.append(context, {
        type: "commented",
        ts: deps.clock.now(),
        atomHash,
        body,
      });
      return buildSnapshot(context, review);
    },

    async dispatch(context: ReviewContext) {
      const review = cachedReview(context);
      const byHash = new Map(review.masterList.map((atom) => [atom.hash, atom]));
      const { comments } = project(await deps.store.load(context));

      // A comment whose atom is no longer in the master list (the reviewed lines
      // were edited away) has no current location to point a downstream actor at,
      // so it is left out of the dispatch — its mark survives in the log regardless.
      const records: CommentRecord[] = [];
      for (const comment of comments) {
        const atom = byHash.get(comment.atomHash);
        if (atom === undefined) continue;
        records.push({ atomHash: comment.atomHash, path: atom.path, lineRange: locate(atom), body: comment.body });
      }
      return deps.sink.dispatch(context, { comments: records });
    },

    async ask(context: ReviewContext, chapterIndex: number, question: string) {
      const review = cachedReview(context);
      const chapter = review.chapters[chapterIndex];
      if (chapter === undefined) throw new Error(`No Chapter at index ${chapterIndex}.`);
      const atoms = chapter.sections.flatMap((section) => section.atoms);
      const result = await deps.chat.answer({
        atoms,
        question,
        instructions: await deps.instructions.load(),
      });
      return { answer: coerceAnswer(result) };
    },

    async openInEditor(path: string, line: number) {
      await deps.editor.open(path, line);
    },
  };
}

/**
 * Validate the agent's `unknown` answer at the boundary (ADR-0009): a non-empty
 * `answer` string, else a safe fallback. The agent is untrusted, so a malformed or
 * empty response degrades to a message rather than throwing or surfacing raw shape.
 */
function coerceAnswer(result: unknown): string {
  if (typeof result === "object" && result !== null) {
    const answer = (result as Record<string, unknown>)["answer"];
    if (typeof answer === "string" && answer.trim() !== "") return answer;
  }
  return "I couldn't answer that — try rephrasing the question.";
}

/** An atom's location on the side it lives: head for an edit/add, base for a deletion. */
function locate(atom: Atom): LineRange {
  return atom.status === "deleted"
    ? { start: atom.oldStart, count: atom.oldLines }
    : { start: atom.newStart, count: atom.newLines };
}
