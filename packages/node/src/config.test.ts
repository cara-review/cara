import { test } from "bun:test";
import assert from "node:assert/strict";
import { EnvConfig } from "./config.ts";

test("EnvConfig reads editorCommand from CARA_EDITOR", async () => {
  const config = await new EnvConfig({ CARA_EDITOR: "zed" }).load();
  assert.equal(config.editorCommand, "zed");
});

test("EnvConfig yields null when the editor env var is unset or blank", async () => {
  assert.equal((await new EnvConfig({}).load()).editorCommand, null);
  assert.equal((await new EnvConfig({ CARA_EDITOR: "  " }).load()).editorCommand, null);
});
