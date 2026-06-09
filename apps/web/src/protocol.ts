// The backend→UI domain types the web renders (ADR-0003, ADR-0008). Re-exported
// type-only from the node package's contract surface — the single source of truth,
// runtime-erased, so no node/server code enters the web bundle. The wire envelope is
// gone: tRPC owns request/response correlation; the typed client infers procedure
// inputs and outputs from `AppRouter`.

export type {
  AtomHash,
  ReviewContext,
  Disposition,
  FileSide,
  DiffLine,
  ChangeStatus,
  RawHunk,
  Atom,
  Section,
  Chapter,
  Review,
  Comment,
  MarkAuthor,
  ReviewProgress,
  ReviewSnapshot,
} from "@clear-diff/node/contract";
