import { test } from "bun:test";
import assert from "node:assert/strict";
import { editorArgs, SpawnEditor, type SpawnFn } from "./editor.ts";

test("editorArgs uses --goto for VS Code-family editors", () => {
  assert.deepEqual(editorArgs("code", "src/x.ts", 12), ["--goto", "src/x.ts:12"]);
  assert.deepEqual(editorArgs("/usr/local/bin/code", "x.ts", 1), ["--goto", "x.ts:1"]);
});

test("editorArgs passes a positional target for other editors", () => {
  assert.deepEqual(editorArgs("zed", "src/x.ts", 12), ["src/x.ts:12"]);
});

test("SpawnEditor.open spawns the command with editor args, detached", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  let unrefCount = 0;
  const fakeSpawn: SpawnFn = (command, args, options) => {
    assert.equal(options.detached, true);
    assert.equal(options.stdio, "ignore");
    calls.push({ command, args });
    return {
      unref: () => {
        unrefCount += 1;
      },
    };
  };

  await new SpawnEditor("zed", fakeSpawn).open("a.ts", 7);

  assert.deepEqual(calls, [{ command: "zed", args: ["a.ts:7"] }]);
  assert.equal(unrefCount, 1);
});
