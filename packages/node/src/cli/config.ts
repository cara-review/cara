// The porcelain config (`~/.cara/config.toml`, ADR-0011). Read ONLY by the
// `review` wrapper — the plumbing verbs (`atoms`/`present`/`dispatch`/`submit`) never
// read it. It selects the
// grouping mode, names the LLM provider/model and the env var that *names* the key
// (never the key itself — keys live in the environment, resolved lazily at the LLM
// call), and carries the editor command for the core ConfigPort. No silent fallbacks:
// a missing file is a loud error pointing at `cara init`.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { CliError } from "./parse.ts";

export interface PorcelainConfig {
  readonly grouping: { readonly mode: "llm" | "git-order" };
  /** Provider/model + the env-var NAME the key is read from. Required when mode = "llm". */
  readonly llm: { readonly provider: string; readonly model: string; readonly apiKeyEnv: string } | null;
  readonly editor: { readonly command: string | null };
}

export function configPath(home: string): string {
  return join(home, ".cara", "config.toml");
}

/** Render a validated config back to TOML — the inverse of `coerceConfig`, used by `cara init`. */
export function serializeConfig(config: PorcelainConfig): string {
  // TOML basic strings share JSON's escape rules for our inputs, so JSON.stringify
  // yields a safe quoted value even if a field carries a quote or backslash.
  const quote = (value: string): string => JSON.stringify(value);
  const lines = ["[grouping]", `mode = ${quote(config.grouping.mode)}`, ""];
  if (config.llm !== null) {
    lines.push(
      "[llm]",
      `provider = ${quote(config.llm.provider)}`,
      `model = ${quote(config.llm.model)}`,
      `api_key_env = ${quote(config.llm.apiKeyEnv)}`,
      "",
    );
  }
  if (config.editor.command !== null) {
    lines.push("[editor]", `command = ${quote(config.editor.command)}`, "");
  }
  return lines.join("\n");
}

/** Load + validate the porcelain config, or fail loudly pointing at `cara init`. */
export async function loadPorcelainConfig(home: string): Promise<PorcelainConfig> {
  const path = configPath(home);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new CliError(`No cara config at ${path}. Run \`cara init\` to create one.`);
  }
  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch {
    throw new CliError(`Config at ${path} is not valid TOML.`);
  }
  return coerceConfig(parsed, path);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Coerce untrusted TOML into a validated config; every missing/invalid field fails loudly. */
function coerceConfig(parsed: unknown, path: string): PorcelainConfig {
  const root = asRecord(parsed);
  const mode = asRecord(root["grouping"])["mode"];
  if (mode !== "llm" && mode !== "git-order") {
    throw new CliError(`Config at ${path}: [grouping] mode must be "llm" or "git-order".`);
  }

  const llmRaw = root["llm"] === undefined ? null : asRecord(root["llm"]);
  let llm: PorcelainConfig["llm"] = null;
  if (llmRaw) {
    const provider = nonEmptyString(llmRaw["provider"]);
    const model = nonEmptyString(llmRaw["model"]);
    const apiKeyEnv = nonEmptyString(llmRaw["api_key_env"]);
    if (provider && model && apiKeyEnv) llm = { provider, model, apiKeyEnv };
  }
  if (mode === "llm" && llm === null) {
    throw new CliError(
      `Config at ${path}: [grouping] mode = "llm" requires a complete [llm] block ` +
        `(provider, model, api_key_env).`,
    );
  }

  const command = nonEmptyString(asRecord(root["editor"])["command"]);
  return { grouping: { mode }, llm, editor: { command } };
}
