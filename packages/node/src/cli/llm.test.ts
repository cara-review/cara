// The porcelain's Anthropic seam, driven through an injected message transport — no SDK,
// no network. These pin the field bug (`.agent-state/porcelain-grouping-bug.md`): the
// short-id render must be 1-based so every atom (especially the LAST) round-trips back to
// its hash, and a truncated (max_tokens) response must throw loudly, never silently floor
// every change to "Other changes".

import { test } from "bun:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type { Atom } from "@cara/core";
import { AnthropicLlm, type CreateMessage } from "./llm.ts";

function atom(hash: string, path: string, text: string): Atom {
  return {
    hash: hash as Atom["hash"],
    status: "modified",
    path,
    previousPath: null,
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: "added", text }],
  };
}

function message(content: readonly Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"] = "tool_use"): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "m",
    content: content as Anthropic.ContentBlock[],
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 } as Anthropic.Usage,
  } as Anthropic.Message;
}

function toolUse(name: string, input: unknown): Anthropic.ContentBlock {
  return { type: "tool_use", id: "t", name, input } as Anthropic.ContentBlock;
}

/** Pull the `[id]` tokens out of the rendered user prompt, mimicking a model that echoes them. */
function idsInPrompt(params: Anthropic.MessageCreateParamsNonStreaming): number[] {
  const user = String(params.messages[0]?.content ?? "");
  return [...user.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
}

const THREE = [atom("h1", "a.ts", "a"), atom("h2", "b.ts", "b"), atom("h3", "c.ts", "c")];

interface TranslatedGrouping {
  readonly chapters: readonly { readonly sections: readonly { readonly atomHashes: readonly string[] }[] }[];
}

test("group() places every atom including the last — 1-based id round-trip (off-by-one regression)", async () => {
  // Echo model: groups exactly the ids it was shown into one section.
  const echo: CreateMessage = (params) =>
    Promise.resolve(
      message([toolUse("propose_grouping", { chapters: [{ title: "C", summary: "s", sections: [{ title: "S", summary: "s", atomIds: idsInPrompt(params) }] }] })]),
    );
  const llm = new AnthropicLlm({ model: "m", apiKeyEnv: "X" }, {}, echo);
  const grouping = (await llm.group({ atoms: THREE, methodology: "M" })) as TranslatedGrouping;
  const placed = grouping.chapters.flatMap((c) => c.sections.flatMap((s) => [...s.atomHashes]));
  // With the bug (0-based render vs 1-based map), h3 would be dropped and ids shifted.
  assert.deepEqual(placed, ["h1", "h2", "h3"]);
});

test("review() marks every atom including the last — same 1-based round-trip", async () => {
  const echo: CreateMessage = (params) =>
    Promise.resolve(message([toolUse("submit_review", { findings: idsInPrompt(params).map((id) => ({ atomId: id, disposition: "done" })) })]));
  const llm = new AnthropicLlm({ model: "m", apiKeyEnv: "X" }, {}, echo);
  const findings = await llm.review({ atoms: THREE, methodology: "M", lens: "L" });
  assert.deepEqual(
    findings.marks.map((m) => m.atomHash),
    ["h1", "h2", "h3"],
  );
});

test("group() throws on a truncated (max_tokens) response, never floors silently", async () => {
  const truncated: CreateMessage = () => Promise.resolve(message([], "max_tokens"));
  const llm = new AnthropicLlm({ model: "m", apiKeyEnv: "X" }, {}, truncated);
  await assert.rejects(llm.group({ atoms: THREE, methodology: "M" }), /truncated/);
});

test("review() throws on a truncated response too", async () => {
  const truncated: CreateMessage = () => Promise.resolve(message([], "max_tokens"));
  const llm = new AnthropicLlm({ model: "m", apiKeyEnv: "X" }, {}, truncated);
  await assert.rejects(llm.review({ atoms: THREE, methodology: "M", lens: "L" }), /truncated/);
});

test("answer() throws on a truncated response rather than returning a mid-sentence reply", async () => {
  const truncated: CreateMessage = () => Promise.resolve(message([{ type: "text", text: "half a sen" } as Anthropic.ContentBlock], "max_tokens"));
  const llm = new AnthropicLlm({ model: "m", apiKeyEnv: "X" }, {}, truncated);
  await assert.rejects(llm.answer({ atoms: THREE, methodology: "M", question: "why?" }), /truncated/);
});

test("group() preserves chapter/section summaries through translation", async () => {
  const withSummaries: CreateMessage = () =>
    Promise.resolve(
      message([toolUse("propose_grouping", { chapters: [{ title: "C", summary: "chap sum", sections: [{ title: "S", summary: "sec sum", atomIds: [1] }] }] })]),
    );
  const llm = new AnthropicLlm({ model: "m", apiKeyEnv: "X" }, {}, withSummaries);
  const grouping = (await llm.group({ atoms: [atom("h1", "a.ts", "a")], methodology: "M" })) as {
    readonly chapters: readonly { readonly summary: unknown; readonly sections: readonly { readonly summary: unknown }[] }[];
  };
  assert.equal(grouping.chapters[0]?.summary, "chap sum");
  assert.equal(grouping.chapters[0]?.sections[0]?.summary, "sec sum");
});

test("group() folds a human reshape request and the placement rule into the system prompt", async () => {
  let system = "";
  const spy: CreateMessage = (params) => {
    system = String(params.system ?? "");
    return Promise.resolve(message([toolUse("propose_grouping", { chapters: [{ title: "C", summary: "s", sections: [{ title: "S", summary: "s", atomIds: [1] }] }] })]));
  };
  const llm = new AnthropicLlm({ model: "m", apiKeyEnv: "X" }, {}, spy);
  await llm.group({ atoms: [atom("h1", "a.ts", "a")], methodology: "METHODOLOGY-TEXT", reshape: "split the tests out" });
  assert.match(system, /METHODOLOGY-TEXT/); // sizing/summary methodology flows from core text, not duplicated
  assert.match(system, /exactly one section/); // placement-completeness robustness line
  assert.match(system, /split the tests out/); // the human's reshape request
});
