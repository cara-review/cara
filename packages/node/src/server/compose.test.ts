import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { DiffSpec } from "@clear-diff/core";
import { AnthropicAgent, AnthropicAgentChat } from "../anthropic-agent.ts";
import { FakeAgent, FakeAgentChat } from "../fake-agent.ts";
import { makeTestRepo } from "../git/test-repo.ts";
import { compose, selectAgent, selectChat } from "./compose.ts";

test("selectAgent picks the real Claude adapter when ANTHROPIC_API_KEY is set, else FakeAgent", () => {
  const original = process.env["ANTHROPIC_API_KEY"];
  try {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-not-a-real-key";
    assert.ok(selectAgent() instanceof AnthropicAgent);

    delete process.env["ANTHROPIC_API_KEY"];
    assert.ok(selectAgent() instanceof FakeAgent);
  } finally {
    if (original === undefined) delete process.env["ANTHROPIC_API_KEY"];
    else process.env["ANTHROPIC_API_KEY"] = original;
  }
});

test("selectChat picks the real Claude Q&A adapter when ANTHROPIC_API_KEY is set, else FakeAgentChat", () => {
  const original = process.env["ANTHROPIC_API_KEY"];
  try {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-not-a-real-key";
    assert.ok(selectChat() instanceof AnthropicAgentChat);

    delete process.env["ANTHROPIC_API_KEY"];
    assert.ok(selectChat() instanceof FakeAgentChat);
  } finally {
    if (original === undefined) delete process.env["ANTHROPIC_API_KEY"];
    else process.env["ANTHROPIC_API_KEY"] = original;
  }
});

test("composition root wires a working ReviewService and WorkspaceReader", async () => {
  const repo = await makeTestRepo();
  try {
    await repo.write("a.ts", "one\n");
    const base = await repo.commit("base");
    await repo.write("a.ts", "one\ntwo\n");
    const head = await repo.commit("add line");

    const spec: DiffSpec = { kind: "range", base, head };
    const backend = await compose({
      cwd: repo.dir,
      spec,
      stateDir: join(repo.dir, ".state"),
      config: { load: () => Promise.resolve({ editorCommand: "true" }) },
    });

    const snapshot = await backend.service.open(spec);
    assert.ok(snapshot.review.masterList.length >= 1);
    assert.equal(snapshot.progress.total, snapshot.review.masterList.length);

    const text = await backend.workspace.readFile("a.ts", "head");
    assert.equal(text, "one\ntwo\n");
  } finally {
    await repo.cleanup();
  }
});
