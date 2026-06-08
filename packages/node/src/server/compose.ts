// Composition root (ADR-0003): the one place concrete adapters are constructed
// and injected into the inbound port. Manual constructor injection, no DI
// framework. The AgentPort is the real Claude adapter when Anthropic credentials
// are present; with none it fails loudly rather than silently degrading — the
// offline FakeAgent only stands in when explicitly opted into (allowFake). The
// WorkspaceReader (not on the inbound port) is built here too so the server can
// serve evidence file texts to the UI.

import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentChat, AgentPort, ConfigPort, DiffSpec } from "@clear-diff/core";
import { createReviewService } from "@clear-diff/core";
import { AnthropicAgent, AnthropicAgentChat } from "../anthropic-agent.ts";
import { SystemClock } from "../clock.ts";
import { EnvConfig } from "../config.ts";
import { SpawnEditor } from "../editor.ts";
import { FakeAgent, FakeAgentChat } from "../fake-agent.ts";
import { GitDiffSource } from "../git/diff-source.ts";
import { refsForSpec } from "../git/refs.ts";
import { GitWorkspaceReader } from "../git/workspace-reader.ts";
import { FileInstructions } from "../instructions.ts";
import { MarkdownCommentSink } from "../markdown-comment-sink.ts";
import { JsonlReviewStore } from "../review-store.ts";
import { UserFacingError } from "../user-facing-error.ts";
import type { RpcDeps } from "./router.ts";

const NO_CREDENTIALS =
  "No Anthropic credentials found. Set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN to run the real reviewer (pass --fake for the offline demo agent).";

/** True when the Anthropic SDK can authenticate — either env var it reads. */
function hasCredentials(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"] || process.env["ANTHROPIC_AUTH_TOKEN"]);
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
  /** AgentPort override for tests; defaults to the FakeAgent. */
  readonly agent?: AgentPort;
  /** AgentChat override for tests; defaults to the FakeAgentChat (ADR-0009). */
  readonly chat?: AgentChat;
  /** Permit the offline FakeAgent when no credentials are set (--fake, e2e). */
  readonly allowFake?: boolean;
}

/** Real Claude adapter when credentials are present; FakeAgent only if allowed; else fail. */
export function selectAgent(groupingModel: string, allowFake = false): AgentPort {
  if (hasCredentials()) return new AnthropicAgent(undefined, { model: groupingModel });
  if (allowFake) return new FakeAgent();
  throw new UserFacingError(NO_CREDENTIALS);
}

/** Real Claude Q&A adapter when credentials are present; FakeAgentChat only if allowed; else fail. */
export function selectChat(allowFake = false): AgentChat {
  if (hasCredentials()) return new AnthropicAgentChat();
  if (allowFake) return new FakeAgentChat();
  throw new UserFacingError(NO_CREDENTIALS);
}

/** Construct and wire every adapter, returning the backend the server drives. */
export async function compose(config: CompositionConfig): Promise<RpcDeps> {
  const { editorCommand, groupingModel } = await (config.config ?? new EnvConfig()).load();
  const service = createReviewService({
    diffSource: new GitDiffSource(config.cwd),
    store: new JsonlReviewStore(config.stateDir),
    agent: config.agent ?? selectAgent(groupingModel, config.allowFake),
    chat: config.chat ?? selectChat(config.allowFake),
    instructions: new FileInstructions(homedir(), config.cwd),
    editor: new SpawnEditor(editorCommand ?? "code"),
    clock: new SystemClock(),
    sink: new MarkdownCommentSink(join(config.cwd, ".agent-state", "comments")),
  });
  const workspace = new GitWorkspaceReader(config.cwd, refsForSpec(config.spec));
  return { service, workspace, spec: config.spec };
}
