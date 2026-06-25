// `cara init` writes a valid ~/.cara/config.toml from scripted answers, round-tripping
// through loadPorcelainConfig; it refuses to clobber an existing config without --force,
// re-asks on an invalid mode, and warns when the named key env var is unset.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "./init.ts";
import { configPath, loadPorcelainConfig } from "./config.ts";
import type { CliIo, Prompter } from "./output.ts";

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "cara-init-"));
  try {
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function capture(): { io: CliIo; text(): string } {
  const out: string[] = [];
  return { io: { write: (t) => out.push(t), readStdin: () => Promise.resolve("") }, text: () => out.join("") };
}

/** A prompter that replays scripted answers, applying the default on a blank — like the real one. */
function scripted(answers: readonly string[]): Prompter & { closed: boolean } {
  let i = 0;
  const p = {
    closed: false,
    ask: (_q: string, opts?: { default?: string }) => {
      const a = answers[i++] ?? "";
      return Promise.resolve(a === "" && opts?.default !== undefined ? opts.default : a);
    },
    close: () => {
      p.closed = true;
    },
  };
  return p;
}

test("init writes an llm config from defaults and round-trips through loadPorcelainConfig", async () => {
  await withHome(async (home) => {
    const cap = capture();
    const prompter = scripted(["", "", "", ""]); // mode, model, key env, editor — all defaults
    await runInit(home, cap.io, prompter, false);

    const config = await loadPorcelainConfig(home);
    assert.equal(config.grouping.mode, "llm");
    assert.deepEqual(config.llm, { provider: "anthropic", model: "claude-sonnet-4-6", apiKeyEnv: "ANTHROPIC_API_KEY" });
    assert.equal(config.editor.command, "code");
    assert.match(cap.text(), /Wrote .*config\.toml/);
    assert.equal(prompter.closed, true);
  });
});

test("init in git-order mode writes no [llm] block and needs no key", async () => {
  await withHome(async (home) => {
    const cap = capture();
    await runInit(home, cap.io, scripted(["git-order", "code"]), false);

    const config = await loadPorcelainConfig(home);
    assert.equal(config.grouping.mode, "git-order");
    assert.equal(config.llm, null);
    assert.equal(config.editor.command, "code");
  });
});

test("init re-asks on an invalid mode, then proceeds", async () => {
  await withHome(async (home) => {
    const cap = capture();
    await runInit(home, cap.io, scripted(["bogus", "git-order", "code"]), false);

    assert.match(cap.text(), /Please answer "llm" or "git-order"/);
    assert.equal((await loadPorcelainConfig(home)).grouping.mode, "git-order");
  });
});

test("init warns when the named key env var is unset", async () => {
  await withHome(async (home) => {
    const cap = capture();
    const unsetEnv = "CARA_INIT_TEST_UNSET_KEY";
    delete process.env[unsetEnv];
    await runInit(home, cap.io, scripted(["llm", "some-model", unsetEnv, "code"]), false);

    assert.match(cap.text(), new RegExp(`\\$${unsetEnv} is not set`));
  });
});

test("init refuses to overwrite an existing config without --force", async () => {
  await withHome(async (home) => {
    await mkdir(join(home, ".cara"), { recursive: true });
    await writeFile(configPath(home), "PRE-EXISTING\n");
    const cap = capture();
    // A prompter that throws if asked proves init never reached the questions.
    const noAsk: Prompter = {
      ask: () => Promise.reject(new Error("should not prompt")),
      close: () => {},
    };

    await runInit(home, cap.io, noAsk, false);

    assert.match(cap.text(), /already configured/);
    assert.equal(await readFile(configPath(home), "utf8"), "PRE-EXISTING\n");
  });
});

test("init --force overwrites an existing config", async () => {
  await withHome(async (home) => {
    await mkdir(join(home, ".cara"), { recursive: true });
    await writeFile(configPath(home), "PRE-EXISTING\n");
    const cap = capture();
    await runInit(home, cap.io, scripted(["git-order", "code"]), true);

    assert.equal((await loadPorcelainConfig(home)).grouping.mode, "git-order");
  });
});
