import { test } from "bun:test";
import assert from "node:assert/strict";
import type { AtomHash, ReviewSnapshot, Section } from "./protocol.ts";
import { flatSectionPaths, nextSection, nextUnreviewedSection, prevSection, sectionAt } from "./navigation.ts";
import { section } from "./test-support.ts";

function chapter(title: string, sections: readonly Section[]): ReviewSnapshot["review"]["chapters"][number] {
  return { title, summary: null, sections };
}

function snapshot(
  chapters: ReviewSnapshot["review"]["chapters"],
  marks: ReadonlyArray<{ atomHash: string; disposition: "done" | "skipped" }> = [],
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

// C0[S0(a), S1(b)]  C1[S2(c)]
const THREE = snapshot([
  chapter("C0", [section("S0", ["a"]), section("S1", ["b"])]),
  chapter("C1", [section("S2", ["c"])]),
]);

test("flatSectionPaths lists every Section chapter-major", () => {
  assert.deepEqual(flatSectionPaths(THREE), [
    { chapter: 0, section: 0 },
    { chapter: 0, section: 1 },
    { chapter: 1, section: 0 },
  ]);
});

test("sectionAt resolves a path and returns null when stale", () => {
  assert.equal(sectionAt(THREE, { chapter: 0, section: 1 })?.title, "S1");
  assert.equal(sectionAt(THREE, { chapter: 9, section: 0 }), null);
});

test("nextSection crosses chapter boundaries and clamps at the end", () => {
  assert.deepEqual(nextSection(THREE, { chapter: 0, section: 1 }), { chapter: 1, section: 0 });
  assert.deepEqual(nextSection(THREE, { chapter: 1, section: 0 }), { chapter: 1, section: 0 });
});

test("prevSection clamps at the start", () => {
  assert.deepEqual(prevSection(THREE, { chapter: 1, section: 0 }), { chapter: 0, section: 1 });
  assert.deepEqual(prevSection(THREE, { chapter: 0, section: 0 }), { chapter: 0, section: 0 });
});

test("nextUnreviewedSection skips reviewed Sections and excludes the current one", () => {
  // S1(b) done → from S0 the next unreviewed is S2, not S1.
  const snap = snapshot(
    [chapter("C0", [section("S0", ["a"]), section("S1", ["b"])]), chapter("C1", [section("S2", ["c"])])],
    [{ atomHash: "b", disposition: "done" }],
  );
  assert.deepEqual(nextUnreviewedSection(snap, { chapter: 0, section: 0 }), { chapter: 1, section: 0 });
});

test("nextUnreviewedSection wraps around to find an earlier unreviewed Section", () => {
  // Only S0 unreviewed; from the last Section it wraps back to it.
  const snap = snapshot(
    [chapter("C0", [section("S0", ["a"]), section("S1", ["b"])]), chapter("C1", [section("S2", ["c"])])],
    [{ atomHash: "b", disposition: "done" }, { atomHash: "c", disposition: "skipped" }],
  );
  assert.deepEqual(nextUnreviewedSection(snap, { chapter: 1, section: 0 }), { chapter: 0, section: 0 });
});

test("nextUnreviewedSection excludes `from` itself even when `from` is unreviewed", () => {
  // S0 unreviewed (the focused one), S1 done. Nothing *else* is unreviewed → null,
  // never re-selecting the Section just acted on (guards the empty-Section focus wedge).
  const snap = snapshot(
    [chapter("C0", [section("S0", ["a"]), section("S1", ["b"])])],
    [{ atomHash: "b", disposition: "done" }],
  );
  assert.equal(nextUnreviewedSection(snap, { chapter: 0, section: 0 }), null);
});

test("nextUnreviewedSection returns null when every Section is accounted for", () => {
  const snap = snapshot(
    [chapter("C0", [section("S0", ["a"])])],
    [{ atomHash: "a", disposition: "done" }],
  );
  assert.equal(nextUnreviewedSection(snap, { chapter: 0, section: 0 }), null);
});
