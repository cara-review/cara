import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKAGE_ID } from "./index.ts";

test("core package wiring smoke test", () => {
  assert.equal(PACKAGE_ID, "@clear-diff/core");
});
