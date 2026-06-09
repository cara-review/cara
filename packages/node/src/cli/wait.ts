// The `dispatch --wait` client (TN-26-027 §b). Connects to the running browser server
// over its WebSocket and calls the `wait` procedure, which blocks server-side until the
// review settles into one of three states. Transport lives here, off the verb path, so
// the verb logic stays synchronous data-shuffling. The server, not the client, owns the
// blocking and the clock — the client just relays the verdict.

import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { CommentView, ReviewContext, ReviewProgress } from "@clear-diff/core";
import type { AppRouter } from "../server/router.ts";

export type WaitResult =
  | { readonly state: "done"; readonly comments: readonly CommentView[]; readonly progress: ReviewProgress }
  | { readonly state: "reviewInProgress"; readonly progress: ReviewProgress }
  | { readonly state: "reviewIdle"; readonly progress: ReviewProgress };

export interface WaitOptions {
  readonly maxBlockMs?: number;
  readonly idleMs?: number;
}

/** Call the server's `wait` procedure once and relay its three-state verdict. */
export async function callWait(url: string, context: ReviewContext, opts: WaitOptions): Promise<WaitResult> {
  const ws = createWSClient({ url: url.replace(/^http/, "ws") });
  const trpc = createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] });
  try {
    const input: { context: string; maxBlockMs?: number; idleMs?: number } = { context };
    if (opts.maxBlockMs !== undefined) input.maxBlockMs = opts.maxBlockMs;
    if (opts.idleMs !== undefined) input.idleMs = opts.idleMs;
    const result = await trpc.wait.query(input);
    if (result.state === "done") {
      return { state: "done", comments: result.view.comments, progress: result.view.progress };
    }
    return result;
  } finally {
    ws.close();
  }
}
