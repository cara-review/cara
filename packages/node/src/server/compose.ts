// Composition root (ADR-0003): the one place concrete adapters are constructed
// and injected into the inbound port. Manual constructor injection, no DI
// framework. The core is LLM-free (ADR-0011) — no AgentPort, no chat, no sink:
// the plumbing verbs and the server drive a pure accounting engine, and the one
// LLM lives outside the boundary in the porcelain (`clear-diff review`).
//
// `composeCore` builds the adapter set the CLI verbs need (the service + git
// adapters). `compose` wraps it for the server, adding the UI-activity tracker
// and the boot spec the tRPC router carries.

import { homedir } from "node:os";
import type { ClockPort, ConfigPort, DiffSource, DiffSpec, ReviewService, WorkspaceReader } from "@clear-diff/core";
import { createReviewService } from "@clear-diff/core";
import { SystemClock } from "../clock.ts";
import { EnvConfig } from "../config.ts";
import { SpawnEditor } from "../editor.ts";
import { GitDiffSource } from "../git/diff-source.ts";
import { refsForSpec } from "../git/refs.ts";
import { GitWorkspaceReader } from "../git/workspace-reader.ts";
import { FileInstructions } from "../instructions.ts";
import { JsonlReviewStore } from "../review-store.ts";
import { createReviewActivity, type ReviewActivity } from "./activity.ts";
import type { RpcDeps } from "./router.ts";

/** The optional test overrides a composition accepts, threaded without `undefined` keys. */
export interface ComposeOverrides {
  readonly config?: ConfigPort;
  readonly clock?: ClockPort;
}

/** Strip absent overrides so `exactOptionalPropertyTypes` never sees an explicit `undefined`. */
export function composeOverrides(o: ComposeOverrides): ComposeOverrides {
  const out: { config?: ConfigPort; clock?: ClockPort } = {};
  if (o.config) out.config = o.config;
  if (o.clock) out.clock = o.clock;
  return out;
}

export interface CompositionConfig {
  /** Repo directory the git adapters run in. */
  readonly cwd: string;
  /** What to review, fixed by the CLI at boot. */
  readonly spec: DiffSpec;
  /** Where the append-only mark log lives (per-clone runtime state, gitignored). */
  readonly stateDir: string;
  /** ConfigPort override for tests; defaults to EnvConfig over process.env. */
  readonly config?: ConfigPort;
  /** ClockPort override for tests; defaults to the system clock. */
  readonly clock?: ClockPort;
}

/** The adapter set the LLM-free CLI verbs drive: the inbound port + git adapters. */
export interface CoreBackend {
  readonly service: ReviewService;
  readonly diffSource: DiffSource;
  readonly workspace: WorkspaceReader;
  readonly clock: ClockPort;
}

/** Construct the LLM-free service + git adapters. No browser, no transport. */
export async function composeCore(config: CompositionConfig): Promise<CoreBackend> {
  const { editorCommand } = await (config.config ?? new EnvConfig()).load();
  const clock = config.clock ?? new SystemClock();
  const diffSource = new GitDiffSource(config.cwd);
  const service = createReviewService({
    diffSource,
    store: new JsonlReviewStore(config.stateDir),
    instructions: new FileInstructions(homedir(), config.cwd),
    editor: new SpawnEditor(editorCommand ?? "code"),
    clock,
  });
  const workspace = new GitWorkspaceReader(config.cwd, refsForSpec(config.spec));
  return { service, diffSource, workspace, clock };
}

/** Construct and wire every adapter, returning the backend the server drives. */
export async function compose(config: CompositionConfig): Promise<RpcDeps> {
  const core = await composeCore(config);
  const activity: ReviewActivity = createReviewActivity(core.clock);
  return { service: core.service, workspace: core.workspace, spec: config.spec, activity, clock: core.clock };
}
