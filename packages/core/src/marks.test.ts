import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  project,
  deriveCommentStatus,
  isAccounted,
  isSectionComplete,
  resolveCommentLine,
  reviewProgress,
  repoProgress,
  type MarkEvent,
} from "./marks.ts";
import { buildMasterList } from "./master-list.ts";
import type { Atom, AtomHash, CommentLinePointer, MarkAuthor, RawHunk, Section } from "./model.ts";

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

/** A minimal comment for reviewProgress — only the hash + author tier feed its scrutiny breakdown. */
const comment = (i: number, author: MarkAuthor): { atomHash: AtomHash; author: MarkAuthor } => ({
  atomHash: h(i),
  author,
});

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
    { id: "c0", atomHash: h(0), body: "first", ts: 5, author: HUMAN, answer: null, status: "open", pointer: null, line: null },
    { id: "c1", atomHash: h(1), body: "second", ts: 6, author: SECURITY, answer: null, status: "open", pointer: null, line: null },
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
  const progress = reviewProgress(master, marks, []);
  assert.equal(progress.total, 3);
  assert.equal(progress.addressed, 2);
  assert.equal(progress.unaddressed, 1);
});

test("progress omits byReviewer entirely when no mark carries a label", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: HUMAN },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "done", author: AGENT },
  ]);
  assert.equal("byReviewer" in reviewProgress(master, marks, []), false);
});

test("progress breaks down addressed per reviewer label when labels are present", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: SECURITY },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "done", author: SECURITY },
    { type: "marked", ts: 3, atomHash: h(2), disposition: "done", author: PERF },
  ]);
  const breakdown = reviewProgress(master, marks, []).byReviewer;
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
  const progress = reviewProgress(master, marks, []);
  assert.equal(progress.addressed, 1);
  assert.deepEqual(progress.byReviewer, [{ reviewer: "perf", addressed: 1 }]);
});

test("byReviewer counts only labelled marks landing on master-list atoms", () => {
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: SECURITY },
    { type: "marked", ts: 2, atomHash: "gone" as AtomHash, disposition: "done", author: SECURITY },
  ]);
  assert.deepEqual(reviewProgress(master, marks, []).byReviewer, [{ reviewer: "security", addressed: 1 }]);
});

// --- gap-closed accounting (ADR-0012 §f) ------------------------------------

test("accounted counts a disposition OR a comment; addressed counts disposition only", () => {
  const { marks } = project([{ type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: HUMAN }]);
  const progress = reviewProgress(master, marks, [comment(1, AGENT)]); // h(1) comment-only
  assert.equal(progress.total, 3);
  assert.equal(progress.addressed, 1); // h(0) dispositioned
  assert.equal(progress.accounted, 2); // h(0) by mark, h(1) by comment
  assert.equal(progress.unaddressed, 2); // total - addressed (comment is not a disposition)
});

test("a comment-only atom is accounted but never addressed (gap-closed yet undispositioned)", () => {
  const progress = reviewProgress(master, new Map(), [comment(0, AGENT)]);
  assert.equal(progress.addressed, 0);
  assert.equal(progress.accounted, 1);
});

// --- scrutiny breakdown (TN-26-029: dispositioned ≠ reviewed) ---------------

test("scrutiny is empty when nothing is accounted", () => {
  assert.deepEqual(reviewProgress(master, new Map(), []).scrutiny, []);
});

test("scrutiny splits commented engagement from a bare-disposition sweep, per tier", () => {
  // Agent sweeps all three by disposition but comments only one — the warning the breakdown surfaces.
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: AGENT },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "done", author: AGENT },
    { type: "marked", ts: 3, atomHash: h(2), disposition: "done", author: AGENT },
  ]);
  const progress = reviewProgress(master, marks, [comment(0, AGENT)]);
  assert.deepEqual(progress.scrutiny, [{ tier: "agent", accounted: 3, commented: 1 }]);
});

test("an atom one tier swept and another commented counts in both rows (footprint, not a partition)", () => {
  // h(0): agent mark + human comment → agent counts it swept AND human counts it commented.
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: AGENT },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "done", author: AGENT },
  ]);
  const progress = reviewProgress(master, marks, [comment(0, HUMAN)]);
  assert.deepEqual(progress.scrutiny, [
    { tier: "human", accounted: 1, commented: 1 },
    { tier: "agent", accounted: 2, commented: 0 }, // the agent swept both — the human comment doesn't erase h(0)
  ]);
});

test("a human comment on an agent-swept atom never shrinks the agent's sweep total", () => {
  // The warning this feature exists to raise: agent dispositioned all three with no comment.
  const { marks } = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: AGENT },
    { type: "marked", ts: 2, atomHash: h(1), disposition: "done", author: AGENT },
    { type: "marked", ts: 3, atomHash: h(2), disposition: "done", author: AGENT },
  ]);
  const progress = reviewProgress(master, marks, [comment(2, HUMAN)]);
  assert.deepEqual(progress.scrutiny, [
    { tier: "human", accounted: 1, commented: 1 },
    { tier: "agent", accounted: 3, commented: 0 }, // still 3 swept — the human comment adds on top
  ]);
});

test("a comment-only atom (no disposition) counts as scrutiny under its comment tier", () => {
  const progress = reviewProgress(master, new Map(), [comment(0, AGENT)]);
  assert.deepEqual(progress.scrutiny, [{ tier: "agent", accounted: 1, commented: 1 }]);
});

test("a human + agent comment on one atom credit both tiers, order-independent", () => {
  const agentFirst = reviewProgress(master, new Map(), [comment(0, AGENT), comment(0, HUMAN)]);
  const humanFirst = reviewProgress(master, new Map(), [comment(0, HUMAN), comment(0, AGENT)]);
  const expected = [
    { tier: "human", accounted: 1, commented: 1 },
    { tier: "agent", accounted: 1, commented: 1 },
  ];
  assert.deepEqual(agentFirst.scrutiny, expected);
  assert.deepEqual(humanFirst.scrutiny, expected);
});

test("scrutiny counts are surface-area: a hash-keyed comment credits every occurrence (like accounted)", () => {
  // Two byte-identical hunks collapse to one hash but stay distinct list entries; a single
  // hash-keyed comment is credited to both occurrences, exactly as `accounted` double-counts them.
  const dupMaster = buildMasterList([hunk("a.ts", "x"), hunk("a.ts", "x"), hunk("b.ts", "y")]);
  const dupHash = dupMaster[0]!.hash;
  const progress = reviewProgress(dupMaster, new Map(), [{ atomHash: dupHash, author: AGENT }]);
  assert.equal(progress.accounted, 2); // both occurrences of the shared hash
  assert.deepEqual(progress.scrutiny, [{ tier: "agent", accounted: 2, commented: 2 }]);
});

test("isAccounted: true on a disposition, true on a comment, false on neither", () => {
  const { marks } = project([{ type: "marked", ts: 1, atomHash: h(0), disposition: "skipped", author: HUMAN }]);
  assert.equal(isAccounted(master[0]!, marks, new Set()), true); // disposition
  assert.equal(isAccounted(master[1]!, marks, new Set([h(1)])), true); // comment
  assert.equal(isAccounted(master[2]!, marks, new Set()), false); // neither
});

// --- reshape fold (ADR-0012 §3) ---------------------------------------------

test("pendingReshape is null with no reshape events", () => {
  assert.equal(project([]).pendingReshape, null);
});

test("pendingReshape carries the body of a request not yet answered by a present", () => {
  assert.equal(project([{ type: "reshape-requested", ts: 1, body: "split the tests out" }]).pendingReshape, "split the tests out");
});

test("a present after a request clears the pending reshape", () => {
  const state = project([
    { type: "reshape-requested", ts: 1, body: "regroup" },
    { type: "presented", ts: 2 },
  ]);
  assert.equal(state.pendingReshape, null);
});

test("the newest request wins; one raised after a present is pending again", () => {
  const state = project([
    { type: "reshape-requested", ts: 1, body: "first" },
    { type: "presented", ts: 2 },
    { type: "reshape-requested", ts: 3, body: "second" },
  ]);
  assert.equal(state.pendingReshape, "second");
});

test("a same-tick present after a request clears it (resolution is by log order, not ts)", () => {
  const state = project([
    { type: "reshape-requested", ts: 5, body: "x" },
    { type: "presented", ts: 5 },
  ]);
  assert.equal(state.pendingReshape, null);
});

test("a same-tick request after a present stays pending (order, not ts magnitude)", () => {
  const state = project([
    { type: "presented", ts: 5 },
    { type: "reshape-requested", ts: 5, body: "split the tests" },
  ]);
  assert.equal(state.pendingReshape, "split the tests");
});

// --- resolveCommentLine (ADR-0012 §2) ---------------------------------------

// One atom: 2 removed lines from oldStart 10, 3 added lines from newStart 20.
const edit: Atom = buildMasterList([
  {
    status: "modified",
    path: "f.ts",
    previousPath: null,
    oldStart: 10,
    oldLines: 2,
    newStart: 20,
    newLines: 3,
    lines: [
      { kind: "removed", text: "r0" },
      { kind: "removed", text: "r1" },
      { kind: "added", text: "a0" },
      { kind: "added", text: "a1" },
      { kind: "added", text: "a2" },
    ],
  },
])[0]!;

test("resolveCommentLine returns null for a block-level (null) pointer", () => {
  assert.equal(resolveCommentLine(edit, null), null);
});

test("resolveCommentLine locates an added line at newStart + offset-among-added", () => {
  assert.equal(resolveCommentLine(edit, { side: "added", text: "a0" }), 20);
  assert.equal(resolveCommentLine(edit, { side: "added", text: "a2" }), 22);
});

test("resolveCommentLine locates a removed line at oldStart + offset-among-removed", () => {
  assert.equal(resolveCommentLine(edit, { side: "removed", text: "r1" }), 11);
});

test("resolveCommentLine falls back to the hunk end when the content no longer matches", () => {
  // newLines > 0 → last head line (newStart + newLines - 1), never a wrong line.
  assert.equal(resolveCommentLine(edit, { side: "added", text: "gone" }), 22);
});

test("resolveCommentLine falls back to oldStart for a pure deletion with no head line", () => {
  const deletion: Atom = buildMasterList([
    {
      status: "deleted",
      path: "g.ts",
      previousPath: null,
      oldStart: 5,
      oldLines: 2,
      newStart: 5,
      newLines: 0,
      lines: [
        { kind: "removed", text: "x" },
        { kind: "removed", text: "y" },
      ],
    },
  ])[0]!;
  assert.equal(resolveCommentLine(deletion, { side: "removed", text: "y" }), 6); // match
  assert.equal(resolveCommentLine(deletion, { side: "added", text: "z" }), 5); // no head → oldStart
});

// --- comment line pointer round-trip ----------------------------------------

test("a commented event's line pointer round-trips onto the comment; line resolved downstream", () => {
  const pointer: CommentLinePointer = { side: "added", text: "0" };
  const { comments } = project([
    { type: "commented", ts: 1, atomHash: h(0), body: "pin", author: HUMAN, line: pointer },
  ]);
  assert.deepEqual(comments[0]?.pointer, pointer);
  assert.equal(comments[0]?.line, null); // null at fold time — resolved against the live atom later
});

test("a commented event with no pointer folds to a block-level comment", () => {
  const { comments } = project([{ type: "commented", ts: 1, atomHash: h(0), body: "b", author: HUMAN }]);
  assert.equal(comments[0]?.pointer, null);
});

test("project carries fact meta onto the mark record and the comment (ADR-0015)", () => {
  const meta = { model: "claude-opus-4-8", thinking: "high" };
  const state = project([
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: SECURITY, meta },
    { type: "commented", ts: 2, atomHash: h(0), body: "check input", author: SECURITY, meta },
  ]);
  assert.deepEqual(state.marks.get(h(0))?.meta, meta);
  assert.deepEqual(state.comments[0]?.meta, meta);
});

test("a fact with no meta folds to a record with the field absent (no dedupe churn)", () => {
  const state = project([{ type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: HUMAN }]);
  assert.equal("meta" in (state.marks.get(h(0)) ?? {}), false);
});

test("repoProgress folds by existence across the whole ledger, not last-writer (ADR-0014)", () => {
  // Two labels disposition h(0); h(1) only commented; h(2) untouched. Existence credits BOTH
  // labels for h(0) — unlike reviewProgress, whose last-write-wins map keeps one writer.
  const events: MarkEvent[] = [
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: SECURITY },
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: PERF },
    { type: "commented", ts: 1, atomHash: h(1), body: "x", author: AGENT },
  ];
  const p = repoProgress(master, events);
  assert.equal(p.total, 3);
  assert.equal(p.addressed, 1); // only h(0) dispositioned
  assert.equal(p.accounted, 2); // h(0) dispositioned + h(1) commented
  assert.deepEqual(
    new Map((p.byReviewer ?? []).map((r) => [r.reviewer, r.addressed])),
    new Map([["security", 1], ["perf", 1]]),
  );
  const agent = p.scrutiny.find((s) => s.tier === "agent");
  assert.deepEqual({ accounted: agent?.accounted, commented: agent?.commented }, { accounted: 2, commented: 1 });
});

test("repoProgress ignores unmarked — no global order to net against (ADR-0014 §7)", () => {
  const events: MarkEvent[] = [
    { type: "marked", ts: 1, atomHash: h(0), disposition: "done", author: HUMAN },
    { type: "unmarked", ts: 2, atomHash: h(0), author: HUMAN },
  ];
  assert.equal(repoProgress(master, events).addressed, 1);
});
