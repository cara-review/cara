import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  project,
  deriveCommentStatus,
  isSectionComplete,
  reviewProgress,
  type MarkEvent,
} from "./marks.ts";
import { buildMasterList } from "./master-list.ts";
import type { AtomHash, MarkAuthor, RawHunk, Section } from "./model.ts";

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

const HUMAN: MarkAuthor = { tier: "human", reviewer: null };
const AGENT: MarkAuthor = { tier: "agent", reviewer: null };
const SECURITY: MarkAuthor = { tier: "agent", reviewer: "security" };
const PERF: MarkAuthor = { tier: "agent", reviewer: "perf" };

// --- marks fold -------------------------------------------------------------

test("project folds marked/unmarked to current state, carrying the author", () => {
  const events: MarkEvent[] = [
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: HUMAN },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "skipped", author: SECURITY },
    { type: "unmarked", ts: 3, atomHash: h(0), author: HUMAN },
  ];
  const { marks } = project(events);
  assert.equal(marks.has(h(0)), false);
  assert.deepEqual(marks.get(h(1)), { disposition: "skipped", author: SECURITY });
});

test("last write wins for a hash (author updates with it)", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "skipped", author: AGENT },
    { type: "marked", ts: 2, atomHash: h(0), disposition: "done", author: HUMAN },
  ]);
  assert.deepEqual(marks.get(h(0)), { disposition: "done", author: HUMAN });
});

// --- comments + ids ---------------------------------------------------------

test("commented events accumulate with sequential ids, author, open status", () => {
  const { comments } = project([
    { type: "commented", ts: 5, atomHash: h(0), body: "first", author: HUMAN },
    { type: "commented", ts: 6, atomHash: h(1), body: "second", author: SECURITY },
  ]);
  assert.deepEqual(comments, [
    { id: "c0", atomHash: h(0), body: "first", ts: 5, author: HUMAN, answer: null, status: "open" },
    { id: "c1", atomHash: h(1), body: "second", ts: 6, author: SECURITY, answer: null, status: "open" },
  ]);
});

test("commentId is ordinal, not clock-derived — comments at the same ts stay distinct", () => {
  const { comments } = project([
    { type: "commented", ts: 7, atomHash: h(0), body: "a", author: HUMAN },
    { type: "commented", ts: 7, atomHash: h(1), body: "b", author: HUMAN },
  ]);
  assert.deepEqual(
    comments.map((c) => c.id),
    ["c0", "c1"],
  );
});

// --- answers ----------------------------------------------------------------

test("answered folds onto the matching comment by id, marking it addressed", () => {
  const { comments } = project([
    { type: "commented", ts: 1, atomHash: h(0), body: "q", author: HUMAN },
    { type: "answered", ts: 2, commentId: "c0", body: "the answer", author: AGENT },
  ]);
  assert.equal(comments[0]?.answer, "the answer");
  assert.equal(comments[0]?.status, "addressed");
});

test("last answer wins for a comment", () => {
  const { comments } = project([
    { type: "commented", ts: 1, atomHash: h(0), body: "q", author: HUMAN },
    { type: "answered", ts: 2, commentId: "c0", body: "first", author: AGENT },
    { type: "answered", ts: 3, commentId: "c0", body: "second", author: AGENT },
  ]);
  assert.equal(comments[0]?.answer, "second");
});

test("an answer to an unknown comment id is ignored (no crash, no phantom comment)", () => {
  const { comments } = project([
    { type: "commented", ts: 1, atomHash: h(0), body: "q", author: HUMAN },
    { type: "answered", ts: 2, commentId: "c99", body: "stray", author: AGENT },
  ]);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.answer, null);
  assert.equal(comments[0]?.status, "open");
});

// --- completed --------------------------------------------------------------

test("completed defaults false and flips on a completed event", () => {
  assert.equal(project([]).completed, false);
  assert.equal(project([{ type: "completed", ts: 1 }]).completed, true);
});

// --- deriveCommentStatus ----------------------------------------------------

test("deriveCommentStatus: open when present and unanswered", () => {
  const masterHashes = new Set([h(0)]);
  assert.equal(deriveCommentStatus({ atomHash: h(0), answer: null }, masterHashes), "open");
});

test("deriveCommentStatus: addressed-by-answer when an answer is attached", () => {
  const masterHashes = new Set([h(0)]);
  assert.equal(deriveCommentStatus({ atomHash: h(0), answer: "done" }, masterHashes), "addressed");
});

test("deriveCommentStatus: addressed-by-edit when the atom dropped out of the master list", () => {
  const masterHashes = new Set<AtomHash>(); // atom edited away
  assert.equal(deriveCommentStatus({ atomHash: h(0), answer: null }, masterHashes), "addressed");
});

// --- section completion + progress ------------------------------------------

test("section completes only when every atom is addressed (skip counts)", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: HUMAN },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "skipped", author: HUMAN },
  ]);
  assert.equal(isSectionComplete(section(0, 1), marks), true);
  assert.equal(isSectionComplete(section(0, 2), marks), false);
});

test("empty section is never complete", () => {
  assert.equal(isSectionComplete(section(), new Map()), false);
});

test("progress derives from the master list, counting skipped as addressed", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: HUMAN },
    { type: "marked", ts: 2, atomHash: h(2), disposition: "skipped", author: HUMAN },
  ]);
  const progress = reviewProgress(master, marks);
  assert.equal(progress.total, 3);
  assert.equal(progress.addressed, 2);
  assert.equal(progress.unaddressed, 1);
});

test("progress omits byReviewer entirely when no mark carries a label", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: HUMAN },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "done", author: AGENT },
  ]);
  assert.equal("byReviewer" in reviewProgress(master, marks), false);
});

test("progress breaks down addressed per reviewer label when labels are present", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: SECURITY },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "done", author: SECURITY },
    { type: "marked", ts: 3, atomHash: h(2), disposition: "done", author: PERF },
  ]);
  const breakdown = reviewProgress(master, marks).byReviewer;
  assert.deepEqual(
    [...(breakdown ?? [])].sort((a, b) => a.reviewer.localeCompare(b.reviewer)),
    [
      { reviewer: "perf", addressed: 1 },
      { reviewer: "security", addressed: 2 },
    ],
  );
});

test("two labels marking the same atom credit the last writer only (one-record-per-atom)", () => {
  // Marks are last-write-wins per atom, so byReviewer is last-writer attribution — not a
  // per-lens tally. A multi-reviewer-per-atom model would be a domain change (owner decision).
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: SECURITY },
    { type: "marked", ts: 2, atomHash: h(0), disposition: "done", author: PERF },
  ]);
  const progress = reviewProgress(master, marks);
  assert.equal(progress.addressed, 1);
  assert.deepEqual(progress.byReviewer, [{ reviewer: "perf", addressed: 1 }]);
});

test("byReviewer counts only labelled marks landing on master-list atoms", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: SECURITY },
    { type: "marked", ts: 2, atomHash: "gone" as AtomHash, disposition: "done", author: SECURITY },
  ]);
  assert.deepEqual(reviewProgress(master, marks).byReviewer, [{ reviewer: "security", addressed: 1 }]);
});
