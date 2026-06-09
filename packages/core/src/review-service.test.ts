import { test } from "bun:test";
import assert from "node:assert/strict";
import { createReviewService } from "./review-service.ts";
import { hashAtom } from "./identity.ts";
import { reviewContext } from "./model.ts";
import type { AtomHash, MarkAuthor, RawHunk } from "./model.ts";
import { SYSTEM_METHODOLOGY, METHODOLOGY_VERSION } from "./methodology.ts";
import type {
  ClockPort,
  DiffSource,
  DiffSpec,
  EditorPort,
  InstructionsSource,
  MarkEvent,
  ReviewContext,
  ReviewInstructions,
  ReviewStore,
} from "./index.ts";

// --- fixtures ---------------------------------------------------------------

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

const HUNKS: readonly RawHunk[] = [hunk("a.ts", "0"), hunk("b.ts", "1"), hunk("c.ts", "2")];
const HASH = (i: number): AtomHash => hashAtom(HUNKS[i]!);

const HUMAN: MarkAuthor = { tier: "human", reviewer: null };
const AGENT: MarkAuthor = { tier: "agent", reviewer: null };
const SECURITY: MarkAuthor = { tier: "agent", reviewer: "security" };

// --- in-memory fakes for every port (no git / fs / LLM) ---------------------

function fakeDiff(opts: { hunks?: readonly RawHunk[]; resolve?: (spec: DiffSpec) => string } = {}): DiffSource {
  const hunks = opts.hunks ?? HUNKS;
  const resolve = opts.resolve ?? (() => "ctx");
  return {
    diff: async () => hunks,
    resolveContext: async (spec) => reviewContext(resolve(spec)),
  };
}

class FakeStore implements ReviewStore {
  readonly logs = new Map<ReviewContext, MarkEvent[]>();
  async load(context: ReviewContext): Promise<readonly MarkEvent[]> {
    return [...(this.logs.get(context) ?? [])];
  }
  async append(context: ReviewContext, event: MarkEvent): Promise<void> {
    const log = this.logs.get(context) ?? [];
    log.push(event);
    this.logs.set(context, log);
  }
}

function fakeInstructions(value: ReviewInstructions = { personal: null, project: null }): InstructionsSource {
  return { load: async () => value };
}

class FakeEditor implements EditorPort {
  opened: Array<{ path: string; line: number }> = [];
  async open(path: string, line: number): Promise<void> {
    this.opened.push({ path, line });
  }
}

class FakeClock implements ClockPort {
  private t = 1000;
  now(): number {
    return this.t++;
  }
}

function build(opts: {
  hunks?: readonly RawHunk[];
  instructions?: ReviewInstructions;
  resolve?: (spec: DiffSpec) => string;
} = {}) {
  const store = new FakeStore();
  const editor = new FakeEditor();
  const clock = new FakeClock();
  const service = createReviewService({
    diffSource: fakeDiff({
      ...(opts.hunks ? { hunks: opts.hunks } : {}),
      ...(opts.resolve ? { resolve: opts.resolve } : {}),
    }),
    store,
    instructions: fakeInstructions(opts.instructions),
    editor,
    clock,
  });
  return { service, store, editor, clock };
}

const WORKTREE: DiffSpec = { kind: "worktree" };
const GOOD_GROUPING = {
  chapters: [{ title: "Core", sections: [{ title: "First two", atomHashes: [HASH(0), HASH(1)] }] }],
};

// --- getAtoms ---------------------------------------------------------------

test("getAtoms returns the master list, merged methodology, and version stamp", async () => {
  const { service } = build({ instructions: { personal: null, project: "focus on api" } });
  const view = await service.getAtoms(WORKTREE);
  assert.equal(view.atoms.length, 3);
  assert.equal(view.methodologyVersion, METHODOLOGY_VERSION);
  assert.ok(view.methodology.startsWith(SYSTEM_METHODOLOGY));
  assert.match(view.methodology, /focus on api/);
  assert.equal(view.atoms[0]?.lines.length, 1); // atoms carry git-verbatim diff lines
});

test("getAtoms takes its context from the DiffSource adapter (ADR-0005)", async () => {
  const { service } = build({ resolve: () => "feature/x" });
  assert.equal((await service.getAtoms(WORKTREE)).context, "feature/x");
});

test("getAtoms on an empty diff returns no atoms and no open items", async () => {
  const { service } = build({ hunks: [] });
  const view = await service.getAtoms(WORKTREE);
  assert.deepEqual(view.atoms, []);
  assert.deepEqual(view.openItems, []);
});

test("getAtoms carries forward open comments from prior rounds, located on the live atom", async () => {
  const { service, store } = build();
  await store.append(reviewContext("ctx"), {
    type: "commented",
    ts: 1,
    atomHash: HASH(1),
    body: "carry me",
    author: HUMAN,
  });
  const view = await service.getAtoms(WORKTREE);
  assert.deepEqual(view.openItems, [
    {
      id: "c0",
      atomHash: HASH(1),
      path: "b.ts",
      lineRange: { start: 1, count: 1 },
      body: "carry me",
      answer: null,
      status: "open",
    },
  ]);
});

test("getAtoms drops answered comments from open items (addressed-by-answer)", async () => {
  const { service, store } = build();
  const ctx = reviewContext("ctx");
  await store.append(ctx, { type: "commented", ts: 1, atomHash: HASH(0), body: "q", author: HUMAN });
  await store.append(ctx, { type: "answered", ts: 2, commentId: "c0", body: "a", author: AGENT });
  assert.deepEqual((await service.getAtoms(WORKTREE)).openItems, []);
});

test("getAtoms drops comments whose atom was edited away (addressed-by-edit)", async () => {
  const { service, store } = build();
  await store.append(reviewContext("ctx"), {
    type: "commented",
    ts: 1,
    atomHash: "gone" as AtomHash,
    body: "stale",
    author: HUMAN,
  });
  assert.deepEqual((await service.getAtoms(WORKTREE)).openItems, []);
});

// --- presentGrouping --------------------------------------------------------

test("presentGrouping repairs a good grouping into chapters and returns the snapshot", async () => {
  const { service } = build();
  const snap = await service.presentGrouping(WORKTREE, GOOD_GROUPING);
  const placed = snap.review.chapters.flatMap((c) => c.sections).flatMap((s) => s.atoms);
  assert.equal(placed.length, 3); // bijection holds — every atom placed exactly once
  assert.equal(snap.review.chapters[0]?.title, "Core");
  assert.deepEqual(snap.progress, { total: 3, addressed: 0, unaddressed: 3 });
  assert.equal(snap.completed, false);
});

test("presentGrouping repairs garbage into the 'Other changes' floor without losing atoms", async () => {
  const { service } = build();
  const snap = await service.presentGrouping(WORKTREE, { nonsense: true });
  assert.equal(snap.review.chapters.length, 1);
  assert.equal(snap.review.chapters[0]?.title, "Other changes");
  const placed = snap.review.chapters.flatMap((c) => c.sections).flatMap((s) => s.atoms);
  assert.equal(placed.length, 3);
});

test("presentGrouping on an empty diff degrades gracefully", async () => {
  const { service } = build({ hunks: [] });
  const snap = await service.presentGrouping(WORKTREE, {});
  assert.deepEqual(snap.review.chapters, []);
  assert.deepEqual(snap.progress, { total: 0, addressed: 0, unaddressed: 0 });
});

test("presentGrouping folds previously persisted marks (resume across sessions)", async () => {
  const { service, store } = build();
  await store.append(reviewContext("ctx"), {
    type: "marked",
    ts: 1,
    atomHash: HASH(0),
    disposition: "done",
    author: HUMAN,
  });
  const snap = await service.presentGrouping(WORKTREE, GOOD_GROUPING);
  assert.equal(snap.progress.addressed, 1);
  assert.deepEqual(snap.marks.find((m) => m.atomHash === HASH(0)), {
    atomHash: HASH(0),
    disposition: "done",
    author: HUMAN,
  });
});

// --- snapshot (browser read) ------------------------------------------------

test("snapshot returns the current state for an opened context", async () => {
  const { service } = build();
  await service.presentGrouping(WORKTREE, GOOD_GROUPING);
  const snap = await service.snapshot(reviewContext("ctx"));
  assert.equal(snap.review.masterList.length, 3);
});

test("snapshot reflects events appended out of band (cross-process submit re-poll)", async () => {
  const { service, store } = build();
  await service.presentGrouping(WORKTREE, GOOD_GROUPING);
  await store.append(reviewContext("ctx"), {
    type: "marked",
    ts: 1,
    atomHash: HASH(0),
    disposition: "done",
    author: AGENT,
  });
  assert.equal((await service.snapshot(reviewContext("ctx"))).progress.addressed, 1);
});

test("snapshot on an unopened context throws (no silent no-op)", async () => {
  const { service } = build();
  await assert.rejects(() => service.snapshot(reviewContext("never")), /No open review/);
});

// --- mark / unmark / comment / answer (browser, human-tier) -----------------

test("mark appends a marked event with its author and returns a fresh snapshot", async () => {
  const { service, store } = build();
  const ctx = (await service.presentGrouping(WORKTREE, GOOD_GROUPING)).context;
  const snap = await service.mark(ctx, HASH(1), "done", HUMAN);
  assert.equal(snap.progress.addressed, 1);
  assert.deepEqual(snap.marks.find((m) => m.atomHash === HASH(1)), {
    atomHash: HASH(1),
    disposition: "done",
    author: HUMAN,
  });
  assert.equal((await store.load(ctx)).length, 1);
});

test("unmark removes a prior mark", async () => {
  const { service } = build();
  const ctx = (await service.presentGrouping(WORKTREE, GOOD_GROUPING)).context;
  await service.mark(ctx, HASH(0), "done", HUMAN);
  const snap = await service.unmark(ctx, HASH(0), HUMAN);
  assert.equal(snap.progress.addressed, 0);
  assert.equal(snap.marks.length, 0);
});

test("comment surfaces in the snapshot with a stable id and open status; progress untouched", async () => {
  const { service } = build();
  const ctx = (await service.presentGrouping(WORKTREE, GOOD_GROUPING)).context;
  const snap = await service.comment(ctx, HASH(0), "use the retry util", HUMAN);
  assert.equal(snap.comments.length, 1);
  assert.equal(snap.comments[0]?.id, "c0");
  assert.equal(snap.comments[0]?.body, "use the retry util");
  assert.equal(snap.comments[0]?.status, "open");
  assert.equal(snap.progress.addressed, 0);
});

test("answer attaches to a comment by id and flips it addressed", async () => {
  const { service } = build();
  const ctx = (await service.presentGrouping(WORKTREE, GOOD_GROUPING)).context;
  await service.comment(ctx, HASH(0), "q", HUMAN);
  const snap = await service.answer(ctx, "c0", "the answer", AGENT);
  assert.equal(snap.comments[0]?.answer, "the answer");
  assert.equal(snap.comments[0]?.status, "addressed");
});

test("the clock stamps event timestamps in order", async () => {
  const { service, store } = build();
  const ctx = (await service.presentGrouping(WORKTREE, GOOD_GROUPING)).context;
  await service.mark(ctx, HASH(0), "done", HUMAN);
  await service.comment(ctx, HASH(1), "hi", HUMAN);
  const events = await store.load(ctx);
  assert.equal(events[0]?.ts, 1000);
  assert.equal(events[1]?.ts, 1001);
});

test("mutating an unopened context throws", async () => {
  const { service } = build();
  await assert.rejects(() => service.mark(reviewContext("never"), HASH(0), "done", HUMAN), /No open review/);
});

// --- markComplete -----------------------------------------------------------

test("markComplete persists a completed event surfaced in the snapshot", async () => {
  const { service } = build();
  const ctx = (await service.presentGrouping(WORKTREE, GOOD_GROUPING)).context;
  assert.equal((await service.snapshot(ctx)).completed, false);
  await service.markComplete(ctx);
  assert.equal((await service.snapshot(ctx)).completed, true);
});

// --- submit (agent, CLI) ----------------------------------------------------

test("submit applies marks/comments/answers and returns the gap report", async () => {
  const { service } = build();
  const result = await service.submit(
    WORKTREE,
    {
      marks: [{ atomHash: HASH(0), disposition: "done" }],
      comments: [{ atomHash: HASH(1), body: "look here" }],
    },
    AGENT,
  );
  // h(0) accounted by a disposition, h(1) by a comment, h(2) missing
  assert.equal(result.gap.total, 3);
  assert.equal(result.gap.accounted, 2);
  assert.deepEqual(result.gap.missing, [
    { atomHash: HASH(2), path: "c.ts", lineRange: { start: 1, count: 1 } },
  ]);
  assert.equal(result.progress.addressed, 1); // a comment is not a disposition
});

test("submit reports a clean gap when every atom is accounted", async () => {
  const { service } = build();
  const result = await service.submit(
    WORKTREE,
    {
      marks: [
        { atomHash: HASH(0), disposition: "done" },
        { atomHash: HASH(1), disposition: "skipped" },
        { atomHash: HASH(2), disposition: "done" },
      ],
    },
    AGENT,
  );
  assert.equal(result.gap.accounted, 3);
  assert.deepEqual(result.gap.missing, []);
});

test("submit on an empty diff reports an empty, clean gap", async () => {
  const { service } = build({ hunks: [] });
  const result = await service.submit(WORKTREE, {}, AGENT);
  assert.deepEqual(result.gap, { total: 0, accounted: 0, missing: [] });
});

test("submit is idempotent — resubmitting identical marks does not double-count", async () => {
  const { service, store } = build();
  const batch = { marks: [{ atomHash: HASH(0), disposition: "done" as const }] };
  await service.submit(WORKTREE, batch, AGENT);
  const second = await service.submit(WORKTREE, batch, AGENT);
  assert.equal(second.gap.accounted, 1);
  assert.equal(second.progress.addressed, 1);
  // both events persist (append-only) but the fold is last-write-wins
  assert.equal((await store.load(reviewContext("ctx"))).length, 2);
});

test("submit answers attach to comments made earlier in the same batch", async () => {
  const { service } = build();
  await service.submit(
    WORKTREE,
    {
      comments: [{ atomHash: HASH(0), body: "q" }],
      answers: [{ commentId: "c0", answer: "a" }],
    },
    AGENT,
  );
  const view = await service.dispatch(reviewContext("ctx"), WORKTREE);
  assert.equal(view.comments[0]?.answer, "a");
  assert.equal(view.comments[0]?.status, "addressed");
});

test("submit ignores an answer to an unknown comment id (no crash)", async () => {
  const { service } = build();
  const result = await service.submit(WORKTREE, { answers: [{ commentId: "c99", answer: "x" }] }, AGENT);
  assert.equal(result.gap.accounted, 0);
});

test("submit carries the reviewer label into per-reviewer progress", async () => {
  const { service } = build();
  const result = await service.submit(WORKTREE, { marks: [{ atomHash: HASH(0), disposition: "done" }] }, SECURITY);
  assert.deepEqual(result.progress.byReviewer, [{ reviewer: "security", addressed: 1 }]);
});

test("label-less agent marks produce no per-reviewer breakdown", async () => {
  const { service } = build();
  const result = await service.submit(WORKTREE, { marks: [{ atomHash: HASH(0), disposition: "done" }] }, AGENT);
  assert.equal("byReviewer" in result.progress, false);
});

// --- dispatch (agent read) --------------------------------------------------

test("dispatch returns located comments with lifecycle, tier and reviewer label", async () => {
  const { service } = build();
  await service.submit(WORKTREE, { comments: [{ atomHash: HASH(0), body: "tighten this" }] }, SECURITY);
  const view = await service.dispatch(reviewContext("ctx"), WORKTREE);
  assert.deepEqual(view.comments, [
    {
      id: "c0",
      atomHash: HASH(0),
      path: "a.ts",
      lineRange: { start: 1, count: 1 },
      body: "tighten this",
      answer: null,
      status: "open",
      tier: "agent",
      reviewer: "security",
    },
  ]);
});

test("dispatch drops a comment whose atom is gone (addressed-by-edit, no live location)", async () => {
  const { service, store } = build();
  const ctx = reviewContext("ctx");
  await store.append(ctx, { type: "commented", ts: 1, atomHash: "gone" as AtomHash, body: "stale", author: HUMAN });
  await service.submit(WORKTREE, { comments: [{ atomHash: HASH(1), body: "live" }] }, HUMAN);
  const view = await service.dispatch(ctx, WORKTREE);
  assert.deepEqual(view.comments.map((c) => c.body), ["live"]);
});

test("dispatch reports full progress over the master list", async () => {
  const { service } = build();
  await service.submit(WORKTREE, { marks: [{ atomHash: HASH(0), disposition: "done" }] }, AGENT);
  const view = await service.dispatch(reviewContext("ctx"), WORKTREE);
  assert.deepEqual(view.progress, { total: 3, addressed: 1, unaddressed: 2 });
});

// --- context isolation + editor ---------------------------------------------

test("distinct adapter-resolved contexts keep their marks isolated", async () => {
  const { service, store } = build({
    resolve: (spec) => (spec.kind === "worktree" ? "branch-a" : "branch-b"),
  });
  await service.submit({ kind: "worktree" }, { marks: [{ atomHash: HASH(0), disposition: "done" }] }, AGENT);
  assert.equal((await store.load(reviewContext("branch-a"))).length, 1);
  assert.equal((await store.load(reviewContext("branch-b"))).length, 0);
});

test("openInEditor delegates to the editor port", async () => {
  const { service, editor } = build();
  await service.openInEditor("src/a.ts", 42);
  assert.deepEqual(editor.opened, [{ path: "src/a.ts", line: 42 }]);
});

// --- reviewContext smart-constructor ----------------------------------------

test("reviewContext trims and rejects empty keys", () => {
  assert.equal(reviewContext("  main..HEAD  "), "main..HEAD");
  assert.throws(() => reviewContext("   "), /cannot be empty/);
});
