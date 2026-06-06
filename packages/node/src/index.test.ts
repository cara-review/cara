import { test } from "node:test";
import assert from "node:assert/strict";
import { PACKAGE_ID, coreAtomCount } from "./index.ts";

test("node package wiring smoke test", () => {
  assert.equal(PACKAGE_ID, "@clear-diff/node");
});

test("node resolves core across the workspace boundary", () => {
  assert.equal(
    coreAtomCount([
      {
        status: "modified",
        path: "f.ts",
        previousPath: null,
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: [{ kind: "added", text: "x" }],
      },
    ]),
    1,
  );
});
