import { test } from "bun:test";
import assert from "node:assert/strict";
import type { FileSide, ReviewContext, ReviewService, ReviewSnapshot, WorkspaceReader } from "@clear-diff/core";
import { createAppRouter, type OpenEvent, type RpcDeps } from "./router.ts";

function snapshot(context: string): ReviewSnapshot {
  return {
    context: context as ReviewContext,
    review: {
      chapters: [
        { title: "C1", summary: null, sections: [{ title: "S1", summary: null, atoms: [] }] },
        { title: "C2", summary: null, sections: [{ title: "S2", summary: null, atoms: [] }] },
      ],
      masterList: [],
    },
    marks: [],
    comments: [],
    progress: { total: 0, addressed: 0, unaddressed: 0 },
  };
}

function fakeService(calls: string[]): ReviewService {
  return {
    open: async (spec) => {
      calls.push(`open:${spec.kind}`);
      return snapshot("ctx");
    },
    mark: async (context, atomHash, disposition) => {
      calls.push(`mark:${context}:${atomHash}:${disposition}`);
      return snapshot(context);
    },
    unmark: async (context, atomHash) => {
      calls.push(`unmark:${context}:${atomHash}`);
      return snapshot(context);
    },
    comment: async (context, atomHash, body) => {
      calls.push(`comment:${context}:${atomHash}:${body}`);
      return snapshot(context);
    },
    dispatch: async (context) => {
      calls.push(`dispatch:${context}`);
      return { count: 0, location: `sink://${context}` };
    },
    ask: async (context, chapterIndex, question) => {
      calls.push(`ask:${context}:${chapterIndex}:${question}`);
      return { answer: `re ${chapterIndex}: ${question}` };
    },
    openInEditor: async (path, line) => {
      calls.push(`editor:${path}:${line}`);
    },
  };
}

const workspace: WorkspaceReader = {
  readFile: (path: string, side: FileSide) => Promise.resolve(`${path}@${side}`),
};

function caller(calls: string[]) {
  const deps: RpcDeps = { service: fakeService(calls), workspace, spec: { kind: "worktree" } };
  return createAppRouter(deps).createCaller({});
}

test("open streams progress/section events ending with the snapshot, using the boot spec", async () => {
  const calls: string[] = [];
  const events: OpenEvent[] = [];
  for await (const event of await caller(calls).open()) events.push(event);

  assert.deepEqual(calls, ["open:worktree"]);
  const titles = events.filter((e) => e.kind === "section").map((e) => (e.kind === "section" ? e.title : ""));
  assert.deepEqual(titles, ["S1", "S2"]);
  const last = events.at(-1);
  assert.ok(last?.kind === "snapshot" && last.snapshot.context === "ctx");
});

test("mark passes branded context, atom hash, and disposition through", async () => {
  const calls: string[] = [];
  await caller(calls).mark({ context: "feature/x", atomHash: "abc", disposition: "done" });
  assert.deepEqual(calls, ["mark:feature/x:abc:done"]);
});

test("dispatch passes the branded context through and returns the receipt", async () => {
  const calls: string[] = [];
  const receipt = await caller(calls).dispatch({ context: "feature/x" });
  assert.deepEqual(calls, ["dispatch:feature/x"]);
  assert.deepEqual(receipt, { count: 0, location: "sink://feature/x" });
});

test("ask passes context, chapter index, and question through (ADR-0009)", async () => {
  const calls: string[] = [];
  const answer = await caller(calls).ask({
    context: "feature/x",
    chapterIndex: 2,
    question: "is this backwards compatible?",
  });
  assert.deepEqual(calls, ["ask:feature/x:2:is this backwards compatible?"]);
  assert.deepEqual(answer, { answer: "re 2: is this backwards compatible?" });
});

test("ask rejects a negative or non-integer chapter index", async () => {
  for (const chapterIndex of [-1, 1.5]) {
    await assert.rejects(() => caller([]).ask({ context: "c", chapterIndex, question: "q" }));
  }
});

test("ask rejects an empty or whitespace-only question", async () => {
  for (const question of ["", "   "]) {
    await assert.rejects(() => caller([]).ask({ context: "c", chapterIndex: 0, question }));
  }
});

test("readFile round-trips the WorkspaceReader", async () => {
  const result = await caller([]).readFile({ path: "src/a.ts", side: "head" });
  assert.deepEqual(result, { text: "src/a.ts@head" });
});

test("openInEditor resolves to a null result", async () => {
  const calls: string[] = [];
  const result = await caller(calls).openInEditor({ path: "src/a.ts", line: 12 });
  assert.deepEqual(calls, ["editor:src/a.ts:12"]);
  assert.equal(result, null);
});

test("an invalid disposition is rejected", async () => {
  await assert.rejects(() => caller([]).mark({ context: "c", atomHash: "h", disposition: "maybe" } as never));
});

test("an empty / whitespace-only context is rejected at the boundary", async () => {
  await assert.rejects(() => caller([]).unmark({ context: "   ", atomHash: "h" }));
});

test("openInEditor rejects a non-positive or non-integer line", async () => {
  for (const line of [0, -3, 1.5]) {
    await assert.rejects(() => caller([]).openInEditor({ path: "a.ts", line }));
  }
});

test("readFile rejects a path that escapes the repository", async () => {
  for (const path of ["../../etc/passwd", "/etc/passwd", "a/../../b"]) {
    await assert.rejects(() => caller([]).readFile({ path, side: "head" }));
  }
});

test("openInEditor rejects a path that could be read as an editor flag", async () => {
  await assert.rejects(() => caller([]).openInEditor({ path: "-rf", line: 1 }));
});
