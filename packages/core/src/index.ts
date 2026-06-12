// @clear-diff/core — pure domain + application core (ADR-0003).
// Two layers, never mixed (ADR-0002): mechanical (git, identity) and semantic
// (agent grouping, untrusted per ADR-0004). The agent arranges; git owns truth.
// LLM-free (ADR-0011): the agent is a driving actor over a CLI, not a driven port.

export type {
  AtomHash,
  ReviewContext,
  DiffLine,
  ChangeStatus,
  RawHunk,
  Atom,
  Section,
  Chapter,
  Review,
  Disposition,
  MarkAuthor,
  FactMeta,
  Comment,
  CommentLinePointer,
  ReviewProgress,
} from "./model.ts";
export { reviewContext } from "./model.ts";

export { atomPayload, hashAtom } from "./identity.ts";
export { buildMasterList } from "./master-list.ts";
export {
  repairGrouping,
  findMissingSummaries,
  SummariesRequiredError,
  type MissingSummary,
} from "./grouping.ts";
export {
  project,
  deriveCommentStatus,
  isSectionComplete,
  isAccounted,
  resolveCommentLine,
  reviewProgress,
  repoProgress,
  type MarkedEvent,
  type UnmarkedEvent,
  type CommentedEvent,
  type AnsweredEvent,
  type CompletedEvent,
  type ReshapeRequestedEvent,
  type PresentedEvent,
  type MarkEvent,
  type MarkRecord,
  type ReviewState,
} from "./marks.ts";
export {
  METHODOLOGY_VERSION,
  SYSTEM_METHODOLOGY,
  buildMethodology,
} from "./methodology.ts";
export type {
  DiffSpec,
  DiffSource,
  FileSide,
  WorkspaceReader,
  ReviewInstructions,
  ReviewStore,
  EditorPort,
  LineRange,
  AtomsView,
  AtomView,
  OpenItem,
  DispatchView,
  CommentView,
  SubmitBatch,
  GapReport,
  SubmitResult,
  AppConfig,
  ConfigPort,
  InstructionsSource,
  ClockPort,
  ReviewSnapshot,
  ReviewService,
} from "./ports.ts";
export { createReviewService, type ReviewServiceDeps } from "./review-service.ts";
