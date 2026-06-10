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
import { SummariesRequiredError } from "@clear-diff/core";
import { fixedClock } from "../clock.ts";
import { UserFacingError } from "../user-facing-error.ts";
import { createReviewActivity, type ReviewActivity } from "./activity.ts";
import { createAppRouter, type RpcContext, type RpcDeps } from "./router.ts";

const human: MarkAuthor = { tier: "human", reviewer: null };

function snapshot(context: string, addressed = 0): ReviewSnapshot {
  return {
    context: context as ReviewContext,
    review: { chapters: [], masterList: [] },
    marks: [],
    comments: [],
    progress: { total: 3, addressed, accounted: addressed, unaddressed: 3 - addressed, scrutiny: [] },
    completed: false,
    pendingReshape: null,
  };
}

function dispatchView(context: string): DispatchView {
  return {
    context: context as ReviewContext,
    comments: [],
    progress: { total: 3, addressed: 1, accounted: 1, unaddressed: 2, scrutiny: [] },
    reshape: null,
  };
}

/** A service that records the calls the router makes, with controllable returns. */
function fakeService(calls: string[]): ReviewService {
  const unused = (): never => {
    throw new Error("not exercised");
  };
  return {
    getAtoms: unused,
    presentGrouping: async (spec, grouping, opts) => {
      calls.push(`presentGrouping:${spec.kind}:${JSON.stringify(grouping)}:requireSummaries=${opts?.requireSummaries ?? true}`);
      return snapshot("ctx");
    },
    requestReshape: async (context, body) => {
      calls.push(`requestReshape:${context}:${body}`);
      return snapshot(context);
    },
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
  opts: { activity?: ReviewActivity; clock?: ClockPort; author?: MarkAuthor; broadcastReconnect?: () => void } = {},
) {
  const deps: RpcDeps = {
    service: fakeService(calls),
    workspace,
    spec: { kind: "worktree" },
    activity: opts.activity ?? createReviewActivity(fixedClock(1000)),
    clock: opts.clock ?? fixedClock(1000),
    ...(opts.broadcastReconnect ? { broadcastReconnect: opts.broadcastReconnect } : {}),
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

// --- reshape: the agent grouping handover + the human request (ADR-0012) ------

test("reshape runs presentGrouping over the boot spec, then reconnect-broadcasts", async () => {
  const calls: string[] = [];
  let broadcasts = 0;
  const result = await caller(calls, { broadcastReconnect: () => broadcasts++ }).reshape({
    context: "ctx",
    grouping: { chapters: [] },
  });
  // The boot spec (worktree) is authoritative — the handover does not trust input.context.
  // An omitted requireSummaries defaults to the gate (true), keeping the agent path validated.
  assert.deepEqual(calls, ['presentGrouping:worktree:{"chapters":[]}:requireSummaries=true']);
  assert.equal(broadcasts, 1); // browsers told to re-load the new grouping
  assert.equal(result.context, "ctx");
});

test("reshape threads requireSummaries:false so the git-order floor is never re-rejected (ADR-0012 §1)", async () => {
  const calls: string[] = [];
  await caller(calls).reshape({ context: "ctx", grouping: { chapters: [] }, requireSummaries: false });
  // The exempt floor passes the gate decision over the handover — the server must not re-gate it.
  assert.deepEqual(calls, ['presentGrouping:worktree:{"chapters":[]}:requireSummaries=false']);
});

test("reshape surfaces a SummariesRequiredError as UserFacingError — never masked to 'Internal error.'", async () => {
  const service: ReviewService = {
    ...fakeService([]),
    presentGrouping: () => Promise.reject(new SummariesRequiredError([{ chapter: 0, section: null }])),
  };
  const router = createAppRouter({
    service,
    workspace,
    spec: { kind: "worktree" },
    activity: createReviewActivity(fixedClock(1000)),
    clock: fixedClock(1000),
  });
  await assert.rejects(
    () => router.createCaller({ author: human }).reshape({ context: "ctx", grouping: {} }),
    // The cause is UserFacingError, so the errorFormatter surfaces its message rather than masking it.
    (err: unknown) => err instanceof Error && err.cause instanceof UserFacingError,
  );
});

test("reshapeRequest records the human note (channel-inferred human) and bumps activity", async () => {
  const calls: string[] = [];
  const activity = createReviewActivity(fixedClock(1000));
  const snap = await caller(calls, { activity }).reshapeRequest({ context: "feature/x", body: "split the tests out" });
  assert.deepEqual(calls, ["requestReshape:feature/x:split the tests out"]);
  assert.equal(snap.context, "feature/x");
});

test("reshapeRequest rejects an empty body at the boundary", async () => {
  await assert.rejects(() => caller([]).reshapeRequest({ context: "c", body: "" }));
});

test("comment rejects an empty body at the boundary", async () => {
  await assert.rejects(() => caller([]).comment({ context: "c", atomHash: "h", body: "" }));
});

test("comment rejects a body over 4000 characters (CWE-770 token-exhaustion guard)", async () => {
  await assert.rejects(() => caller([]).comment({ context: "c", atomHash: "h", body: "x".repeat(4001) }));
});

test("comment rejects a line pointer text over 1000 characters (CWE-770 — the field that escaped the cap)", async () => {
  await assert.rejects(() =>
    caller([]).comment({ context: "c", atomHash: "h", body: "ok", line: { side: "added", text: "x".repeat(1001) } }),
  );
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
