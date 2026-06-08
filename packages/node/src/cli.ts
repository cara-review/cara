// The `clear-diff` CLI (driving adapter): parse the invocation into a DiffSpec,
// build the backend at the composition root, boot the localhost server, and open
// the UI in an `--app`-mode browser window (ADR-0001). All transport/launch
// concerns stay here; the domain knows nothing of argv, ports, or browsers.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiffSpec } from "@clear-diff/core";
import { compose } from "./server/compose.ts";
import { startServer, type RunningServer } from "./server/server.ts";

/** A usage error. Carries a message fit to print to the user; no stack noise. */
export class CliError extends Error {}

export interface CliArgs {
  readonly spec: DiffSpec;
  /** Whether to open the UI window. `--no-open` suppresses it (tests, headless). */
  readonly open: boolean;
}

/**
 * Parse argv (without node/script) into a spec + flags.
 *   clear-diff               → worktree vs origin/main
 *   clear-diff <base>..<head> → a ref range
 *   clear-diff --pr N        → rejected (not yet supported)
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  let open = true;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === "--no-open") open = false;
    else if (arg === "--pr") throw new CliError("clear-diff --pr is not yet supported.");
    else if (arg.startsWith("--")) throw new CliError(`Unknown option: ${arg}`);
    else positional.push(arg);
  }

  const [target, ...rest] = positional;
  if (rest.length > 0) throw new CliError("Expected a single <base>..<head> argument.");
  if (target === undefined) return { spec: { kind: "worktree" }, open };
  return { spec: parseRange(target), open };
}

function parseRange(arg: string): DiffSpec {
  // Exactly one ".." with non-empty sides. A second ".." (a..b..c) or a third dot
  // (the git three-dot form main...feature) is corrupt, not a two-dot range.
  const parts = arg.split("..");
  const base = parts[0] ?? "";
  const head = parts[1] ?? "";
  if (parts.length !== 2 || base === "" || head === "" || base.endsWith(".") || head.startsWith(".")) {
    throw new CliError(`Invalid range "${arg}". Use clear-diff <base>..<head>.`);
  }
  return { kind: "range", base, head };
}

export interface CliDeps {
  readonly cwd?: string;
  readonly openApp?: (url: string) => void;
  readonly log?: (message: string) => void;
}

/** Boot the server and (unless suppressed) open the UI. Returns the running server. */
export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<RunningServer> {
  const { spec, open } = parseArgs(argv);
  const cwd = deps.cwd ?? process.cwd();
  const log = deps.log ?? ((message) => console.log(message));

  const backend = await compose({ cwd, spec, stateDir: join(cwd, ".agent-state", "reviews") });

  const webRoot = resolveWebRoot();
  const server = await startServer(backend, webRoot !== undefined ? { webRoot } : {});
  log(`clear-diff: reviewing ${describe(spec)} at ${server.url}`);
  if (open) (deps.openApp ?? openApp)(server.url);
  return server;
}

function describe(spec: DiffSpec): string {
  // Only worktree / range reach here — parseArgs rejects --pr before boot.
  return spec.kind === "range" ? `${spec.base}..${spec.head}` : "the worktree against origin/main";
}

/** Locate the built UI assets, or undefined if not built. */
function resolveWebRoot(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  // Published: the bundled dist/cli.js sits beside dist/web. Dev: cli.ts lives in
  // packages/node/src, with the assets under apps/web/dist at the repo root.
  const candidates = [resolve(here, "web"), resolve(here, "../../../apps/web/dist")];
  return candidates.find((path) => existsSync(path));
}

/** Open the URL in a chromium `--app` window (macOS-first), falling back to the OS opener. */
function openApp(url: string): void {
  const child = spawn("open", ["-na", "Google Chrome", "--args", `--app=${url}`], {
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  });
  child.unref();
}
