import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { DiffSpec } from "@clear-diff/core";
import { AnthropicAgent, AnthropicAgentChat } from "../anthropic-agent.ts";
import { FakeAgent, FakeAgentChat } from "../fake-agent.ts";
import { makeTestRepo } from "../git/test-repo.ts";
import { UserFacingError } from "../user-facing-error.ts";
import { compose, selectAgent, selectChat } from "./compose.ts";

const MODEL = "claude-haiku-4-5-20251001";

/** Run `body` with the two credential env vars cleared, restoring them after. */
function withoutCredentials(body: () => void): void {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  const authToken = process.env["ANTHROPIC_AUTH_TOKEN"];
  delete process.env["ANTHROPIC_API_KEY"];
  delete process.env["ANTHROPIC_AUTH_TOKEN"];
  try {
    body();
  } finally {
    if (apiKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
    else process.env["ANTHROPIC_API_KEY"] = apiKey;
    if (authToken === undefined) delete process.env["ANTHROPIC_AUTH_TOKEN"];
    else process.env["ANTHROPIC_AUTH_TOKEN"] = authToken;
  }
}

test("selectAgent uses the real Claude adapter for either credential env var", () => {
  withoutCredentials(() => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-not-a-real-key";
    assert.ok(selectAgent(MODEL) instanceof AnthropicAgent);

    delete process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_AUTH_TOKEN"] = "oauth-token-not-real";
    assert.ok(selectAgent(MODEL) instanceof AnthropicAgent);
  });
});

test("selectAgent without credentials: FakeAgent only when allowed, else throws", () => {
  withoutCredentials(() => {
    assert.ok(selectAgent(MODEL, true) instanceof FakeAgent);
    assert.throws(() => selectAgent(MODEL), UserFacingError);
    assert.throws(() => selectAgent(MODEL, false), UserFacingError);
  });
});

test("selectChat uses the real Q&A adapter for either credential env var", () => {
  withoutCredentials(() => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-not-a-real-key";
    assert.ok(selectChat() instanceof AnthropicAgentChat);

    delete process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_AUTH_TOKEN"] = "oauth-token-not-real";
    assert.ok(selectChat() instanceof AnthropicAgentChat);
  });
});

test("selectChat without credentials: FakeAgentChat only when allowed, else throws", () => {
  withoutCredentials(() => {
    assert.ok(selectChat(true) instanceof FakeAgentChat);
    assert.throws(() => selectChat(), UserFacingError);
  });
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
      config: { load: () => Promise.resolve({ editorCommand: "true", groupingModel: "claude-haiku-4-5-20251001" }) },
      allowFake: true,
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
