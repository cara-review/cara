// @clear-diff/node — driven adapters + HTTP/WS server + composition root.
// Depends on core to prove the dependency direction (node → core).
import { buildMasterList, type RawHunk } from "@clear-diff/core";

export { JsonlReviewStore } from "./review-store.ts";
export { MarkdownCommentSink } from "./markdown-comment-sink.ts";

export const PACKAGE_ID = "@clear-diff/node";

// Scaffold wiring probe: proves node resolves core across the workspace boundary.
export function coreAtomCount(hunks: readonly RawHunk[]): number {
  return buildMasterList(hunks).length;
}

// Driven adapters (TN-26-006).
export { FakeAgent, FakeAgentChat } from "./fake-agent.ts";
export { AnthropicAgent, AnthropicAgentChat } from "./anthropic-agent.ts";
export { SystemClock, fixedClock } from "./clock.ts";
export { SpawnEditor, editorArgs } from "./editor.ts";
export { EnvConfig } from "./config.ts";
export { FileInstructions } from "./instructions.ts";

// Driven adapters over git (ADR-0003).
export { GitDiffSource } from "./git/diff-source.ts";
export { GitWorkspaceReader } from "./git/workspace-reader.ts";
export { refsForSpec, type GitRef, type SpecRefs } from "./git/refs.ts";

// Driving adapter: composition root + node:http/tRPC server + CLI (TN-26-008, ADR-0008).
export { compose, selectAgent, selectChat, type CompositionConfig } from "./server/compose.ts";
export { startServer, type RunningServer, type ServerOptions } from "./server/server.ts";
export { createAppRouter, type AppRouter, type OpenEvent, type RpcDeps } from "./server/router.ts";
export { runCli, parseArgs, CliError, type CliArgs, type CliDeps } from "./cli.ts";
