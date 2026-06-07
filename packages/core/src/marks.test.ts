import { test } from "bun:test";
import assert from "node:assert/strict";
import { project, isSectionComplete, reviewProgress, type MarkEvent } from "./marks.ts";
import { buildMasterList } from "./master-list.ts";
import type { AtomHash, RawHunk, Section } from "./model.ts";

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

const master = buildMasterList([hunk("a.ts", "0"), hunk("b.ts", "1"), hunk("c.ts", "2")]);
const h = (i: number): AtomHash => master[i]!.hash;
const section = (...idx: number[]): Section => ({
  title: "S",
  summary: null,
  atoms: idx.map((i) => master[i]!),
});

test("project folds marked/unmarked to current state", () => {
  const events: MarkEvent[] = [
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done" },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "skipped" },
    { type: "unmarked", ts: 3, atomHash: h(0) },
  ];
  const { marks } = project(events);
  assert.equal(marks.has(h(0)), false);
  assert.equal(marks.get(h(1)), "skipped");
});

test("last write wins for a hash", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "skipped" },
    { type: "marked", ts: 2, atomHash: h(0), disposition: "done" },
  ]);
  assert.equal(marks.get(h(0)), "done");
});

test("commented events accumulate as comments", () => {
  const { comments } = project([
    { type: "commented", ts: 5, atomHash: h(0), body: "use the retry util" },
  ]);
  assert.deepEqual(comments, [{ atomHash: h(0), body: "use the retry util", ts: 5 }]);
});

test("section completes only when every atom is addressed (skip counts)", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done" },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "skipped" },
  ]);
  assert.equal(isSectionComplete(section(0, 1), marks), true); // done + skipped
  assert.equal(isSectionComplete(section(0, 2), marks), false); // h(2) unaddressed
});

test("empty section is never complete", () => {
  assert.equal(isSectionComplete(section(), new Map()), false);
});

test("progress derives from the master list, counting skipped as addressed", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done" },
    { type: "marked", ts: 2, atomHash: h(2), disposition: "skipped" },
  ]);
  assert.deepEqual(reviewProgress(master, marks), { total: 3, addressed: 2, unaddressed: 1 });
});
