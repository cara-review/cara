import { test } from "node:test";
import assert from "node:assert/strict";
import type AnthropicSdk from "@anthropic-ai/sdk";
import { buildMasterList, repairGrouping, type GroupingRequest, type RawHunk } from "@clear-diff/core";
import { AnthropicAgent } from "./anthropic-agent.ts";

function hunk(path: string, text: string): RawHunk {
  return {
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

const atoms = buildMasterList([hunk("a.ts", "0"), hunk("b.ts", "1"), hunk("a.ts", "2")]);

// Minimal shape of a forced tool_use response — enough for the adapter to parse.
type ToolBlock = { type: "tool_use"; name: string; input: unknown };

/**
 * Stub the SDK: capture the request body, return a canned response. No network,
 * no key — `new Anthropic()` is never constructed because a client is injected.
 */
function stubAgent(blocks: readonly ToolBlock[], calls: unknown[]): AnthropicAgent {
  const client = {
    messages: {
      create: (body: unknown) => {
        calls.push(body);
        return Promise.resolve({ content: blocks });
      },
    },
  } as unknown as AnthropicSdk;
  return new AnthropicAgent(client);
}

const validProposal = {
  chapters: [
    { title: "Changes", sections: [{ title: "Everything", atomHashes: atoms.map((a) => a.hash) }] },
  ],
};

test("forces Sonnet to call the grouping tool and sends every atom hash", async () => {
  const calls: unknown[] = [];
  const agent = stubAgent([{ type: "tool_use", name: "propose_grouping", input: validProposal }], calls);

  await agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } });

  const body = calls[0] as {
    model: string;
    tool_choice: { type: string; name: string };
    tools: ReadonlyArray<{ name: string }>;
    messages: ReadonlyArray<{ content: string }>;
  };
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.deepEqual(body.tool_choice, { type: "tool", name: "propose_grouping" });
  assert.equal(body.tools[0]?.name, "propose_grouping");
  for (const atom of atoms) assert.match(body.messages[0]!.content, new RegExp(atom.hash));
});

test("folds personal and project guidance into the prompt (the #26 seam)", async () => {
  const calls: unknown[] = [];
  const agent = stubAgent([{ type: "tool_use", name: "propose_grouping", input: validProposal }], calls);
  const request: GroupingRequest = {
    atoms,
    instructions: { personal: "PERSONAL-GUIDE", project: "PROJECT-GUIDE" },
  };

  await agent.proposeGrouping(request);

  const content = (calls[0] as { messages: ReadonlyArray<{ content: string }> }).messages[0]!.content;
  assert.match(content, /PERSONAL-GUIDE/);
  assert.match(content, /PROJECT-GUIDE/);
});

test("returns the tool input verbatim as unknown, and repairGrouping accepts it", async () => {
  const agent = stubAgent([{ type: "tool_use", name: "propose_grouping", input: validProposal }], []);

  const proposal = await agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } });
  assert.deepEqual(proposal, validProposal);

  const review = repairGrouping(atoms, proposal);
  const placed = review.chapters.flatMap((c) => c.sections.flatMap((s) => s.atoms));
  assert.deepEqual(
    placed.map((a) => a.hash).sort(),
    [...atoms].map((a) => a.hash).sort(),
  );
  assert.ok(!review.chapters.some((c) => c.title === "Other changes"));
});

test("a response with no grouping tool call degrades to a single Other changes chapter", async () => {
  const agent = stubAgent([], []);

  const proposal = await agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } });

  const review = repairGrouping(atoms, proposal);
  assert.equal(review.chapters.length, 1);
  assert.equal(review.chapters[0]!.title, "Other changes");
  assert.equal(
    review.chapters[0]!.sections.flatMap((s) => s.atoms).length,
    atoms.length,
  );
});
