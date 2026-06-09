import { test } from "bun:test";
import assert from "node:assert/strict";
import type { AtomHash, ReviewSnapshot } from "./protocol.ts";
import { marksMap, navTree, sectionRollup } from "./selectors.ts";
import { section } from "./test-support.ts";

function snapshot(
  chapters: ReviewSnapshot["review"]["chapters"],
  marks: ReadonlyArray<{ atomHash: string; disposition: "done" | "skipped" }>,
): ReviewSnapshot {
  const masterList = chapters.flatMap((c) => c.sections.flatMap((s) => s.atoms));
  return {
    context: "ctx" as ReviewSnapshot["context"],
    review: { chapters, masterList },
    marks: marks.map((m) => ({
      atomHash: m.atomHash as AtomHash,
      disposition: m.disposition,
      author: { tier: "human" as const, reviewer: null },
    })),
    comments: [],
    progress: { total: masterList.length, addressed: marks.length, unaddressed: masterList.length - marks.length },
    completed: false,
  };
}

test("sectionRollup: unreviewed when any change is unaddressed", () => {
  const marks = new Map<AtomHash, "done" | "skipped">([["a" as AtomHash, "done"]]);
  const rollup = sectionRollup(section("S", ["a", "b"]), marks);
  assert.deepEqual(rollup, { state: "unreviewed", total: 2, addressed: 1 });
});

test("sectionRollup: done when all addressed and not all skipped", () => {
  const marks = new Map<AtomHash, "done" | "skipped">([
    ["a" as AtomHash, "done"],
    ["b" as AtomHash, "skipped"],
  ]);
  assert.equal(sectionRollup(section("S", ["a", "b"]), marks).state, "done");
});

test("sectionRollup: skipped when every change is skipped", () => {
  const marks = new Map<AtomHash, "done" | "skipped">([
    ["a" as AtomHash, "skipped"],
    ["b" as AtomHash, "skipped"],
  ]);
  assert.equal(sectionRollup(section("S", ["a", "b"]), marks).state, "skipped");
});

test("sectionRollup: empty section reads as unreviewed", () => {
  assert.equal(sectionRollup(section("S", []), new Map()).state, "unreviewed");
});

test("marksMap turns the snapshot marks array into a hash→disposition map", () => {
  const snap = snapshot(
    [{ title: "C", summary: null, sections: [section("S", ["a", "b"])] }],
    [{ atomHash: "a", disposition: "done" }],
  );
  const map = marksMap(snap);
  assert.equal(map.get("a" as AtomHash), "done");
  assert.equal(map.get("b" as AtomHash), undefined);
});

test("navTree counts roll up to the master-list total", () => {
  const snap = snapshot(
    [
      {
        title: "C1",
        summary: null,
        sections: [section("S1", ["a", "b"]), section("S2", ["c"])],
      },
      { title: "C2", summary: null, sections: [section("S3", ["d"])] },
    ],
    [{ atomHash: "a", disposition: "done" }],
  );
  const tree = navTree(snap);
  const counted = tree.flatMap((c) => c.sections).reduce((n, s) => n + s.total, 0);
  assert.equal(counted, snap.review.masterList.length);
  assert.equal(tree[0]?.sections[0]?.state, "unreviewed");
});
