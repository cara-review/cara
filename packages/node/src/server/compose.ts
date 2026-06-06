// Composition root (ADR-0003): the one place concrete adapters are constructed
// and injected into the inbound port. Manual constructor injection, no DI
// framework. Default AgentPort is the FakeAgent — the real Anthropic adapter is a
// later issue. The WorkspaceReader (not on the inbound port) is built here too so
// the server can serve evidence file texts to the UI.

import { homedir } from "node:os";
import type { DiffSpec, ReviewService, WorkspaceReader } from "@clear-diff/core";
import { createReviewService } from "@clear-diff/core";
import { SystemClock } from "../clock.ts";
import { SpawnEditor } from "../editor.ts";
import { FakeAgent } from "../fake-agent.ts";
import { GitDiffSource } from "../git/diff-source.ts";
import { refsForSpec } from "../git/refs.ts";
import { GitWorkspaceReader } from "../git/workspace-reader.ts";
import { FileInstructions } from "../instructions.ts";
import { JsonlReviewStore } from "../review-store.ts";

export interface CompositionConfig {
  /** Repo directory the git adapters run in. */
  readonly cwd: string;
  /** What to review, fixed by the CLI at boot. */
  readonly spec: DiffSpec;
  /** Where the append-only mark log lives (per-clone runtime state, gitignored). */
  readonly stateDir: string;
  /** Command used to open files in the editor (e.g. "code", "zed"). */
  readonly editorCommand: string;
}

export interface Backend {
  readonly service: ReviewService;
  readonly workspace: WorkspaceReader;
  readonly spec: DiffSpec;
}

export function compose(config: CompositionConfig): Backend {
  const service = createReviewService({
    diffSource: new GitDiffSource(config.cwd),
    store: new JsonlReviewStore(config.stateDir),
    agent: new FakeAgent(),
    instructions: new FileInstructions(homedir(), config.cwd),
    editor: new SpawnEditor(config.editorCommand),
    clock: new SystemClock(),
  });
  const workspace = new GitWorkspaceReader(config.cwd, refsForSpec(config.spec));
  return { service, workspace, spec: config.spec };
}
