import { test } from "node:test";
import assert from "node:assert/strict";
import type { Atom, AtomHash, DiffLine } from "../protocol.ts";
import { revertAtoms, syntheticBuffers } from "./synthetic-buffers.ts";

function atom(over: Partial<Atom> & { path: string; newStart: number; newLines: number; lines: DiffLine[] }): Atom {
  return {
    status: "modified",
    previousPath: null,
    oldStart: over.newStart,
    oldLines: over.lines.filter((l) => l.kind === "removed").length,
    hash: `${over.path}:${over.newStart}` as AtomHash,
    ...over,
  };
}

// A small head file: a changed function at the top, unchanged middle, tests at the bottom.
const HEAD = [
  "export function refresh() {", // 1
  '  return post("/refresh");', //  2  (Section 1: main change)
  "}", //                            3
  "", //                             4
  "const stable = 1;", //            5  (unchanged middle)
  "const alsoStable = 2;", //        6
  "", //                             7
  'test("refresh posts", () => {', // 8  (Section 2: tests)
  "  expect(refresh()).ok;", //      9
  "});", //                          10
].join("\n");

const mainChange = atom({
  path: "index.ts",
  newStart: 2,
  newLines: 1,
  oldStart: 2,
  lines: [
    { kind: "removed", text: '  return get("/refresh");' },
    { kind: "added", text: '  return post("/refresh");' },
  ],
});

const testChange = atom({
  path: "index.ts",
  newStart: 8,
  newLines: 3,
  oldStart: 8,
  lines: [
    { kind: "removed", text: 'test("refresh works", () => {' },
    { kind: "removed", text: "  expect(refresh()).truthy;" },
    { kind: "removed", text: "}); // legacy" },
    { kind: "added", text: 'test("refresh posts", () => {' },
    { kind: "added", text: "  expect(refresh()).ok;" },
    { kind: "added", text: "});" },
  ],
});

test("modified is always the verbatim head text", () => {
  assert.equal(syntheticBuffers(HEAD, [mainChange]).modified, HEAD);
});

test("reverting one atom changes only its footprint; the other section's change stays at head", () => {
  // Render Section 1: only the main change should differ from head; the tests must be
  // identical on both sides (so Monaco folds them away).
  const original = revertAtoms(HEAD, [mainChange]).split("\n");
  assert.equal(original[1], '  return get("/refresh");'); // reverted to base
  assert.equal(original[7], 'test("refresh posts", () => {'); // tests untouched (== head)
  assert.equal(original[9], "});");
  assert.equal(original.length, 10);
});

test("the only differing lines equal the chosen atom's footprint", () => {
  const head = HEAD.split("\n");
  const original = revertAtoms(HEAD, [testChange]).split("\n");
  const differing = original.map((l, i) => (l === head[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(differing, [7, 8, 9]); // exactly the tests footprint, head lines 8–10
});

test("multiple atoms in one file revert together (bottom-up splice stays consistent)", () => {
  const original = revertAtoms(HEAD, [mainChange, testChange]).split("\n");
  assert.equal(original[1], '  return get("/refresh");');
  assert.equal(original[7], 'test("refresh works", () => {');
  assert.equal(original[8], "  expect(refresh()).truthy;");
});

test("pure addition: reverting deletes the added lines", () => {
  const head = ["a", "NEW-1", "NEW-2", "b"].join("\n");
  const added = atom({
    path: "f.ts",
    newStart: 2,
    newLines: 2,
    oldStart: 1,
    oldLines: 0,
    lines: [
      { kind: "added", text: "NEW-1" },
      { kind: "added", text: "NEW-2" },
    ],
  });
  assert.equal(revertAtoms(head, [added]), "a\nb");
});

test("pure deletion: reverting reinserts the removed lines after the head anchor", () => {
  // base had lines 5–6 removed; git `@@ -5,2 +4,0 @@` → newStart 4, newLines 0.
  const head = ["l1", "l2", "l3", "l4", "l7"].join("\n");
  const deletion = atom({
    path: "f.ts",
    newStart: 4,
    newLines: 0,
    oldStart: 5,
    oldLines: 2,
    lines: [
      { kind: "removed", text: "l5" },
      { kind: "removed", text: "l6" },
    ],
  });
  assert.equal(revertAtoms(head, [deletion]), "l1\nl2\nl3\nl4\nl5\nl6\nl7");
});
