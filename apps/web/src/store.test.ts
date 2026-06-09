import { test } from "bun:test";
import assert from "node:assert/strict";
import type { AtomHash, ReviewContext, ReviewSnapshot, Section } from "./protocol.ts";
import { AppStore } from "./store.ts";
import { FakeBackend, section } from "./test-support.ts";

const CTX = "ctx" as ReviewContext;

function snapshot(chapters: ReviewSnapshot["review"]["chapters"], addressed = 0): ReviewSnapshot {
  const masterList = chapters.flatMap((c) => c.sections.flatMap((s) => s.atoms));
  return {
    context: CTX,
    review: { chapters, masterList },
    marks: [],
    comments: [],
    completed: false,
    progress: { total: masterList.length, addressed, unaddressed: masterList.length - addressed },
  };
}

function chapter(title: string, sections: readonly Section[]): ReviewSnapshot["review"]["chapters"][number] {
  return { title, summary: null, sections };
}

function harness(): { store: AppStore; backend: FakeBackend } {
  const backend = new FakeBackend();
  const store = new AppStore(backend);
  return { store, backend };
}

const SECTION: Section = section("S", ["a"]);

test("a loaded snapshot expands the first chapter and focuses its first section", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([chapter("C", [SECTION])]);
  store.connect(CTX);
  await Promise.resolve();

  const state = store.getState();
  assert.deepEqual(state.activeSection, { chapter: 0, section: 0 });
  assert.ok(state.expandedChapters.has(0));
  assert.equal(state.snapshot?.review.masterList.length, 1);
});

test("load skips a leading empty chapter to focus the first one with sections", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([chapter("Empty", []), chapter("Has content", [section("S", ["a"])])]);
  store.connect(CTX);
  await Promise.resolve();

  const state = store.getState();
  assert.deepEqual(state.activeSection, { chapter: 1, section: 0 });
  assert.ok(state.expandedChapters.has(1));
});

test("an empty diff leaves no active section", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([]);
  store.connect(CTX);
  await Promise.resolve();

  assert.equal(store.getState().activeSection, null);
});

test("a failed load surfaces the error and leaves snapshot null", async () => {
  const { store } = harness();
  // No reply staged → requireReply throws
  store.connect(CTX);
  await Promise.resolve();

  const state = store.getState();
  assert.ok(state.error !== null);
  assert.equal(state.snapshot, null);
});

test("mark updates the snapshot, returns it, and notifies subscribers", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([chapter("C", [SECTION])]);
  store.connect(CTX);
  await Promise.resolve();

  let notified = 0;
  store.subscribe(() => (notified += 1));

  backend.reply = snapshot([chapter("C", [SECTION])], 1);
  const result = await store.mark("a" as AtomHash, "done");

  assert.deepEqual(backend.calls.at(-1), "mark:ctx:a:done");
  assert.equal(result.progress.addressed, 1);
  assert.equal(store.getState().snapshot?.progress.addressed, 1);
  assert.ok(notified > 0);
});

test("mark preserves the active section (a mark does not regroup)", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([chapter("C", [SECTION])]);
  store.connect(CTX);
  await Promise.resolve();
  store.setActiveSection({ chapter: 0, section: 0 });

  backend.reply = snapshot([chapter("C", [SECTION])], 1);
  await store.mark("a" as AtomHash, "done");

  assert.deepEqual(store.getState().activeSection, { chapter: 0, section: 0 });
});

test("unmark sends the context and patches the snapshot", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([chapter("C", [SECTION])]);
  store.connect(CTX);
  await Promise.resolve();

  backend.reply = snapshot([chapter("C", [SECTION])]);
  await store.unmark("a" as AtomHash);
  assert.deepEqual(backend.calls.at(-1), "unmark:ctx:a");
});

test("comment sends the context and patches the snapshot", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([chapter("C", [SECTION])]);
  store.connect(CTX);
  await Promise.resolve();

  backend.reply = snapshot([chapter("C", [SECTION])]);
  await store.comment("a" as AtomHash, "looks good");
  assert.deepEqual(backend.calls.at(-1), "comment:ctx:a:looks good");
});

test("markComplete sends the active context", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([chapter("C", [SECTION])]);
  store.connect(CTX);
  await Promise.resolve();

  await store.markComplete();
  assert.deepEqual(backend.calls.at(-1), "markComplete:ctx");
});

test("mutating before a review is open rejects", async () => {
  const { store } = harness();
  store.connect(null); // no context → no load
  await assert.rejects(store.mark("a" as AtomHash, "done"), /No active review/);
  await assert.rejects(store.unmark("a" as AtomHash), /No active review/);
  await assert.rejects(store.comment("a" as AtomHash, "x"), /No active review/);
  await assert.rejects(store.markComplete(), /No active review/);
});

test("openInEditor and readFile pass through to the backend", async () => {
  const { store, backend } = harness();
  backend.reply = snapshot([chapter("C", [SECTION])]);
  store.connect(CTX);
  await Promise.resolve();

  await store.openInEditor("f.ts", 12);
  assert.deepEqual(backend.calls.at(-1), "editor:f.ts:12");

  backend.fileReply = { text: "body" };
  assert.deepEqual(await store.readFile("f.ts", "head"), { text: "body" });
  assert.deepEqual(backend.calls.at(-1), "readFile:f.ts:head");
});

test("connection lifecycle drives the connection status", () => {
  const { store, backend } = harness();
  store.connect(null); // null = no snapshot load
  assert.equal(store.getState().connection, "connecting");

  backend.fireConnection("open");
  assert.equal(store.getState().connection, "open");

  backend.fireConnection("reconnecting");
  assert.equal(store.getState().connection, "reconnecting");
});
