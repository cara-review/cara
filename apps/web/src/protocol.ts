// The backend→UI wire contract (ADR-0003): the JSON shapes and WS method set the
// UI is built against. The backend hosts HTTP (the built UI) and one WebSocket on
// the same origin; the client sends a ClientRequest and the server replies with a
// ServerResponse correlated by `id`. Structured data only — never pre-rendered HTML.
//
// This is a local mirror of the contract documented by the backend (#10). It exists
// so the UI stays self-contained and imports nothing from the backend (ADR-0003: web
// reaches node only over WS). When #10 lands on main, rebase and replace this file's
// types with type-only imports from `@clear-diff/node` — the shapes are identical.

/** Content-hash identity of an atom (ADR-0002). Branded so a raw string is not an id. */
export type AtomHash = string & { readonly __brand: "AtomHash" };

/** Stable per-review key (head branch, `base..head`, or PR number). Display verbatim. */
export type ReviewContext = string & { readonly __brand: "ReviewContext" };

/** A reviewer's disposition of a change. Skip is not delete (ADR-0004). */
export type Disposition = "done" | "skipped";

/** Which side of the diff to read a file from. */
export type FileSide = "base" | "head";

/** One added or removed line. Text is the content, no `+`/`-` prefix. */
export interface DiffLine {
  readonly kind: "added" | "removed";
  readonly text: string;
}

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

/** One git hunk (`git diff -U0`). The indivisible mechanical unit — never surfaced as "atom". */
export interface RawHunk {
  readonly status: ChangeStatus;
  readonly path: string;
  readonly previousPath: string | null;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export interface Atom extends RawHunk {
  readonly hash: AtomHash;
}

export interface Section {
  readonly title: string;
  /** Untrusted AI overlay (ADR-0004); null when none. Escape on render, display-only. */
  readonly summary: string | null;
  readonly atoms: readonly Atom[];
}

export interface Chapter {
  readonly title: string;
  readonly summary: string | null;
  readonly sections: readonly Section[];
}

export interface Review {
  readonly chapters: readonly Chapter[];
  /** Canonical change set (ADR-0004). Counts and completion derive from this. */
  readonly masterList: readonly Atom[];
}

export interface Comment {
  readonly atomHash: AtomHash;
  readonly body: string;
  readonly ts: number;
}

export interface ReviewProgress {
  readonly total: number;
  readonly addressed: number;
  readonly unaddressed: number;
}

/** Confirmation of a `Go` dispatch (ADR-0007). `location` is opaque — display only. */
export interface DispatchReceipt {
  readonly count: number;
  readonly location: string;
}

/** Everything the UI needs after any operation. Plain JSON for the wire. */
export interface ReviewSnapshot {
  readonly context: ReviewContext;
  readonly review: Review;
  readonly marks: ReadonlyArray<{ readonly atomHash: AtomHash; readonly disposition: Disposition }>;
  readonly comments: readonly Comment[];
  readonly progress: ReviewProgress;
}

// --- RPC envelope -----------------------------------------------------------

/** Per-method request params. `open` carries none — the CLI fixes the diff at boot. */
export interface RequestParams {
  open: Record<string, never>;
  mark: {
    readonly context: ReviewContext;
    readonly atomHash: AtomHash;
    readonly disposition: Disposition;
  };
  unmark: { readonly context: ReviewContext; readonly atomHash: AtomHash };
  comment: { readonly context: ReviewContext; readonly atomHash: AtomHash; readonly body: string };
  dispatch: { readonly context: ReviewContext };
  openInEditor: { readonly path: string; readonly line: number };
  readFile: { readonly path: string; readonly side: FileSide };
}

/** Per-method success results. */
export interface ResultMap {
  open: ReviewSnapshot;
  mark: ReviewSnapshot;
  unmark: ReviewSnapshot;
  comment: ReviewSnapshot;
  dispatch: DispatchReceipt;
  openInEditor: null;
  readFile: { readonly text: string | null };
}

export type Method = keyof RequestParams;

export type ClientRequest = {
  [M in Method]: { readonly id: string; readonly method: M; readonly params: RequestParams[M] };
}[Method];

export type ServerResponse =
  | { readonly id: string; readonly ok: true; readonly result: ResultMap[Method] }
  | { readonly id: string; readonly ok: false; readonly error: string };
