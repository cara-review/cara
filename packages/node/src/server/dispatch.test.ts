import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  FileSide,
  ReviewContext,
  ReviewService,
  ReviewSnapshot,
  WorkspaceReader,
} from "@clear-diff/core";
import { handleRequest, type RpcDeps } from "./dispatch.ts";

function snapshot(context: string): ReviewSnapshot {
  return {
    context: context as ReviewContext,
    review: { chapters: [], masterList: [] },
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

function deps(calls: string[]): RpcDeps {
  return { service: fakeService(calls), workspace, spec: { kind: "worktree" } };
}

test("open dispatches to the inbound port with the boot spec", async () => {
  const calls: string[] = [];
  const response = await handleRequest(deps(calls), { id: "1", method: "open", params: {} });

  assert.deepEqual(calls, ["open:worktree"]);
  assert.equal(response.id, "1");
  assert.ok(response.ok && response.result !== null && "context" in response.result);
});

test("mark passes branded context, atom hash, and disposition through", async () => {
  const calls: string[] = [];
  const response = await handleRequest(deps(calls), {
    id: "2",
    method: "mark",
    params: { context: "feature/x", atomHash: "abc", disposition: "done" },
  });

  assert.deepEqual(calls, ["mark:feature/x:abc:done"]);
  assert.ok(response.ok);
});

test("dispatch passes the branded context through and returns the receipt", async () => {
  const calls: string[] = [];
  const response = await handleRequest(deps(calls), {
    id: "d",
    method: "dispatch",
    params: { context: "feature/x" },
  });

  assert.deepEqual(calls, ["dispatch:feature/x"]);
  assert.ok(response.ok);
  assert.deepEqual(response.result, { count: 0, location: "sink://feature/x" });
});

test("ask passes the branded context, chapter index, and question through (ADR-0009)", async () => {
  const calls: string[] = [];
  const response = await handleRequest(deps(calls), {
    id: "a",
    method: "ask",
    params: { context: "feature/x", chapterIndex: 2, question: "is this backwards compatible?" },
  });

  assert.deepEqual(calls, ["ask:feature/x:2:is this backwards compatible?"]);
  assert.ok(response.ok);
  assert.deepEqual(response.result, { answer: "re 2: is this backwards compatible?" });
});

test("ask rejects a negative, non-integer, or non-number chapter index", async () => {
  for (const chapterIndex of [-1, 1.5, "0"]) {
    const response = await handleRequest(deps([]), {
      id: "ai",
      method: "ask",
      params: { context: "c", chapterIndex, question: "q" },
    });
    assert.ok(!response.ok && /chapterIndex/.test(response.error), `chapterIndex=${chapterIndex}`);
  }
});

test("ask rejects an empty or whitespace-only question", async () => {
  for (const question of ["", "   "]) {
    const response = await handleRequest(deps([]), {
      id: "aq",
      method: "ask",
      params: { context: "c", chapterIndex: 0, question },
    });
    assert.ok(!response.ok && /question/.test(response.error), `question=${JSON.stringify(question)}`);
  }
});

test("readFile round-trips the WorkspaceReader", async () => {
  const response = await handleRequest(deps([]), {
    id: "3",
    method: "readFile",
    params: { path: "src/a.ts", side: "head" },
  });

  assert.ok(response.ok);
  assert.deepEqual(response.result, { text: "src/a.ts@head" });
});

test("openInEditor resolves to a null result", async () => {
  const calls: string[] = [];
  const response = await handleRequest(deps(calls), {
    id: "4",
    method: "openInEditor",
    params: { path: "src/a.ts", line: 12 },
  });

  assert.deepEqual(calls, ["editor:src/a.ts:12"]);
  assert.ok(response.ok);
  assert.equal(response.result, null);
});

test("an unknown method is an error response, not a throw", async () => {
  const response = await handleRequest(deps([]), { id: "5", method: "bogus", params: {} });
  assert.equal(response.id, "5");
  assert.ok(!response.ok && /unknown method/i.test(response.error));
});

test("a non-object request yields an error with an empty id", async () => {
  const response = await handleRequest(deps([]), 42);
  assert.equal(response.id, "");
  assert.ok(!response.ok);
});

test("missing required params are rejected", async () => {
  const response = await handleRequest(deps([]), {
    id: "6",
    method: "mark",
    params: { context: "c", atomHash: "h" },
  });
  assert.ok(!response.ok && /disposition/.test(response.error));
});

test("an invalid disposition is rejected", async () => {
  const response = await handleRequest(deps([]), {
    id: "7",
    method: "mark",
    params: { context: "c", atomHash: "h", disposition: "maybe" },
  });
  assert.ok(!response.ok && /disposition/.test(response.error));
});

test("an empty context is rejected by the smart-constructor", async () => {
  const response = await handleRequest(deps([]), {
    id: "8",
    method: "unmark",
    params: { context: "   ", atomHash: "h" },
  });
  assert.ok(!response.ok);
});

test("openInEditor rejects a non-positive or non-integer line", async () => {
  for (const line of [0, -3, 1.5]) {
    const response = await handleRequest(deps([]), {
      id: "n",
      method: "openInEditor",
      params: { path: "a.ts", line },
    });
    assert.ok(!response.ok && /positive integer/.test(response.error), `line=${line}`);
  }
});

test("readFile rejects a path that escapes the repository", async () => {
  for (const path of ["../../etc/passwd", "/etc/passwd"]) {
    const response = await handleRequest(deps([]), {
      id: "t",
      method: "readFile",
      params: { path, side: "head" },
    });
    assert.ok(!response.ok, path);
  }
});

test("openInEditor rejects a path that could be read as an editor flag", async () => {
  const response = await handleRequest(deps([]), {
    id: "f",
    method: "openInEditor",
    params: { path: "-rf", line: 1 },
  });
  assert.ok(!response.ok);
});

test("a use-case failure is masked behind a generic error", async () => {
  const reject = () => Promise.reject(new Error("git stderr: /Users/secret/path leaked"));
  const failing: ReviewService = {
    open: reject,
    mark: reject,
    unmark: reject,
    comment: reject,
    dispatch: reject,
    ask: reject,
    openInEditor: reject,
  };
  const response = await handleRequest(
    { service: failing, workspace, spec: { kind: "worktree" } },
    { id: "9", method: "open", params: {} },
  );
  assert.ok(!response.ok);
  assert.equal(response.error, "Internal error.");
});
