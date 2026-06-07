import { test } from "bun:test";
import assert from "node:assert/strict";
import type { Atom, AtomHash, Section } from "../protocol.ts";
import { groupByFile } from "./diff-model.ts";

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

test("groupByFile groups consecutive atoms of the same file into one card", () => {
  const groups = groupByFile(
    sectionOf([
      atom({ path: "a.ts", newStart: 1, newLines: 2 }),
      atom({ path: "a.ts", newStart: 10, newLines: 1 }),
      atom({ path: "b.ts", newStart: 5, newLines: 1 }),
    ]),
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.path, "a.ts");
  assert.equal(groups[0]?.atoms.length, 2);
  assert.equal(groups[1]?.path, "b.ts");
  assert.equal(groups[1]?.atoms.length, 1);
});

test("groupByFile carries the file's status and a rename's previous path", () => {
  const groups = groupByFile(
    sectionOf([
      atom({ path: "new.ts", newStart: 1, newLines: 1, status: "renamed", previousPath: "old.ts" }),
    ]),
  );
  assert.equal(groups[0]?.status, "renamed");
  assert.equal(groups[0]?.previousPath, "old.ts");
});

test("groupByFile re-opens a new card when a file recurs non-consecutively", () => {
  const groups = groupByFile(
    sectionOf([
      atom({ path: "a.ts", newStart: 1, newLines: 1 }),
      atom({ path: "b.ts", newStart: 1, newLines: 1 }),
      atom({ path: "a.ts", newStart: 50, newLines: 1 }),
    ]),
  );
  assert.deepEqual(groups.map((g) => g.path), ["a.ts", "b.ts", "a.ts"]);
});
