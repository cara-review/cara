import { test } from "bun:test";
import assert from "node:assert/strict";
import { fixedClock } from "../clock.ts";
import { classifyWait, createReviewActivity } from "./activity.ts";

test("a fresh tracker starts at the clock's now, not completed", () => {
  const activity = createReviewActivity(fixedClock(1000));
  assert.deepEqual(activity.state(), { lastActivityTs: 1000, completed: false });
});

test("touch advances lastActivityTs to the current clock reading", () => {
  let t = 1000;
  const activity = createReviewActivity({ now: () => t });
  t = 5000;
  activity.touch();
  assert.equal(activity.state().lastActivityTs, 5000);
  assert.equal(activity.state().completed, false);
});

test("complete latches the completed flag", () => {
  const activity = createReviewActivity(fixedClock(1000));
  activity.complete();
  assert.equal(activity.state().completed, true);
});

// --- classifyWait: the three terminal states + pending ----------------------

const base = { lastActivityTs: 1000, now: 1000, startTs: 1000, idleMs: 300_000, maxBlockMs: 240_000 };

test("completed → done regardless of timing", () => {
  assert.equal(classifyWait({ ...base, completed: true }), "done");
});

test("no activity past the idle threshold → reviewIdle", () => {
  assert.equal(classifyWait({ ...base, completed: false, now: base.lastActivityTs + 300_000 }), "reviewIdle");
});

test("block window elapsed while still active → reviewInProgress", () => {
  // Activity kept fresh (now == lastActivityTs) but the block window has elapsed.
  assert.equal(
    classifyWait({ ...base, completed: false, lastActivityTs: 240_000, now: 240_000, startTs: 0 }),
    "reviewInProgress",
  );
});

test("within both windows, still active → pending (keep blocking)", () => {
  assert.equal(classifyWait({ ...base, completed: false, now: base.startTs + 1000 }), "pending");
});

test("idle beats the block window when both have elapsed", () => {
  assert.equal(
    classifyWait({ completed: false, lastActivityTs: 0, now: 400_000, startTs: 0, idleMs: 300_000, maxBlockMs: 240_000 }),
    "reviewIdle",
  );
});
