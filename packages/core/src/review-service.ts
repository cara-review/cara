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

import type { AtomHash, Disposition, Review, ReviewContext } from "./model.ts";
import type {
  AgentPort,
  ClockPort,
  DiffSource,
  EditorPort,
  InstructionsSource,
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
  readonly instructions: InstructionsSource;
  readonly editor: EditorPort;
  readonly clock: ClockPort;
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

    async openInEditor(path: string, line: number) {
      await deps.editor.open(path, line);
    },
  };
}
