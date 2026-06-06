import { test } from "node:test";
import assert from "node:assert/strict";
import { EnvConfig } from "./config.ts";

test("EnvConfig reads editorCommand from CLEAR_DIFF_EDITOR", async () => {
  const config = await new EnvConfig({ CLEAR_DIFF_EDITOR: "zed" }).load();
  assert.equal(config.editorCommand, "zed");
});

test("EnvConfig yields null when the editor env var is unset or blank", async () => {
  assert.equal((await new EnvConfig({}).load()).editorCommand, null);
  assert.equal((await new EnvConfig({ CLEAR_DIFF_EDITOR: "  " }).load()).editorCommand, null);
});
