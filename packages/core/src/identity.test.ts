import { test } from "node:test";
import assert from "node:assert/strict";
import { atomPayload, hashAtom } from "./identity.ts";
import type { DiffLine, RawHunk } from "./model.ts";

function hunk(path: string, lines: readonly DiffLine[], ranges?: Partial<RawHunk>): RawHunk {
  return {
    status: "modified",
    path,
    previousPath: null,
    oldStart: 1,
    oldLines: lines.filter((l) => l.kind === "removed").length,
    newStart: 1,
    newLines: lines.filter((l) => l.kind === "added").length,
    lines,
    ...ranges,
  };
}

test("payload prefixes lines and joins in git order", () => {
  const payload = atomPayload([
    { kind: "removed", text: "old" },
    { kind: "added", text: "new" },
  ]);
  assert.equal(payload, "-old\n+new");
});

test("normalisation: CRLF and trailing whitespace do not change identity", () => {
  const a = hashAtom(hunk("f.ts", [{ kind: "added", text: "let x = 1;  " }]));
  const b = hashAtom(hunk("f.ts", [{ kind: "added", text: "let x = 1;\r" }]));
  assert.equal(a, b);
});

test("path distinguishes identical payloads", () => {
  const lines: DiffLine[] = [{ kind: "added", text: "same" }];
  assert.notEqual(hashAtom(hunk("a.ts", lines)), hashAtom(hunk("b.ts", lines)));
});

test("identity excludes line numbers (upstream shift does not disturb a mark)", () => {
  const lines: DiffLine[] = [{ kind: "added", text: "code" }];
  const top = hashAtom(hunk("f.ts", lines, { newStart: 1, oldStart: 1 }));
  const shifted = hashAtom(hunk("f.ts", lines, { newStart: 99, oldStart: 99 }));
  assert.equal(top, shifted);
});

test("editing reviewed lines changes identity (resurfaces)", () => {
  const before = hashAtom(hunk("f.ts", [{ kind: "added", text: "v1" }]));
  const after = hashAtom(hunk("f.ts", [{ kind: "added", text: "v2" }]));
  assert.notEqual(before, after);
});

test("added vs removed of the same text differ", () => {
  assert.notEqual(
    hashAtom(hunk("f.ts", [{ kind: "added", text: "x" }])),
    hashAtom(hunk("f.ts", [{ kind: "removed", text: "x" }])),
  );
});
