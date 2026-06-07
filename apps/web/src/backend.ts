// The web's single channel to the backend (ADR-0003, ADR-0008): one tRPC client over
// one WebSocket. `Backend` abstracts it so the AppStore unit-tests against a fake (no
// real socket). The `AppRouter` type is imported type-only from the node contract —
// end-to-end type safety from one source of truth, with zero node runtime in the bundle.
// tRPC owns correlation and reconnection; `open` is a subscription streaming grouping
// progress (elapsed ticks, then Section-title reveals) before the snapshot.

import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { AppRouter } from "@clear-diff/node/contract";
import type {
  AtomHash,
  ChatAnswer,
  DispatchReceipt,
  Disposition,
  FileSide,
  ReviewContext,
  ReviewSnapshot,
} from "./protocol.ts";

/** Socket lifecycle the store maps to a connection status. tRPC retries indefinitely. */
export type ConnectionStatus = "open" | "reconnecting";

/** Callbacks for the `open` subscription: progress, then title reveals, then the snapshot. */
export interface OpenHandlers {
  onProgress(elapsedMs: number): void;
  onSection(title: string): void;
  onSnapshot(snapshot: ReviewSnapshot): void;
  onError(message: string): void;
}

/** The backend the AppStore drives. Implemented by the tRPC client; faked in tests. */
export interface Backend {
  onConnection(handler: (status: ConnectionStatus) => void): void;
  /** Open the review and stream grouping progress. tRPC re-subscribes on reconnect. */
  openReview(handlers: OpenHandlers): void;
  mark(context: ReviewContext, atomHash: AtomHash, disposition: Disposition): Promise<ReviewSnapshot>;
  unmark(context: ReviewContext, atomHash: AtomHash): Promise<ReviewSnapshot>;
  comment(context: ReviewContext, atomHash: AtomHash, body: string): Promise<ReviewSnapshot>;
  dispatch(context: ReviewContext): Promise<DispatchReceipt>;
  ask(context: ReviewContext, chapterIndex: number, question: string): Promise<ChatAnswer>;
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
    openReview(handlers) {
      client.open.subscribe(undefined, {
        onData(event) {
          if (event.kind === "progress") handlers.onProgress(event.elapsedMs);
          else if (event.kind === "section") handlers.onSection(event.title);
          else handlers.onSnapshot(event.snapshot);
        },
        onError(error) {
          handlers.onError(error.message);
        },
      });
    },
    mark: (context, atomHash, disposition) => client.mark.mutate({ context, atomHash, disposition }),
    unmark: (context, atomHash) => client.unmark.mutate({ context, atomHash }),
    comment: (context, atomHash, body) => client.comment.mutate({ context, atomHash, body }),
    dispatch: (context) => client.dispatch.mutate({ context }),
    ask: (context, chapterIndex, question) => client.ask.mutate({ context, chapterIndex, question }),
    openInEditor: async (path, line) => {
      await client.openInEditor.mutate({ path, line });
    },
    readFile: (path, side) => client.readFile.query({ path, side }),
  };
}
