// The config matrix (TN-26-026): no config is a loud error pointing at `cara init`; mode
// validation is strict; the [llm] block is required for mode "llm" and optional for
// "git-order"; the key is stored only by env-var NAME, never its value.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPorcelainConfig, serializeConfig } from "./config.ts";

async function withHome(toml: string | null, run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "cara-cfg-"));
  try {
    if (toml !== null) {
      await mkdir(join(home, ".cara"), { recursive: true });
      await writeFile(join(home, ".cara", "config.toml"), toml);
    }
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const LLM_TOML = `[grouping]
mode = "llm"
[llm]
provider = "anthropic"
model = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"
[editor]
command = "zed"
`;

test("no config is a loud error pointing at `cara init`", async () => {
  await withHome(null, async (home) => {
    await assert.rejects(loadPorcelainConfig(home), (e: Error) => {
      assert.match(e.message, /No cara config/);
      assert.match(e.message, /cara init/);
      return true;
    });
  });
});

test("mode llm with a complete [llm] block loads, keeping only the key env-var NAME", async () => {
  await withHome(LLM_TOML, async (home) => {
    const config = await loadPorcelainConfig(home);
    assert.equal(config.grouping.mode, "llm");
    assert.deepEqual(config.llm, { provider: "anthropic", model: "claude-sonnet-4-6", apiKeyEnv: "ANTHROPIC_API_KEY" });
    assert.equal(config.editor.command, "zed");
  });
});

test("mode llm without an [llm] block fails loudly", async () => {
  await withHome(`[grouping]\nmode = "llm"\n`, async (home) => {
    await assert.rejects(loadPorcelainConfig(home), /requires a complete \[llm\] block/);
  });
});

test("mode git-order needs no [llm] block — floor by choice, no key", async () => {
  await withHome(`[grouping]\nmode = "git-order"\n[editor]\ncommand = "code"\n`, async (home) => {
    const config = await loadPorcelainConfig(home);
    assert.equal(config.grouping.mode, "git-order");
    assert.equal(config.llm, null);
    assert.equal(config.editor.command, "code");
  });
});

test("serializeConfig is the inverse of the loader — llm config round-trips", async () => {
  const original = {
    grouping: { mode: "llm" as const },
    llm: { provider: "anthropic", model: "claude-sonnet-4-6", apiKeyEnv: "ANTHROPIC_API_KEY" },
    editor: { command: "zed" },
  };
  await withHome(serializeConfig(original), async (home) => {
    assert.deepEqual(await loadPorcelainConfig(home), original);
  });
});

test("serializeConfig omits [editor] when the command is null, loading back to null", async () => {
  const original = { grouping: { mode: "git-order" as const }, llm: null, editor: { command: null } };
  const toml = serializeConfig(original);
  assert.doesNotMatch(toml, /\[editor\]/);
  await withHome(toml, async (home) => {
    assert.deepEqual(await loadPorcelainConfig(home), original);
  });
});

test("an invalid grouping mode fails loudly", async () => {
  await withHome(`[grouping]\nmode = "magic"\n`, async (home) => {
    await assert.rejects(loadPorcelainConfig(home), /must be "llm" or "git-order"/);
  });
});

test("a missing editor command is null, not an error", async () => {
  await withHome(`[grouping]\nmode = "git-order"\n`, async (home) => {
    const config = await loadPorcelainConfig(home);
    assert.equal(config.editor.command, null);
  });
});

test("malformed TOML fails loudly", async () => {
  await withHome(`[grouping\nmode = oops`, async (home) => {
    await assert.rejects(loadPorcelainConfig(home), /not valid TOML/);
  });
});
