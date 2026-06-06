import { test } from "node:test";
import assert from "node:assert/strict";
import { SystemClock, fixedClock } from "./clock.ts";

test("SystemClock.now returns the current epoch milliseconds", () => {
  const before = Date.now();
  const now = new SystemClock().now();
  assert.ok(now >= before);
});

test("fixedClock.now always returns the configured value", () => {
  const clock = fixedClock(1234);
  assert.equal(clock.now(), 1234);
  assert.equal(clock.now(), 1234);
});
