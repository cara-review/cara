import { test } from "node:test";
import assert from "node:assert/strict";
import { createReviewService } from "./review-service.ts";
import { hashAtom } from "./identity.ts";
import { reviewContext } from "./model.ts";
import type { AtomHash, RawHunk } from "./model.ts";
import type {
  AgentChat,
  AgentPort,
  ChatRequest,
  ClockPort,
  CommentSink,
  DiffSource,
  DiffSpec,
  EditorPort,
  GroupingRequest,
  InstructionsSource,
  MarkEvent,
  ReviewContext,
  ReviewDispatch,
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

// --- in-memory fakes for every port (no git / fs / LLM) ---------------------

// The adapter owns context resolution (ADR-0005); the fake stands in for GitCli
// and resolves a fixed context by default, or per-spec via a supplied resolver.
function fakeDiff(opts: {
  hunks?: readonly RawHunk[];
  resolve?: (spec: DiffSpec) => string;
} = {}): DiffSource {
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

class FakeAgent implements AgentPort {
  lastRequest: GroupingRequest | null = null;
  readonly proposal: unknown;
  constructor(proposal: unknown) {
    this.proposal = proposal;
  }
  async proposeGrouping(request: GroupingRequest): Promise<unknown> {
    this.lastRequest = request;
    return this.proposal;
  }
}

// Records the request and returns a configurable answer (or `unknown` garbage), to
// exercise the ADR-0009 Q&A path and the boundary coercion of the agent's output.
class FakeAgentChat implements AgentChat {
  lastRequest: ChatRequest | null = null;
  readonly result: unknown;
  constructor(result: unknown = { answer: "an answer" }) {
    this.result = result;
  }
  async answer(request: ChatRequest): Promise<unknown> {
    this.lastRequest = request;
    return this.result;
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
  private t = 1000; // tests below assert against this seed
  now(): number {
    return this.t++;
  }
}

class FakeSink implements CommentSink {
  dispatched: Array<{ context: ReviewContext; dispatch: ReviewDispatch }> = [];
  async dispatch(context: ReviewContext, dispatch: ReviewDispatch) {
    this.dispatched.push({ context, dispatch });
    return { count: dispatch.comments.length, location: `sink://${context}` };
  }
}

function build(opts: {
  hunks?: readonly RawHunk[];
  proposal?: unknown;
  instructions?: ReviewInstructions;
  resolve?: (spec: DiffSpec) => string;
  answer?: unknown;
} = {}) {
  const store = new FakeStore();
  const agent = new FakeAgent(opts.proposal ?? {});
  const chat = new FakeAgentChat("answer" in opts ? opts.answer : { answer: "an answer" });
  const editor = new FakeEditor();
  const clock = new FakeClock();
  const sink = new FakeSink();
  const service = createReviewService({
    diffSource: fakeDiff({ ...(opts.hunks ? { hunks: opts.hunks } : {}), ...(opts.resolve ? { resolve: opts.resolve } : {}) }),
    store,
    agent,
    chat,
    instructions: fakeInstructions(opts.instructions),
    editor,
    clock,
    sink,
  });
  return { service, store, agent, chat, editor, clock, sink };
}

const WORKTREE: DiffSpec = { kind: "worktree" };

// --- open -------------------------------------------------------------------

test("open returns zero progress over the canonical master list on a fresh review", async () => {
  const { service } = build();
  const snap = await service.open(WORKTREE);
  assert.equal(snap.review.masterList.length, 3);
  assert.deepEqual(snap.progress, { total: 3, addressed: 0, unaddressed: 3 });
  assert.equal(snap.marks.length, 0);
  assert.equal(snap.comments.length, 0);
});

test("open takes its context from the DiffSource adapter (ADR-0005)", async () => {
  const { service } = build({ resolve: () => "feature/x" });
  const snap = await service.open(WORKTREE);
  assert.equal(snap.context, "feature/x");
});

test("open on an empty diff degrades gracefully", async () => {
  const { service } = build({ hunks: [] });
  const snap = await service.open(WORKTREE);
  assert.deepEqual(snap.progress, { total: 0, addressed: 0, unaddressed: 0 });
  assert.deepEqual(snap.review.chapters, []);
  assert.deepEqual(snap.review.masterList, []);
});

test("open repairs a good proposal into chapters/sections (bijection holds)", async () => {
  const { service } = build({
    proposal: {
      chapters: [
        {
          title: "Core",
          sections: [{ title: "First two", atomHashes: [HASH(0), HASH(1)] }],
        },
      ],
    },
  });
  const snap = await service.open(WORKTREE);
  const placed = snap.review.chapters.flatMap((c) => c.sections).flatMap((s) => s.atoms);
  assert.equal(placed.length, 3); // every master atom placed exactly once
  assert.equal(snap.review.chapters[0]?.title, "Core");
});

test("open repairs garbage into the 'Other changes' floor without losing atoms", async () => {
  const { service } = build({ proposal: { nonsense: true } });
  const snap = await service.open(WORKTREE);
  assert.equal(snap.review.chapters.length, 1);
  assert.equal(snap.review.chapters[0]?.title, "Other changes");
  const placed = snap.review.chapters.flatMap((c) => c.sections).flatMap((s) => s.atoms);
  assert.equal(placed.length, 3);
});

test("open passes the loaded instructions to the agent with the master atoms", async () => {
  const instructions: ReviewInstructions = { personal: "be terse", project: "focus on api" };
  const { service, agent } = build({ instructions });
  await service.open(WORKTREE);
  assert.deepEqual(agent.lastRequest?.instructions, instructions);
  assert.equal(agent.lastRequest?.atoms.length, 3);
});

test("open folds previously persisted marks (resume across sessions)", async () => {
  const { service, store } = build();
  await store.append(reviewContext("ctx"), {
    type: "marked",
    ts: 1,
    atomHash: HASH(0),
    disposition: "done",
  });
  const snap = await service.open(WORKTREE);
  assert.equal(snap.progress.addressed, 1);
  assert.deepEqual(
    snap.marks.find((m) => m.atomHash === HASH(0)),
    { atomHash: HASH(0), disposition: "done" },
  );
});

// --- mark / unmark / comment ------------------------------------------------

test("mark appends a marked event and returns a fresh snapshot", async () => {
  const { service, store } = build();
  const ctx = (await service.open(WORKTREE)).context;
  const snap = await service.mark(ctx, HASH(1), "done");
  assert.equal(snap.progress.addressed, 1);
  assert.equal(snap.marks.find((m) => m.atomHash === HASH(1))?.disposition, "done");
  assert.equal((await store.load(ctx)).length, 1);
});

test("skipped counts as addressed in progress", async () => {
  const { service } = build();
  const ctx = (await service.open(WORKTREE)).context;
  const snap = await service.mark(ctx, HASH(2), "skipped");
  assert.deepEqual(snap.progress, { total: 3, addressed: 1, unaddressed: 2 });
});

test("unmark removes a prior mark", async () => {
  const { service } = build();
  const ctx = (await service.open(WORKTREE)).context;
  await service.mark(ctx, HASH(0), "done");
  const snap = await service.unmark(ctx, HASH(0));
  assert.equal(snap.progress.addressed, 0);
  assert.equal(snap.marks.length, 0);
});

test("comment appends a commented event and surfaces it in the snapshot", async () => {
  const { service } = build();
  const ctx = (await service.open(WORKTREE)).context;
  const snap = await service.comment(ctx, HASH(0), "use the retry util");
  assert.equal(snap.comments.length, 1);
  assert.equal(snap.comments[0]?.body, "use the retry util");
  assert.equal(snap.comments[0]?.atomHash, HASH(0));
  // a comment is not a disposition — progress is untouched
  assert.equal(snap.progress.addressed, 0);
});

test("the clock stamps event timestamps", async () => {
  const { service, store } = build();
  const ctx = (await service.open(WORKTREE)).context;
  await service.mark(ctx, HASH(0), "done");
  await service.comment(ctx, HASH(1), "hi");
  const events = await store.load(ctx);
  assert.equal(events[0]?.ts, 1000); // FakeClock seed
  assert.equal(events[1]?.ts, 1001);
});

test("mutations reuse the cached grouping — the agent is called once per open", async () => {
  const { service, agent } = build();
  let calls = 0;
  const inner = agent.proposeGrouping.bind(agent);
  agent.proposeGrouping = async (req) => {
    calls++;
    return inner(req);
  };
  const ctx = (await service.open(WORKTREE)).context;
  await service.mark(ctx, HASH(0), "done");
  await service.unmark(ctx, HASH(0));
  await service.comment(ctx, HASH(1), "x");
  assert.equal(calls, 1);
});

test("re-opening the same context refreshes the cached review and preserves marks", async () => {
  const { service } = build();
  const ctx = (await service.open(WORKTREE)).context;
  await service.mark(ctx, HASH(0), "done");
  const snap = await service.open(WORKTREE); // marks live in the store, not the cache
  assert.equal(snap.progress.addressed, 1);
  // mutations after re-open still work against the refreshed cache entry
  const after = await service.mark(ctx, HASH(1), "done");
  assert.equal(after.progress.addressed, 2);
});

// --- dispatch (Go, ADR-0007) ------------------------------------------------

test("dispatch gathers commented atoms into records with current location and body", async () => {
  const { service, sink } = build();
  const ctx = (await service.open(WORKTREE)).context;
  await service.comment(ctx, HASH(0), "use the retry util");
  const receipt = await service.dispatch(ctx);

  assert.equal(receipt.count, 1);
  assert.equal(sink.dispatched.length, 1);
  const record = sink.dispatched[0]?.dispatch.comments[0];
  assert.equal(record?.atomHash, HASH(0));
  assert.equal(record?.path, "a.ts");
  assert.deepEqual(record?.lineRange, { start: 1, count: 1 });
  assert.equal(record?.body, "use the retry util");
});

test("dispatch drops a comment whose atom is no longer in the master list", async () => {
  const { service, store, sink } = build();
  const ctx = (await service.open(WORKTREE)).context;
  await store.append(ctx, { type: "commented", ts: 1, atomHash: "gone" as AtomHash, body: "stale" });
  await service.comment(ctx, HASH(1), "live");
  const receipt = await service.dispatch(ctx);

  assert.equal(receipt.count, 1);
  assert.deepEqual(
    sink.dispatched[0]?.dispatch.comments.map((c) => c.body),
    ["live"],
  );
});

test("dispatch on an unopened context throws", async () => {
  const { service } = build();
  await assert.rejects(() => service.dispatch(reviewContext("never-opened")), /No open review/);
});

// --- context isolation ------------------------------------------------------

test("distinct adapter-resolved contexts keep their marks isolated", async () => {
  const { service, store } = build({
    resolve: (spec) => (spec.kind === "worktree" ? "branch-a" : "branch-b"),
  });
  const a = (await service.open({ kind: "worktree" })).context;
  const b = (await service.open({ kind: "range", base: "main", head: "HEAD" })).context;
  assert.equal(a, "branch-a");
  assert.equal(b, "branch-b");

  await service.mark(a, HASH(0), "done");
  assert.equal((await store.load(a)).length, 1);
  assert.equal((await store.load(b)).length, 0); // isolated
});

// --- editor + guard ---------------------------------------------------------

test("openInEditor delegates to the editor port", async () => {
  const { service, editor } = build();
  await service.openInEditor("src/a.ts", 42);
  assert.deepEqual(editor.opened, [{ path: "src/a.ts", line: 42 }]);
});

test("mutating an unopened context throws (no silent no-op)", async () => {
  const { service } = build();
  await assert.rejects(
    () => service.mark(reviewContext("never-opened"), HASH(0), "done"),
    /No open review/,
  );
});

// --- ask: Chapter Q&A (ADR-0009) --------------------------------------------

const CTX = reviewContext("ctx");

test("ask hands the agent the focused Chapter's atoms (with diff lines) + instructions", async () => {
  const instructions: ReviewInstructions = { personal: "be terse", project: null };
  const { service, chat } = build({
    instructions,
    proposal: { chapters: [{ title: "Core", sections: [{ title: "s", atomHashes: [HASH(0), HASH(1)] }] }] },
  });
  await service.open(WORKTREE);

  await service.ask(CTX, 0, "is this backwards compatible?");
  assert.equal(chat.lastRequest?.question, "is this backwards compatible?");
  assert.deepEqual(chat.lastRequest?.instructions, instructions);
  assert.equal(chat.lastRequest?.atoms.length, 2);
  assert.ok(chat.lastRequest?.atoms[0]?.lines !== undefined); // atoms carry git-verbatim lines
});

test("ask returns the agent's answer prose", async () => {
  const { service } = build({ answer: { answer: "Yes — the export is additive." } });
  await service.open(WORKTREE);
  const result = await service.ask(CTX, 0, "compatible?");
  assert.deepEqual(result, { answer: "Yes — the export is additive." });
});

test("ask coerces a malformed/empty agent answer to a safe fallback (untrusted boundary)", async () => {
  for (const answer of [{ nope: true }, { answer: "" }, "raw string", null]) {
    const { service } = build({ answer });
    await service.open(WORKTREE);
    const result = await service.ask(CTX, 0, "q");
    assert.match(result.answer, /couldn't answer/);
  }
});

test("ask changes no review state (ephemeral, ADR-0009)", async () => {
  const { service, store } = build();
  await service.open(WORKTREE);
  await service.ask(CTX, 0, "q");
  assert.equal((await store.load(CTX)).length, 0); // no event appended
});

test("ask rejects an out-of-range Chapter index", async () => {
  const { service } = build();
  await service.open(WORKTREE);
  await assert.rejects(() => service.ask(CTX, 99, "q"), /No Chapter at index 99/);
});

test("ask on an unopened context throws", async () => {
  const { service } = build();
  await assert.rejects(() => service.ask(reviewContext("never"), 0, "q"), /No open review/);
});

// --- reviewContext smart-constructor ----------------------------------------

test("reviewContext trims and rejects empty keys", () => {
  assert.equal(reviewContext("  main..HEAD  "), "main..HEAD");
  assert.throws(() => reviewContext("   "), /cannot be empty/);
});
