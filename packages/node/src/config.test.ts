import { test } from "bun:test";
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

test("EnvConfig defaults groupingModel to the fast tier, overridable via CLEAR_DIFF_GROUPING_MODEL", async () => {
  assert.equal((await new EnvConfig({}).load()).groupingModel, "claude-haiku-4-5-20251001");
  assert.equal((await new EnvConfig({ CLEAR_DIFF_GROUPING_MODEL: "  " }).load()).groupingModel, "claude-haiku-4-5-20251001");
  assert.equal((await new EnvConfig({ CLEAR_DIFF_GROUPING_MODEL: "claude-custom" }).load()).groupingModel, "claude-custom");
});
