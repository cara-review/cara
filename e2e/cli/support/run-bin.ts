// Spawn the real `cara` bin (dev entry `bun index.js`) for the CLI e2e axes.
// Drives the published surface end-to-end: argv → index.js → runCli → JSON on stdout.
// makeTestRepo (imported by the fixtures) scrubs every GIT_* var on import, so a
// fixture's git never touches the host repo even under the pre-push hook.

import { resolve } from "node:path";

const BIN = resolve(import.meta.dir, "../../../index.js");

export interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export interface RunOptions {
  readonly input?: string;
  readonly env?: Record<string, string | undefined>;
}

/** Run the bin in `cwd` with `args`; capture exit code, stdout, stderr. */
export async function runBin(args: readonly string[], cwd: string, opts: RunOptions = {}): Promise<Run> {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    cwd,
    ...(opts.env ? { env: opts.env } : {}),
    stdin: opts.input === undefined ? "ignore" : new TextEncoder().encode(opts.input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

/** Parse a successful run's stdout as JSON, asserting a clean exit first. */
export function json<T = Record<string, unknown>>(run: Run): T {
  if (run.code !== 0) throw new Error(`bin exited ${run.code}: ${run.err || run.out}`);
  try {
    return JSON.parse(run.out) as T;
  } catch {
    throw new Error(`stdout was not JSON: ${run.out}`);
  }
}
