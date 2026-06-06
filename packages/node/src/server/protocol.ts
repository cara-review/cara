// The backend→UI wire contract (ADR-0003): the JSON shapes and WS method set the
// web UI is built against. It carries domain data *outward* — it imports core
// domain types but never pushes HTTP/WS/JSON concepts back into the domain.
//
// One persistent WebSocket connection. The client sends a ClientRequest; the
// server replies with a ServerResponse correlated by `id`. Structured data only:
// snapshots (atoms with hash + ranges + git-verbatim lines) and file texts —
// never pre-rendered diff HTML (ADR-0003), so any viewer/front-end stays
// swappable and drives folding/decorations from atom ranges itself.

import type {
  AtomHash,
  Disposition,
  FileSide,
  ReviewContext,
  ReviewSnapshot,
} from "@clear-diff/core";

/**
 * Per-method request params. `open` carries none: the CLI fixes the DiffSpec at
 * boot, so the UI never constructs git-ish ref strings (leakage avoidance).
 */
export interface RequestParams {
  open: Record<string, never>;
  mark: {
    readonly context: ReviewContext;
    readonly atomHash: AtomHash;
    readonly disposition: Disposition;
  };
  unmark: { readonly context: ReviewContext; readonly atomHash: AtomHash };
  comment: { readonly context: ReviewContext; readonly atomHash: AtomHash; readonly body: string };
  openInEditor: { readonly path: string; readonly line: number };
  readFile: { readonly path: string; readonly side: FileSide };
}

/** Per-method success results. `readFile` backs the UI's evidence rendering. */
export interface ResultMap {
  open: ReviewSnapshot;
  mark: ReviewSnapshot;
  unmark: ReviewSnapshot;
  comment: ReviewSnapshot;
  openInEditor: null;
  readFile: { readonly text: string | null };
}

export type Method = keyof RequestParams;

/** A client→server request, correlated to its response by `id`. */
export type ClientRequest = {
  [M in Method]: { readonly id: string; readonly method: M; readonly params: RequestParams[M] };
}[Method];

/** A server→client response. `ok:false` carries a human-readable error message. */
export type ServerResponse =
  | { readonly id: string; readonly ok: true; readonly result: ResultMap[Method] }
  | { readonly id: string; readonly ok: false; readonly error: string };
