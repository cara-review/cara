// The `clear-diff` CLI dispatcher (driving adapter, ADR-0011). Parse argv into a typed
// command and route it to its verb. The agent's whole protocol is these verbs; the bare
// invocation is the `review` porcelain (axis c, task #6). Transport/composition live in
// the verb modules — this file only wires argv → verb.

import { join } from "node:path";
import type { ClockPort, ConfigPort, ReviewContext } from "@clear-diff/core";
import { parseCommand, CliError, type PresentCommand } from "./cli/parse.ts";
import { systemIo, type CliIo } from "./cli/output.ts";
import { runAtoms, runDispatch, runInstructions, runPresent, runSubmit, type VerbContext } from "./cli/verbs.ts";
import { runServe } from "./cli/serve.ts";
import { composeOverrides } from "./server/compose.ts";

export { CliError } from "./cli/parse.ts";
export { parseCommand, type Command } from "./cli/parse.ts";

export interface CliDeps {
  readonly cwd?: string;
  readonly io?: CliIo;
  /** ConfigPort override for tests; defaults to EnvConfig over process.env. */
  readonly config?: ConfigPort;
  /** ClockPort override for tests; defaults to the system clock. */
  readonly clock?: ClockPort;
  /** Boot the browser server for `present` (injected in tests; default = detached spawn). */
  readonly bootServer?: (cmd: PresentCommand, context: ReviewContext) => Promise<{ url: string }>;
}

/** Parse argv (without node/script) and run the matching verb. */
export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<void> {
  const cmd = parseCommand(argv);
  const cwd = deps.cwd ?? process.cwd();
  const ctx: VerbContext = buildContext(cwd, deps);

  switch (cmd.verb) {
    case "atoms":
      return runAtoms(cmd.spec, ctx);
    case "present":
      return runPresent(cmd, ctx);
    case "dispatch":
      return runDispatch(cmd, ctx);
    case "submit":
      return runSubmit(cmd, ctx);
    case "instructions":
      return runInstructions(ctx);
    case "serve":
      return runServe(cmd, { cwd, stateDir: ctx.stateDir, ...composeOverrides(deps) });
    case "review":
      throw new CliError(
        "clear-diff review (the LLM wrapper) is not wired yet — use the plumbing verbs: atoms, present, dispatch, submit, instructions.",
      );
  }
}

function buildContext(cwd: string, deps: CliDeps): VerbContext {
  return {
    cwd,
    stateDir: join(cwd, ".agent-state", "reviews"),
    io: deps.io ?? systemIo,
    ...(deps.config ? { config: deps.config } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.bootServer ? { bootServer: deps.bootServer } : {}),
  };
}
