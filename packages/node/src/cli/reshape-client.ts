// The `present` live-server hand-off client (ADR-0012 §4). When a context already has a
// live browser server, `present` hands it the new grouping over the existing WS instead
// of booting a sibling: the server re-runs `presentGrouping` and reconnect-broadcasts, so
// connected browsers re-load the now-current snapshot (live-refresh, marks intact). Same
// loopback transport `callWait` uses — transport lives here, off the verb path.

import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { ReviewContext } from "@clear-diff/core";
import type { AppRouter } from "../server/router.ts";

/**
 * Hand the new grouping to the live server for this context (live-refresh, no new process).
 * `requireSummaries` carries the caller's gate decision (ADR-0012 §1) — false for the
 * git-order floor, so the server never re-rejects the one grouping it must always accept.
 */
export async function handReshapeToServer(
  url: string,
  context: ReviewContext,
  grouping: unknown,
  requireSummaries: boolean,
): Promise<void> {
  const ws = createWSClient({ url: url.replace(/^http/, "ws") });
  const trpc = createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] });
  try {
    await trpc.reshape.mutate({ context, grouping, requireSummaries });
  } finally {
    ws.close();
  }
}
