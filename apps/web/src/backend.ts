// The web's single channel to the backend (ADR-0003, ADR-0008): one tRPC client over
// one WebSocket. `Backend` abstracts it so the AppStore unit-tests against a fake (no
// real socket). The `AppRouter` type is imported type-only from the node contract —
// end-to-end type safety from one source of truth, with zero node runtime in the bundle.
// Grouping is pre-supplied by the CLI (`present` verb) before the browser boots, so
// `snapshot` is a one-shot query (not a subscription): the browser loads it at boot and
// mutations return fresh snapshots.

import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { AppRouter } from "@clear-diff/node/contract";
import type { AtomHash, CommentLinePointer, Disposition, FileSide, ReviewContext, ReviewSnapshot } from "./protocol.ts";

/** Socket lifecycle the store maps to a connection status. tRPC retries indefinitely. */
export type ConnectionStatus = "open" | "reconnecting";

/** The backend the AppStore drives. Implemented by the tRPC client; faked in tests. */
export interface Backend {
  onConnection(handler: (status: ConnectionStatus) => void): void;
  /** Load the current review snapshot (one-shot query, called at boot and on every reconnect). */
  loadSnapshot(context: ReviewContext): Promise<ReviewSnapshot>;
  mark(context: ReviewContext, atomHash: AtomHash, disposition: Disposition): Promise<ReviewSnapshot>;
  unmark(context: ReviewContext, atomHash: AtomHash): Promise<ReviewSnapshot>;
  /**
   * Post a comment on an atom; the optional `pointer` pins it to a specific within-hunk line
   * by content + side (ADR-0012 §2). Absent → block-level comment anchored at the atom.
   */
  comment(context: ReviewContext, atomHash: AtomHash, body: string, pointer?: CommentLinePointer): Promise<ReviewSnapshot>;
  /** Human reshape request (ADR-0012 §3): records the note; agent reads it on dispatch. */
  requestReshape(context: ReviewContext, body: string): Promise<ReviewSnapshot>;
  /** Signal "done reviewing" — the human synchroniser that flips `dispatch --wait` to done. */
  markComplete(context: ReviewContext): Promise<void>;
  openInEditor(path: string, line: number): Promise<void>;
  readFile(path: string, side: FileSide): Promise<{ readonly text: string | null }>;
}

/** Build the live backend: a tRPC client over the same-origin WebSocket. */
export function createBackend(wsUrl: string): Backend {
  const connectionHandlers: Array<(status: ConnectionStatus) => void> = [];
  const socket = createWSClient({
    url: wsUrl,
    onOpen: () => emit("open"),
    onClose: () => emit("reconnecting"),
  });
  const client = createTRPCClient<AppRouter>({ links: [wsLink({ client: socket })] });

  function emit(status: ConnectionStatus): void {
    for (const handler of connectionHandlers) handler(status);
  }

  return {
    onConnection(handler) {
      connectionHandlers.push(handler);
    },
    loadSnapshot: (context) => client.snapshot.query({ context }),
    mark: (context, atomHash, disposition) => client.mark.mutate({ context, atomHash, disposition }),
    unmark: (context, atomHash) => client.unmark.mutate({ context, atomHash }),
    comment: (context, atomHash, body, pointer) =>
      client.comment.mutate({ context, atomHash, body, ...(pointer !== undefined ? { line: pointer } : {}) }),
    requestReshape: (context, body) => client.reshapeRequest.mutate({ context, body }),
    markComplete: async (context) => {
      await client.done.mutate({ context });
    },
    openInEditor: async (path, line) => {
      await client.openInEditor.mutate({ path, line });
    },
    readFile: (path, side) => client.readFile.query({ path, side }),
  };
}
