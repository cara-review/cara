// The detached browser server (ADR-0011). `present --open` spawns this as a
// separate, long-lived process so the verb itself returns promptly while the human's
// browser session keeps running. The child re-composes the LLM-free backend, replays
// the persisted grouping to cache the review, boots the localhost server, and writes
// the discovery record `dispatch --wait` reads. All browser/transport/process-lifecycle
// concerns live here; the domain knows nothing of them.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClockPort, ConfigPort, DiffSpec, ReviewContext } from "@clear-diff/core";
import { compose, composeOverrides } from "../server/compose.ts";
import { startServer } from "../server/server.ts";
import { parseJson } from "./output.ts";
import { groupingPath, isAlive, readDiscovery, removeDiscovery, writeDiscovery } from "./discovery.ts";
import type { PresentCommand, ServeCommand } from "./parse.ts";

export interface ServeContext {
  readonly cwd: string;
  readonly stateDir: string;
  readonly config?: ConfigPort;
  readonly clock?: ClockPort;
}

/** The `--range` argv that reproduces a spec for the spawned child (worktree → none). */
function rangeArgs(spec: DiffSpec): string[] {
  return spec.kind === "range" ? ["--range", `${spec.base}..${spec.head}`] : [];
}

/** Locate the built UI assets, or undefined if not built (placeholder page then). */
function resolveWebRoot(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  // Published: this module is inlined into dist/index.js, so `here` is dist → dist/web.
  // Dev: this file is packages/node/src/cli → assets at repo apps/web/dist (four up).
  const candidates = [resolve(here, "web"), resolve(here, "../../../../apps/web/dist")];
  return candidates.find((path) => existsSync(path));
}

/** Open the URL in a chromium `--app` window (macOS-first), falling back to the OS opener. */
function openApp(url: string): void {
  const child = spawn("open", ["-na", "Google Chrome", "--args", `--app=${url}`], {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => spawn("open", [url], { stdio: "ignore", detached: true }).unref());
  child.unref();
}

/**
 * Child entry: boot the long-lived server and keep the process alive. Resolves once
 * the discovery record is written — the listening socket then holds the event loop, so
 * the process lives on serving the browser until it is signalled or the human closes.
 */
export async function runServe(cmd: ServeCommand, ctx: ServeContext): Promise<void> {
  const backend = await compose({ cwd: ctx.cwd, spec: cmd.spec, stateDir: ctx.stateDir, ...composeOverrides(ctx) });
  const grouping = parseJson(await readFile(cmd.groupingPath, "utf8"));
  const snapshot = await backend.service.presentGrouping(cmd.spec, grouping);
  const context = snapshot.context;

  const webRoot = resolveWebRoot();
  const server = await startServer(backend, webRoot !== undefined ? { webRoot } : {});
  await writeDiscovery(ctx.stateDir, context, { url: server.url, pid: process.pid, ts: backend.clock.now() });

  const shutdown = (): void => {
    void removeDiscovery(ctx.stateDir, context).then(() => server.close());
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  if (cmd.openBrowser) openApp(appUrl(server.url, context));
}

/** The browser entry URL: `main.ts` reads the review context from `?context=`. */
export function appUrl(serverUrl: string, context: ReviewContext): string {
  return `${serverUrl}?context=${encodeURIComponent(context)}`;
}

/** Poll for the discovery record a freshly-spawned server writes once it is listening. */
async function awaitServer(stateDir: string, context: ReviewContext, timeoutMs: number): Promise<{ url: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const info = await readDiscovery(stateDir, context);
    if (info && isAlive(info.pid)) return { url: info.url };
    if (Date.now() >= deadline) throw new Error("Timed out booting the review server.");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Parent helper: persist the grouping, spawn the detached server, and wait for it to
 * announce its URL. The same bin re-invokes itself as `serve`, so dev (`bun index.js`)
 * and the published Node bin both work without knowing which they are.
 */
export async function spawnDetachedServer(args: {
  readonly cmd: PresentCommand;
  readonly context: ReviewContext;
  readonly stateDir: string;
  readonly cwd: string;
}): Promise<{ url: string }> {
  const path = groupingPath(args.stateDir, args.context);
  const child = spawn(
    process.execPath,
    [
      process.argv[1] as string,
      "serve",
      "--grouping",
      path,
      ...rangeArgs(args.cmd.spec),
      ...(args.cmd.open ? ["--open-browser"] : []),
    ],
    { detached: true, stdio: "ignore", cwd: args.cwd },
  );
  child.unref();
  return awaitServer(args.stateDir, args.context, 15_000);
}
