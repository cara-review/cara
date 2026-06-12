// @cara/node — driven adapters + HTTP/WS server + composition root.
// Depends on core to prove the dependency direction (node → core).
import { buildMasterList, type RawHunk } from "@cara/core";

export { contextHash } from "./context-hash.ts";

export const PACKAGE_ID = "@cara/node";

// Scaffold wiring probe: proves node resolves core across the workspace boundary.
export function coreAtomCount(hunks: readonly RawHunk[]): number {
  return buildMasterList(hunks).length;
}

// Driven adapters (TN-26-006).
export { SystemClock, fixedClock } from "./clock.ts";
export { SpawnEditor, editorArgs } from "./editor.ts";
export { EnvConfig } from "./config.ts";
export { FileInstructions } from "./instructions.ts";

// Driven adapters over git (ADR-0003).
export { GitDiffSource } from "./git/diff-source.ts";
export { GitLedgerStore, LEDGER_REF } from "./git/ledger-store.ts";
export { GitWorkspaceReader } from "./git/workspace-reader.ts";
export { refsForSpec, type GitRef, type SpecRefs } from "./git/refs.ts";

// Driving adapter: composition root + node:http/tRPC server + CLI (TN-26-008, ADR-0008, ADR-0011).
export { compose, composeCore, type CompositionConfig, type CoreBackend } from "./server/compose.ts";
export { createReviewActivity, classifyWait, type ReviewActivity, type WaitDecision } from "./server/activity.ts";
export { startServer, type RunningServer, type ServerOptions } from "./server/server.ts";
export { createAppRouter, type AppRouter, type RpcDeps, type RpcContext } from "./server/router.ts";
export { runCli, parseCommand, CliError, type Command, type CliDeps } from "./cli.ts";
