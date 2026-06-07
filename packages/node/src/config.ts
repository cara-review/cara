import type { AppConfig, ConfigPort } from "@clear-diff/core";

const EDITOR_ENV = "CLEAR_DIFF_EDITOR";
const GROUPING_MODEL_ENV = "CLEAR_DIFF_GROUPING_MODEL";

// Grouping is structural, not generative, so it defaults to a fast tier. Override
// per-environment with CLEAR_DIFF_GROUPING_MODEL; chat keeps its own (stronger) model.
const DEFAULT_GROUPING_MODEL = "claude-haiku-4-5-20251001";

/** Loads AppConfig from the process environment. */
export class EnvConfig implements ConfigPort {
  readonly #env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.#env = env;
  }

  load(): Promise<AppConfig> {
    const editor = this.#env[EDITOR_ENV]?.trim();
    const groupingModel = this.#env[GROUPING_MODEL_ENV]?.trim();
    return Promise.resolve({
      editorCommand: editor || null,
      groupingModel: groupingModel || DEFAULT_GROUPING_MODEL,
    });
  }
}
