import { test } from "node:test";
import assert from "node:assert/strict";
import type { Atom, AtomHash, DiffLine, Section } from "../protocol.ts";
import { diffModel, numberedLines } from "./diff-model.ts";

function atom(over: Partial<Atom> & { path: string; newStart: number; newLines: number }): Atom {
  return {
    status: "modified",
    previousPath: null,
    oldStart: over.newStart,
    oldLines: over.newLines,
    lines: [{ kind: "added", text: "x" }],
    hash: `${over.path}:${over.newStart}` as AtomHash,
    ...over,
  };
}

function sectionOf(atoms: readonly Atom[]): Section {
  return { title: "S", summary: null, atoms };
}

test("numberedLines numbers removed by base side and added by head side", () => {
  const lines: DiffLine[] = [
    { kind: "removed", text: "old-1" },
    { kind: "removed", text: "old-2" },
    { kind: "added", text: "new-1" },
  ];
  const a = atom({ path: "f.ts", newStart: 20, newLines: 1, oldStart: 10, oldLines: 2, lines });
  assert.deepEqual(
    numberedLines(a).map((l) => [l.kind, l.lineNo, l.text]),
    [
      ["removed", 10, "old-1"],
      ["removed", 11, "old-2"],
      ["added", 20, "new-1"],
    ],
  );
});

test("diffModel groups consecutive atoms of the same file into one card", () => {
  const groups = diffModel(
    sectionOf([
      atom({ path: "a.ts", newStart: 1, newLines: 2 }),
      atom({ path: "a.ts", newStart: 10, newLines: 1 }),
      atom({ path: "b.ts", newStart: 5, newLines: 1 }),
    ]),
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.path, "a.ts");
  assert.equal(groups[0]?.blocks.length, 2);
  assert.equal(groups[1]?.path, "b.ts");
});

test("diffModel computes the hidden-line gap and head range between blocks of a file", () => {
  const groups = diffModel(
    sectionOf([
      atom({ path: "a.ts", newStart: 1, newLines: 2 }), // head lines 1–2
      atom({ path: "a.ts", newStart: 10, newLines: 1 }), // head line 10
    ]),
  );
  assert.equal(groups[0]?.blocks[0]?.gap, null);
  assert.deepEqual(groups[0]?.blocks[1]?.gap, { hiddenLines: 7, headStart: 3, headEnd: 9 });
});

test("diffModel anchors the gap correctly when the preceding block is a pure deletion", () => {
  // Pure deletion of base lines 5–6 → newStart 4 / newLines 0 (git `@@ -5,2 +4,0 @@`):
  // its block occupies no head line, so context resumes at head line 5, not 4.
  const groups = diffModel(
    sectionOf([
      atom({ path: "a.ts", newStart: 4, newLines: 0, oldStart: 5, oldLines: 2 }),
      atom({ path: "a.ts", newStart: 8, newLines: 1 }), // head line 8
    ]),
  );
  assert.deepEqual(groups[0]?.blocks[1]?.gap, { hiddenLines: 3, headStart: 5, headEnd: 7 });
});

test("diffModel keeps the next block's line in the gap when that block is a pure deletion", () => {
  const groups = diffModel(
    sectionOf([
      atom({ path: "a.ts", newStart: 1, newLines: 1 }), // head line 1
      atom({ path: "a.ts", newStart: 6, newLines: 0, oldStart: 7, oldLines: 1 }), // deletion after head line 6
    ]),
  );
  // Context = head lines 2..6 (line 6 is unchanged context before the deletion point).
  assert.deepEqual(groups[0]?.blocks[1]?.gap, { hiddenLines: 5, headStart: 2, headEnd: 6 });
});

test("diffModel keeps adjacent blocks gapless", () => {
  const groups = diffModel(
    sectionOf([
      atom({ path: "a.ts", newStart: 1, newLines: 2 }), // head lines 1–2
      atom({ path: "a.ts", newStart: 3, newLines: 1 }), // head line 3 — immediately after
    ]),
  );
  assert.equal(groups[0]?.blocks[1]?.gap, null);
});

test("diffModel re-opens a new card when a file recurs non-consecutively", () => {
  const groups = diffModel(
    sectionOf([
      atom({ path: "a.ts", newStart: 1, newLines: 1 }),
      atom({ path: "b.ts", newStart: 1, newLines: 1 }),
      atom({ path: "a.ts", newStart: 50, newLines: 1 }),
    ]),
  );
  assert.deepEqual(groups.map((g) => g.path), ["a.ts", "b.ts", "a.ts"]);
});
