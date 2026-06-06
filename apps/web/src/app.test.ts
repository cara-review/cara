import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKAGE_ID, greeting } from "./app.ts";

test("web package wiring smoke test", () => {
  assert.equal(PACKAGE_ID, "@clear-diff/web");
  assert.equal(greeting(), "clear-diff");
});
