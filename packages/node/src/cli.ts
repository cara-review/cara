// The `clear-diff` CLI (driving adapter): parse the invocation into a DiffSpec,
// build the backend at the composition root, boot the localhost server, and open
// the UI in an `--app`-mode browser window (ADR-0001). All transport/launch
// concerns stay here; the domain knows nothing of argv, ports, or browsers.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiffSpec } from "@clear-diff/core";
import { EnvConfig } from "./config.ts";
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
  const separator = arg.indexOf("..");
  if (separator === -1) throw new CliError(`Invalid argument "${arg}". Use clear-diff <base>..<head>.`);
  const base = arg.slice(0, separator);
  const head = arg.slice(separator + 2);
  if (base === "" || head === "") {
    throw new CliError(`Invalid range "${arg}". Both base and head are required.`);
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
  const log = deps.log ?? ((message: string) => console.log(message));

  const { editorCommand } = await new EnvConfig().load();
  const backend = compose({
    cwd,
    spec,
    stateDir: join(cwd, ".agent-state", "reviews"),
    editorCommand: editorCommand ?? "code",
  });

  const webRoot = resolveWebRoot();
  const server = await startServer(backend, webRoot !== undefined ? { webRoot } : {});
  log(`clear-diff: reviewing ${describe(spec)} at ${server.url}`);
  if (open) (deps.openApp ?? openApp)(server.url);
  return server;
}

function describe(spec: DiffSpec): string {
  switch (spec.kind) {
    case "worktree":
      return "the worktree against origin/main";
    case "range":
      return `${spec.base}..${spec.head}`;
    case "pr":
      return `PR #${spec.number}`;
  }
}

/** Locate the built UI assets shipped beside the package, or undefined if not built. */
function resolveWebRoot(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = resolve(here, "../../../apps/web/dist");
  return existsSync(dist) ? dist : undefined;
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
