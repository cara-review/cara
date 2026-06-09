import { test } from "bun:test";
import assert from "node:assert/strict";
import type {
  ClockPort,
  DispatchView,
  FileSide,
  MarkAuthor,
  ReviewContext,
  ReviewService,
  ReviewSnapshot,
  WorkspaceReader,
} from "@clear-diff/core";
import { fixedClock } from "../clock.ts";
import { createReviewActivity, type ReviewActivity } from "./activity.ts";
import { createAppRouter, type RpcContext, type RpcDeps } from "./router.ts";

const human: MarkAuthor = { tier: "human", reviewer: null };

function snapshot(context: string, addressed = 0): ReviewSnapshot {
  return {
    context: context as ReviewContext,
    review: { chapters: [], masterList: [] },
    marks: [],
    comments: [],
    progress: { total: 3, addressed, unaddressed: 3 - addressed },
    completed: false,
  };
}

function dispatchView(context: string): DispatchView {
  return { context: context as ReviewContext, comments: [], progress: { total: 3, addressed: 1, unaddressed: 2 } };
}

/** A service that records the calls the router makes, with controllable returns. */
function fakeService(calls: string[]): ReviewService {
  const unused = (): never => {
    throw new Error("not exercised");
  };
  return {
    getAtoms: unused,
    presentGrouping: unused,
    snapshot: async (context) => {
      calls.push(`snapshot:${context}`);
      return snapshot(context);
    },
    mark: async (context, atomHash, disposition, author) => {
      calls.push(`mark:${context}:${atomHash}:${disposition}:${author.tier}/${author.reviewer}`);
      return snapshot(context, 1);
    },
    unmark: async (context, atomHash, author) => {
      calls.push(`unmark:${context}:${atomHash}:${author.tier}`);
      return snapshot(context);
    },
    comment: async (context, atomHash, body, author) => {
      calls.push(`comment:${context}:${atomHash}:${body}:${author.tier}`);
      return snapshot(context);
    },
    submit: unused,
    dispatch: async (spec) => {
      calls.push(`dispatch:${spec.kind}`);
      return dispatchView("ctx");
    },
    markComplete: async (context) => {
      calls.push(`markComplete:${context}`);
    },
    openInEditor: async (path, line) => {
      calls.push(`editor:${path}:${line}`);
    },
  };
}

const workspace: WorkspaceReader = {
  readFile: (path: string, side: FileSide) => Promise.resolve(`${path}@${side}`),
};

function caller(
  calls: string[],
  opts: { activity?: ReviewActivity; clock?: ClockPort; author?: MarkAuthor } = {},
) {
  const deps: RpcDeps = {
    service: fakeService(calls),
    workspace,
    spec: { kind: "worktree" },
    activity: opts.activity ?? createReviewActivity(fixedClock(1000)),
    clock: opts.clock ?? fixedClock(1000),
  };
  const ctx: RpcContext = { author: opts.author ?? human };
  return createAppRouter(deps).createCaller(ctx);
}

test("snapshot query reads the current snapshot for the context", async () => {
  const calls: string[] = [];
  const snap = await caller(calls).snapshot({ context: "feature/x" });
  assert.deepEqual(calls, ["snapshot:feature/x"]);
  assert.equal(snap.context, "feature/x");
});

test("mark stamps the channel-inferred human tier — no input can forge it", async () => {
  const calls: string[] = [];
  await caller(calls).mark({ context: "feature/x", atomHash: "abc", disposition: "done" });
  assert.deepEqual(calls, ["mark:feature/x:abc:done:human/null"]);
});

test("done marks the context complete and flips the activity flag", async () => {
  const calls: string[] = [];
  const activity = createReviewActivity(fixedClock(1000));
  const result = await caller(calls, { activity }).done({ context: "c" });
  assert.equal(result, null);
  assert.deepEqual(calls, ["markComplete:c"]);
  assert.equal(activity.state().completed, true);
});

test("a mutation bumps the activity tracker", async () => {
  let t = 1000;
  const activity = createReviewActivity({ now: () => t });
  t = 9000;
  await caller([], { activity }).comment({ context: "c", atomHash: "h", body: "x" });
  assert.equal(activity.state().lastActivityTs, 9000);
});

// --- wait: the three terminal states, no real sleeping -----------------------

test("wait returns done with the dispatch view once the human completes", async () => {
  const calls: string[] = [];
  const activity = createReviewActivity(fixedClock(1000));
  activity.complete();
  const result = await caller(calls, { activity }).wait({ context: "ctx" });
  assert.equal(result.state, "done");
  assert.ok(result.state === "done" && result.view.context === "ctx");
  assert.ok(calls.includes("dispatch:worktree"));
});

test("wait returns reviewIdle after the idle threshold with no activity", async () => {
  const activity = createReviewActivity(fixedClock(0)); // last activity at t=0
  const result = await caller([], { activity, clock: fixedClock(400_000) }).wait({ context: "ctx" });
  assert.equal(result.state, "reviewIdle");
  assert.ok(result.state === "reviewIdle" && result.progress.total === 3);
});

test("wait returns reviewInProgress once the block window elapses while active", async () => {
  // A clock that advances past the block window between startTs and the first check,
  // with activity kept fresh so idle does not fire.
  let call = 0;
  const clock: ClockPort = { now: () => (call++ === 0 ? 0 : 100_000) };
  const activity = createReviewActivity(fixedClock(100_000));
  const result = await caller([], { activity, clock }).wait({ context: "ctx", maxBlockMs: 5000, idleMs: 1_000_000 });
  assert.equal(result.state, "reviewInProgress");
});

test("wait's window inputs are integer-ms and bounded — the CLI must round + stay in range", async () => {
  // A fractional ms (a fractional --timeout that doesn't land on a whole ms) is rejected:
  // the verb rounds before sending, so this contract must stay strict to catch a regression.
  await assert.rejects(() => caller([]).wait({ context: "ctx", maxBlockMs: 1000.5 }));
  // An unbounded window is rejected so a loopback page can't park a long-lived block.
  await assert.rejects(() => caller([]).wait({ context: "ctx", maxBlockMs: 9_999_999_999 }));
});

// --- security invariants preserved -------------------------------------------

test("readFile round-trips the WorkspaceReader; openInEditor resolves to null", async () => {
  const calls: string[] = [];
  assert.deepEqual(await caller(calls).readFile({ path: "src/a.ts", side: "head" }), { text: "src/a.ts@head" });
  assert.equal(await caller(calls).openInEditor({ path: "src/a.ts", line: 12 }), null);
});

test("an empty context, a bad disposition, and a traversal path are all rejected", async () => {
  await assert.rejects(() => caller([]).unmark({ context: "   ", atomHash: "h" }));
  await assert.rejects(() => caller([]).mark({ context: "c", atomHash: "h", disposition: "maybe" } as never));
  await assert.rejects(() => caller([]).readFile({ path: "../../etc/passwd", side: "head" }));
  await assert.rejects(() => caller([]).openInEditor({ path: "-rf", line: 1 }));
});
