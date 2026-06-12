// The type-only contract surface for the web client (ADR-0008): the AppRouter type
// (end-to-end tRPC inference) plus the domain types the UI renders. The web imports
// these *type-only* — runtime-erased, so no node/server code enters the web bundle;
// the enforced boundary is the runtime one (no node runtime in the prod bundle), not
// "no import at all" (ADR-0003 as amended). This subpath stays free of server runtime
// code so importing it never drags the server / node builtins into the web program.

export type { AppRouter } from "./server/router.ts";

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
  CommentLinePointer,
  MarkAuthor,
  ReviewProgress,
  ReviewSnapshot,
} from "@cara/core";
