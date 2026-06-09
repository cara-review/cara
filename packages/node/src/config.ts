import type { AppConfig, ConfigPort } from "@clear-diff/core";

const EDITOR_ENV = "CLEAR_DIFF_EDITOR";

/** Loads AppConfig from the process environment. */
export class EnvConfig implements ConfigPort {
  readonly #env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.#env = env;
  }

  load(): Promise<AppConfig> {
    const editor = this.#env[EDITOR_ENV]?.trim();
    return Promise.resolve({ editorCommand: editor || null });
  }
}
