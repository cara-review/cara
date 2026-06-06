import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKAGE_ID, corePackageId } from "./index.ts";

test("node package wiring smoke test", () => {
  assert.equal(PACKAGE_ID, "@clear-diff/node");
});

test("node resolves core across the workspace boundary", () => {
  assert.equal(corePackageId(), "@clear-diff/core");
});
