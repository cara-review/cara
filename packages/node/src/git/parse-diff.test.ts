import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawHunk } from "@clear-diff/core";
import { parseDiff } from "./parse-diff.ts";

test("empty diff yields no hunks", () => {
  assert.deepEqual(parseDiff(""), []);
});

test("added file: status added, /dev/null base, added lines only", () => {
  const out = [
    "diff --git a/added.txt b/added.txt",
    "new file mode 100644",
    "index 0000000..3b18e51",
    "--- /dev/null",
    "+++ b/added.txt",
    "@@ -0,0 +1,2 @@",
    "+hello",
    "+world",
    "",
  ].join("\n");
  assert.deepEqual(parseDiff(out), [
    {
      status: "added",
      path: "added.txt",
      previousPath: null,
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: "added", text: "hello" },
        { kind: "added", text: "world" },
      ],
    },
  ] satisfies RawHunk[]);
});

test("deleted file: status deleted, removed lines only", () => {
  const out = [
    "diff --git a/gone.txt b/gone.txt",
    "deleted file mode 100644",
    "index 3b18e51..0000000",
    "--- a/gone.txt",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-bye",
    "-now",
    "",
  ].join("\n");
  assert.deepEqual(parseDiff(out), [
    {
      status: "deleted",
      path: "gone.txt",
      previousPath: null,
      oldStart: 1,
      oldLines: 2,
      newStart: 0,
      newLines: 0,
      lines: [
        { kind: "removed", text: "bye" },
        { kind: "removed", text: "now" },
      ],
    },
  ]);
});

test("multi-hunk modify: one RawHunk per @@, omitted count defaults to 1", () => {
  const out = [
    "diff --git a/f.txt b/f.txt",
    "index 1234567..89abcde 100644",
    "--- a/f.txt",
    "+++ b/f.txt",
    "@@ -1 +1 @@",
    "-old first",
    "+new first",
    "@@ -10,2 +10 @@",
    "-old ten",
    "-old eleven",
    "+new ten",
    "",
  ].join("\n");
  const hunks = parseDiff(out);
  assert.equal(hunks.length, 2);
  assert.deepEqual(hunks[0], {
    status: "modified",
    path: "f.txt",
    previousPath: null,
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [
      { kind: "removed", text: "old first" },
      { kind: "added", text: "new first" },
    ],
  });
  assert.deepEqual(hunks[1], {
    status: "modified",
    path: "f.txt",
    previousPath: null,
    oldStart: 10,
    oldLines: 2,
    newStart: 10,
    newLines: 1,
    lines: [
      { kind: "removed", text: "old ten" },
      { kind: "removed", text: "old eleven" },
      { kind: "added", text: "new ten" },
    ],
  });
});

test("rename with changes: status renamed, path + previousPath set", () => {
  const out = [
    "diff --git a/old/name.txt b/new/name.txt",
    "similarity index 80%",
    "rename from old/name.txt",
    "rename to new/name.txt",
    "index 1234567..89abcde 100644",
    "--- a/old/name.txt",
    "+++ b/new/name.txt",
    "@@ -3 +3 @@",
    "-three old",
    "+three new",
    "",
  ].join("\n");
  assert.deepEqual(parseDiff(out), [
    {
      status: "renamed",
      path: "new/name.txt",
      previousPath: "old/name.txt",
      oldStart: 3,
      oldLines: 1,
      newStart: 3,
      newLines: 1,
      lines: [
        { kind: "removed", text: "three old" },
        { kind: "added", text: "three new" },
      ],
    },
  ]);
});

test("pure rename (no @@) yields no hunks", () => {
  const out = [
    "diff --git a/a.txt b/b.txt",
    "similarity index 100%",
    "rename from a.txt",
    "rename to b.txt",
    "",
  ].join("\n");
  assert.deepEqual(parseDiff(out), []);
});

test("no-newline markers are skipped", () => {
  const out = [
    "diff --git a/nonl.txt b/nonl.txt",
    "index 1234567..89abcde 100644",
    "--- a/nonl.txt",
    "+++ b/nonl.txt",
    "@@ -1 +1 @@",
    "-old",
    "\\ No newline at end of file",
    "+new",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  assert.deepEqual(parseDiff(out)[0]?.lines, [
    { kind: "removed", text: "old" },
    { kind: "added", text: "new" },
  ]);
});

test("hunks with no resolvable path throw rather than emit an empty path", () => {
  const out = [
    "diff --git a/x.txt b/x.txt",
    "index 1234567..89abcde 100644",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  assert.throws(() => parseDiff(out), /no path/);
});

test("multiple files parse in git order", () => {
  const out = [
    "diff --git a/one.txt b/one.txt",
    "new file mode 100644",
    "index 0000000..aaa",
    "--- /dev/null",
    "+++ b/one.txt",
    "@@ -0,0 +1 @@",
    "+first",
    "diff --git a/two.txt b/two.txt",
    "new file mode 100644",
    "index 0000000..bbb",
    "--- /dev/null",
    "+++ b/two.txt",
    "@@ -0,0 +1 @@",
    "+second",
    "",
  ].join("\n");
  const hunks = parseDiff(out);
  assert.deepEqual(
    hunks.map((h) => h.path),
    ["one.txt", "two.txt"],
  );
});

test("a path containing a space: git's trailing-tab delimiter is stripped", () => {
  // git appends a tab to the ---/+++ path when the name contains a space, so the
  // name's boundary is unambiguous. The tab is a delimiter, not part of the path.
  const out = [
    "diff --git a/src/with space.ts b/src/with space.ts",
    "index cc798ff..9607546 100644",
    "--- a/src/with space.ts\t",
    "+++ b/src/with space.ts\t",
    "@@ -1 +1 @@",
    "-export const a = 1;",
    "+export const a = 11;",
    "",
  ].join("\n");
  const hunks = parseDiff(out);
  assert.equal(hunks[0]?.path, "src/with space.ts");
});
