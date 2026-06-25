// `cara init` — interactive first-run setup. Asks the human a few questions and writes
// ~/.cara/config.toml, refusing to clobber an existing file without --force. The only
// verb that writes porcelain config, and human-only: the agent review path needs no
// config, so this never runs on the plumbing/agent side.

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { configPath, serializeConfig, type PorcelainConfig } from "./config.ts";
import type { CliIo, Prompter } from "./output.ts";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_KEY_ENV = "ANTHROPIC_API_KEY";

export async function runInit(home: string, io: CliIo, prompter: Prompter, force: boolean): Promise<void> {
  try {
    const path = configPath(home);
    if (!force && (await exists(path))) {
      io.write(`cara is already configured at ${path}.\nEdit it directly, or re-run: cara init --force\n`);
      return;
    }
    const config = await ask(io, prompter);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serializeConfig(config), "utf8");
    io.write(`\nWrote ${path}.\n${nextStep(config)}\n`);
  } finally {
    prompter.close();
  }
}

/** Drive the questions into a validated config. Defaults accept on a blank answer. */
async function ask(io: CliIo, prompter: Prompter): Promise<PorcelainConfig> {
  let mode: PorcelainConfig["grouping"]["mode"] | undefined;
  while (mode === undefined) {
    const answer = await prompter.ask("Grouping mode — 'llm' (cara groups with an API key) or 'git-order' (no key)", {
      default: "llm",
    });
    if (answer === "llm" || answer === "git-order") mode = answer;
    else io.write(`  Please answer "llm" or "git-order".\n`);
  }

  let llm: PorcelainConfig["llm"] = null;
  if (mode === "llm") {
    const model = await prompter.ask("Model", { default: DEFAULT_MODEL });
    const apiKeyEnv = await prompter.ask("API-key env var", { default: DEFAULT_KEY_ENV });
    llm = { provider: "anthropic", model, apiKeyEnv };
    if (!process.env[apiKeyEnv]?.trim()) {
      io.write(`\n  Note: $${apiKeyEnv} is not set. Export it before \`cara review\`:\n    export ${apiKeyEnv}=sk-ant-...\n`);
    }
  }

  const editor = await prompter.ask("Editor command (opens a file from the review)", { default: "code" });
  return { grouping: { mode }, llm, editor: { command: editor } };
}

function nextStep(config: PorcelainConfig): string {
  return config.llm !== null
    ? `Set $${config.llm.apiKeyEnv}, then run \`cara review\` to group and review your changes.`
    : "Run `cara review` to open a browser review (git-order grouping — no API key needed).";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
