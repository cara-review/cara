// Boot the real backend for an e2e run. Two paths, both exercising the genuine
// HTTP/WS server, ReviewService, git adapters, and JSONL store:
//
//   bootReal      — the actual CLI path (runCli → compose → startServer), browser
//                   open suppressed with --no-open. Used by almost every spec.
//   bootWithAgent — compose() with an injected AgentPort (the composition-root test
//                   seam), for specs that need agent-authored summaries.
//
// Each returns the live URL + a close(). One server (own ephemeral port + state
// dir) per test keeps runs isolated and parallel-safe.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentPort } from "@clear-diff/core";
import { parseArgs, runCli } from "../../packages/node/src/cli.ts";
import { compose } from "../../packages/node/src/server/compose.ts";
import { startServer } from "../../packages/node/src/server/server.ts";

export interface BootedServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Built UI assets the CLI/server serve. The suite builds them before Playwright runs. */
function webRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/web/dist");
}

/** The real CLI boot: parses the range, composes the real backend, starts the server. */
export function bootReal(repoDir: string, range: string): Promise<BootedServer> {
  return runCli([range, "--no-open"], { cwd: repoDir, log: () => {} });
}

/** As bootReal, but with an injected agent (composition-root seam). */
export async function bootWithAgent(
  repoDir: string,
  range: string,
  agent: AgentPort,
): Promise<BootedServer> {
  const { spec } = parseArgs([range]); // the canonical range parser, shared with bootReal
  const backend = await compose({
    cwd: repoDir,
    spec,
    stateDir: join(repoDir, ".agent-state", "reviews"),
    agent,
  });
  return startServer(backend, { webRoot: webRoot() });
}
