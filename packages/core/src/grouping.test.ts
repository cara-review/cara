import { test } from "bun:test";
import assert from "node:assert/strict";
import { buildMasterList } from "./master-list.ts";
import { findMissingSummaries, repairGrouping, SummariesRequiredError } from "./grouping.ts";
import type { Atom, RawHunk, Review } from "./model.ts";

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

// Four distinct atoms in git order: 0,1,2,3.
const master = buildMasterList([
  hunk("a.ts", "0"),
  hunk("b.ts", "1"),
  hunk("c.ts", "2"),
  hunk("d.ts", "3"),
]);
const h = (i: number): string => master[i]!.hash;

function allAtoms(review: Review): Atom[] {
  return review.chapters.flatMap((c) => c.sections.flatMap((s) => s.atoms));
}

test("bijection: every master atom appears exactly once", () => {
  const review = repairGrouping(master, {
    chapters: [{ title: "One", sections: [{ title: "S", atomHashes: [h(0), h(2)] }] }],
  });
  const placed = allAtoms(review);
  assert.equal(placed.length, master.length);
  // No atom duplicated: distinct hashes equal the master set exactly.
  assert.equal(new Set(placed.map((a) => a.hash)).size, master.length);
  assert.deepEqual(
    [...placed].map((a) => a.hash).sort(),
    [...master].map((a) => a.hash).sort(),
  );
});

test("preserves chapter/section order; atoms forced to git order", () => {
  const review = repairGrouping(master, {
    chapters: [
      { title: "First", sections: [{ title: "S1", atomHashes: [h(2), h(0)] }] }, // reversed
      { title: "Second", sections: [{ title: "S2", atomHashes: [h(1)] }] },
    ],
  });
  assert.equal(review.chapters[0]!.title, "First");
  assert.equal(review.chapters[1]!.title, "Second");
  // S1 atoms re-sorted into git order (0 before 2).
  assert.deepEqual(review.chapters[0]!.sections[0]!.atoms.map((a) => a.path), ["a.ts", "c.ts"]);
});

test("unplaced atoms sweep into a trailing 'Other changes' chapter, git order", () => {
  const review = repairGrouping(master, {
    chapters: [{ title: "One", sections: [{ title: "S", atomHashes: [h(1)] }] }],
  });
  const last = review.chapters[review.chapters.length - 1]!;
  assert.equal(last.title, "Other changes");
  assert.deepEqual(last.sections[0]!.atoms.map((a) => a.path), ["a.ts", "c.ts", "d.ts"]);
});

test("unknown atom references are dropped", () => {
  const review = repairGrouping(master, {
    chapters: [{ title: "One", sections: [{ title: "S", atomHashes: ["deadbeef", h(0)] }] }],
  });
  assert.equal(allAtoms(review).length, master.length);
  assert.deepEqual(review.chapters[0]!.sections[0]!.atoms.map((a) => a.path), ["a.ts"]);
});

test("an atom referenced in two sections is claimed once (no duplication)", () => {
  const review = repairGrouping(master, {
    chapters: [
      {
        title: "One",
        sections: [
          { title: "S1", atomHashes: [h(0)] },
          { title: "S2", atomHashes: [h(0)] }, // same hash, only one master entry
        ],
      },
    ],
  });
  assert.equal(allAtoms(review).length, master.length); // still 4, no dupes
  // S1 claims index 0; S2's repeat finds no remaining index, so S2 is empty and dropped.
  assert.equal(review.chapters[0]!.sections.length, 1);
  assert.equal(review.chapters[0]!.sections[0]!.atoms[0]!.path, "a.ts");
  // b, c, d sweep to Other changes.
  assert.deepEqual(
    review.chapters[1]!.sections[0]!.atoms.map((a) => a.path),
    ["b.ts", "c.ts", "d.ts"],
  );
});

test("garbage proposal degrades to the git-order floor (all in Other changes)", () => {
  for (const garbage of [null, 42, "nope", {}, { chapters: "bad" }, { chapters: [{}] }]) {
    const review = repairGrouping(master, garbage);
    assert.equal(review.chapters.length, 1);
    assert.equal(review.chapters[0]!.title, "Other changes");
    assert.deepEqual(review.chapters[0]!.sections[0]!.atoms.map((a) => a.path), [
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
    ]);
  }
});

test("empty sections and chapters are dropped; summaries coerced", () => {
  const review = repairGrouping(master, {
    chapters: [
      { title: "Empty", sections: [{ title: "none", atomHashes: ["unknown"] }] },
      { title: "Real", summary: "AI overview", sections: [{ title: "S", atomHashes: [h(0)] }] },
    ],
  });
  assert.equal(review.chapters[0]!.title, "Real");
  assert.equal(review.chapters[0]!.summary, "AI overview");
  assert.equal(review.chapters[0]!.sections[0]!.summary, null);
});

test("two identical-payload atoms distribute across two sections (index bijection)", () => {
  const dupMaster = buildMasterList([hunk("x.ts", "same"), hunk("x.ts", "same")]);
  const dupHash = dupMaster[0]!.hash;
  const review = repairGrouping(dupMaster, {
    chapters: [
      {
        title: "C",
        sections: [
          { title: "S1", atomHashes: [dupHash] },
          { title: "S2", atomHashes: [dupHash] },
        ],
      },
    ],
  });
  assert.equal(review.chapters[0]!.sections.length, 2); // both claimed one each
  assert.equal(allAtoms(review).length, 2);
});

test("masterList is carried through unchanged", () => {
  const review = repairGrouping(master, { chapters: [] });
  assert.equal(review.masterList, master);
});

// --- findMissingSummaries (ADR-0012 §1) -------------------------------------

test("all chapters and sections summarised → no missing entries", () => {
  const missing = findMissingSummaries({
    chapters: [{ title: "C", summary: "c", sections: [{ title: "S", summary: "s", atomHashes: [h(0)] }] }],
  });
  assert.deepEqual(missing, []);
});

test("a chapter without a summary is reported with section null", () => {
  const missing = findMissingSummaries({
    chapters: [{ title: "C", sections: [{ title: "S", summary: "s", atomHashes: [h(0)] }] }],
  });
  assert.deepEqual(missing, [{ chapter: 0, section: null }]);
});

test("a section without a summary is reported by its chapter/section index", () => {
  const missing = findMissingSummaries({
    chapters: [{ title: "C", summary: "c", sections: [{ title: "S", atomHashes: [h(0)] }] }],
  });
  assert.deepEqual(missing, [{ chapter: 0, section: 0 }]);
});

test("a blank/whitespace summary counts as missing (same coercion as repair)", () => {
  const missing = findMissingSummaries({
    chapters: [{ title: "C", summary: "   ", sections: [{ title: "S", summary: "", atomHashes: [h(0)] }] }],
  });
  assert.deepEqual(missing, [
    { chapter: 0, section: null },
    { chapter: 0, section: 0 },
  ]);
});

test("missing entries span multiple chapters and sections, indexed by position", () => {
  const missing = findMissingSummaries({
    chapters: [
      { title: "C0", summary: "ok", sections: [{ title: "S0", atomHashes: [h(0)] }] },
      { title: "C1", sections: [{ title: "S0", summary: "ok", atomHashes: [h(1)] }, { title: "S1", atomHashes: [h(2)] }] },
    ],
  });
  assert.deepEqual(missing, [
    { chapter: 0, section: 0 },
    { chapter: 1, section: null },
    { chapter: 1, section: 1 },
  ]);
});

test("the engine-swept floor is never in scope: a proposal with no chapters has no gaps", () => {
  assert.deepEqual(findMissingSummaries({ chapters: [] }), []);
  assert.deepEqual(findMissingSummaries({}), []);
  assert.deepEqual(findMissingSummaries(null), []);
});

test("malformed (non-object) chapters and sections raise no summary gap (repair drops them)", () => {
  const missing = findMissingSummaries({ chapters: [42, { title: "C", summary: "c", sections: ["bad"] }] });
  assert.deepEqual(missing, []);
});

test("SummariesRequiredError carries the missing list and a count-aware message", () => {
  const one = new SummariesRequiredError([{ chapter: 0, section: null }]);
  assert.match(one.message, /1 required summary\b/);
  const two = new SummariesRequiredError([{ chapter: 0, section: null }, { chapter: 0, section: 0 }]);
  assert.match(two.message, /2 required summaries/);
  assert.equal(two.missing.length, 2);
});
