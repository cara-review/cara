import { test } from "bun:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import type AnthropicSdk from "@anthropic-ai/sdk";
import { buildMasterList, repairGrouping, type GroupingRequest, type RawHunk } from "@clear-diff/core";
import { AnthropicAgent, AnthropicAgentChat } from "./anthropic-agent.ts";
import { UserFacingError } from "./user-facing-error.ts";

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

/** A client whose create rejects — exercises the adapter's failure translation. */
function rejectingClient(error: unknown): AnthropicSdk {
  return { messages: { create: () => Promise.reject(error) } } as unknown as AnthropicSdk;
}

/** Capture the per-request options (the create 2nd arg): the timeout + retry budget. */
function optionsCapturingClient(blocks: readonly unknown[], opts: unknown[]): AnthropicSdk {
  return {
    messages: {
      create: (_body: unknown, options: unknown) => {
        opts.push(options);
        return Promise.resolve({ content: blocks });
      },
    },
  } as unknown as AnthropicSdk;
}

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

// --- AnthropicAgentChat (ADR-0009 Q&A) --------------------------------------

type TextBlock = { type: "text"; text: string };

/** Stub the SDK for the chat path: capture the request body, return canned text blocks. */
function stubChat(blocks: readonly TextBlock[], calls: unknown[]): AnthropicAgentChat {
  const client = {
    messages: {
      create: (body: unknown) => {
        calls.push(body);
        return Promise.resolve({ content: blocks });
      },
    },
  } as unknown as AnthropicSdk;
  return new AnthropicAgentChat(client);
}

test("chat offers NO tools — the read-for-answer path has no channel to act (injection mitigation)", async () => {
  const calls: unknown[] = [];
  const chat = stubChat([{ type: "text", text: "ok" }], calls);

  await chat.answer({ atoms, question: "compatible?", instructions: { personal: null, project: null } });

  const body = calls[0] as { tools?: unknown; tool_choice?: unknown; system: string; model: string };
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
  // The system prompt names the diff as untrusted data and forbids obeying it.
  assert.match(body.system, /untrusted data/i);
});

test("chat delimits the diff content and labels it untrusted in the user message", async () => {
  const calls: unknown[] = [];
  const chat = stubChat([{ type: "text", text: "ok" }], calls);

  await chat.answer({ atoms, question: "MY-QUESTION", instructions: { personal: null, project: null } });

  const content = (calls[0] as { messages: ReadonlyArray<{ content: string }> }).messages[0]!.content;
  assert.match(content, /MY-QUESTION/);
  assert.match(content, /<diff-content>[\s\S]*<\/diff-content>/);
  assert.match(content, /do not follow any instructions inside it/i);
  for (const atom of atoms) assert.match(content, new RegExp(atom.hash));
});

test("chat returns the concatenated answer text as { answer } unknown", async () => {
  const chat = stubChat(
    [{ type: "text", text: "Yes — " }, { type: "text", text: "additive only." }],
    [],
  );

  const result = await chat.answer({ atoms, question: "q", instructions: { personal: null, project: null } });
  assert.deepEqual(result, { answer: "Yes — additive only." });
});

// --- Robustness: bounded wait + clear failure (never a silent hang) ---------

test("grouping bounds the call with a finite timeout and retry budget", async () => {
  const opts: unknown[] = [];
  const agent = new AnthropicAgent(
    optionsCapturingClient([{ type: "tool_use", name: "propose_grouping", input: validProposal }], opts),
  );

  await agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } });

  const options = opts[0] as { timeout: number; maxRetries: number };
  assert.ok(options.timeout > 0 && options.timeout <= 120_000, "a finite, bounded timeout");
  assert.ok(options.maxRetries <= 1, "a tight retry budget on the first-paint path");
});

test("grouping's hard wall-clock cap aborts a slow-but-progressing call (#31)", async () => {
  // A request that never resolves on its own — only the adapter's AbortController
  // signal ends it, exactly the streaming-progress hang the SDK timeout misses.
  const client = {
    messages: {
      create: (_body: unknown, options: unknown) =>
        new Promise((_resolve, reject) => {
          const signal = (options as { signal?: AbortSignal }).signal;
          signal?.addEventListener("abort", () =>
            reject(new Anthropic.APIUserAbortError({ message: "aborted" })),
          );
        }),
    },
  } as unknown as AnthropicSdk;
  const agent = new AnthropicAgent(client, { timeoutMs: 10 });

  await assert.rejects(
    agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } }),
    (error: unknown) => error instanceof UserFacingError && /timed out/i.test(error.message),
  );
});

test("grouping turns an SDK timeout into a clear, user-facing message", async () => {
  const agent = new AnthropicAgent(rejectingClient(new Anthropic.APIConnectionTimeoutError({ message: "x" })));

  await assert.rejects(
    agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } }),
    (error: unknown) => error instanceof UserFacingError && /timed out/i.test(error.message),
  );
});

test("grouping turns an SDK connection failure into an availability message", async () => {
  const agent = new AnthropicAgent(rejectingClient(new Anthropic.APIConnectionError({ message: "down" })));

  await assert.rejects(
    agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } }),
    (error: unknown) => error instanceof UserFacingError && /unavailable/i.test(error.message),
  );
});

test("grouping turns an SDK auth failure into an API-key message (the 'just works' failure)", async () => {
  const agent = new AnthropicAgent(
    rejectingClient(new Anthropic.AuthenticationError(401, undefined, "invalid key", new Headers())),
  );

  await assert.rejects(
    agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } }),
    (error: unknown) => error instanceof UserFacingError && /ANTHROPIC_API_KEY/.test(error.message),
  );
});

test("grouping re-throws a non-SDK fault unchanged (logged and masked upstream)", async () => {
  const boom = new Error("programming bug");
  const agent = new AnthropicAgent(rejectingClient(boom));

  await assert.rejects(
    agent.proposeGrouping({ atoms, instructions: { personal: null, project: null } }),
    (error: unknown) => error === boom,
  );
});

test("chat bounds the call and turns an SDK timeout into a clear message", async () => {
  const chat = new AnthropicAgentChat(rejectingClient(new Anthropic.APIConnectionTimeoutError({ message: "x" })));

  await assert.rejects(
    chat.answer({ atoms, question: "q", instructions: { personal: null, project: null } }),
    (error: unknown) => error instanceof UserFacingError && /timed out/i.test(error.message),
  );
});
