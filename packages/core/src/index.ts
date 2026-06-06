// @clear-diff/core — pure domain + application core (ADR-0003).
// Two layers, never mixed (ADR-0002): mechanical (git, identity) and semantic
// (agent grouping, untrusted per ADR-0004). The agent arranges; git owns truth.

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
  Comment,
  ReviewProgress,
} from "./model.ts";

export { atomPayload, hashAtom } from "./identity.ts";
export { buildMasterList } from "./master-list.ts";
export { repairGrouping } from "./grouping.ts";
export {
  project,
  isSectionComplete,
  reviewProgress,
  type MarkedEvent,
  type UnmarkedEvent,
  type CommentedEvent,
  type MarkEvent,
  type ReviewState,
} from "./marks.ts";
export type {
  DiffSpec,
  DiffSource,
  FileSide,
  WorkspaceReader,
  ReviewInstructions,
  GroupingRequest,
  AgentPort,
  ReviewStore,
  EditorPort,
  AppConfig,
  ConfigPort,
  InstructionsSource,
  ClockPort,
  ReviewSnapshot,
  ReviewService,
} from "./ports.ts";
