import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildMasterList } from "./master-list.ts";
import { hashAtom } from "./identity.ts";
import type { RawHunk } from "./model.ts";

function hunk(path: string, text: string): RawHunk {
  return {
    status: "modified",
    path,
    previousPath: null,
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: "added", text }],
  };
}

test("preserves git order and attaches a hash to each atom", () => {
  const hunks = [hunk("a.ts", "1"), hunk("b.ts", "2"), hunk("c.ts", "3")];
  const atoms = buildMasterList(hunks);
  assert.deepEqual(
    atoms.map((a) => a.path),
    ["a.ts", "b.ts", "c.ts"],
  );
  assert.equal(atoms[0]!.hash, hashAtom(hunks[0]!));
});

test("identical payload+path collapse to one hash but stay distinct entries", () => {
  const atoms = buildMasterList([hunk("a.ts", "same"), hunk("a.ts", "same")]);
  assert.equal(atoms.length, 2); // surface area counted in full
  assert.equal(atoms[0]!.hash, atoms[1]!.hash); // same identity
});
