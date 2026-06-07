// Composition root (ADR-0003): the one place concrete adapters are constructed
// and injected into the inbound port. Manual constructor injection, no DI
// framework. The AgentPort is the real Claude adapter when ANTHROPIC_API_KEY is
// set, else the offline FakeAgent (see defaultAgent). The WorkspaceReader (not on
// the inbound port) is built here too so the server can serve evidence file texts
// to the UI.

import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentPort, ConfigPort, DiffSpec } from "@clear-diff/core";
import { createReviewService } from "@clear-diff/core";
import { AnthropicAgent } from "../anthropic-agent.ts";
import { SystemClock } from "../clock.ts";
import { EnvConfig } from "../config.ts";
import { SpawnEditor } from "../editor.ts";
import { FakeAgent } from "../fake-agent.ts";
import { GitDiffSource } from "../git/diff-source.ts";
import { refsForSpec } from "../git/refs.ts";
import { GitWorkspaceReader } from "../git/workspace-reader.ts";
import { FileInstructions } from "../instructions.ts";
import { MarkdownCommentSink } from "../markdown-comment-sink.ts";
import { JsonlReviewStore } from "../review-store.ts";
import type { RpcDeps } from "./dispatch.ts";

export interface CompositionConfig {
  /** Repo directory the git adapters run in. */
  readonly cwd: string;
  /** What to review, fixed by the CLI at boot. */
  readonly spec: DiffSpec;
  /** Where the append-only mark log lives (per-clone runtime state, gitignored). */
  readonly stateDir: string;
  /** ConfigPort override for tests; defaults to EnvConfig over process.env. */
  readonly config?: ConfigPort;
  /** AgentPort override for tests; defaults to the FakeAgent. */
  readonly agent?: AgentPort;
}

/** Real Claude adapter when an API key is present (env), else the offline FakeAgent. */
export function selectAgent(): AgentPort {
  return process.env["ANTHROPIC_API_KEY"] ? new AnthropicAgent() : new FakeAgent();
}

/** Construct and wire every adapter, returning the backend the server drives. */
export async function compose(config: CompositionConfig): Promise<RpcDeps> {
  const { editorCommand } = await (config.config ?? new EnvConfig()).load();
  const service = createReviewService({
    diffSource: new GitDiffSource(config.cwd),
    store: new JsonlReviewStore(config.stateDir),
    agent: config.agent ?? selectAgent(),
    instructions: new FileInstructions(homedir(), config.cwd),
    editor: new SpawnEditor(editorCommand ?? "code"),
    clock: new SystemClock(),
    sink: new MarkdownCommentSink(join(config.cwd, ".agent-state", "comments")),
  });
  const workspace = new GitWorkspaceReader(config.cwd, refsForSpec(config.spec));
  return { service, workspace, spec: config.spec };
}
