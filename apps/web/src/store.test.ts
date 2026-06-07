import { test } from "bun:test";
import assert from "node:assert/strict";
import type { AtomHash, ReviewSnapshot, Section } from "./protocol.ts";
import { AppStore } from "./store.ts";
import { FakeBackend, section } from "./test-support.ts";

function snapshot(chapters: ReviewSnapshot["review"]["chapters"], addressed = 0): ReviewSnapshot {
  const masterList = chapters.flatMap((c) => c.sections.flatMap((s) => s.atoms));
  return {
    context: "ctx" as ReviewSnapshot["context"],
    review: { chapters, masterList },
    marks: [],
    comments: [],
    progress: { total: masterList.length, addressed, unaddressed: masterList.length - addressed },
  };
}

function chapter(title: string, sections: readonly Section[]): ReviewSnapshot["review"]["chapters"][number] {
  return { title, summary: null, sections };
}

function harness(): { store: AppStore; backend: FakeBackend } {
  const backend = new FakeBackend();
  const store = new AppStore(backend);
  store.connect();
  return { store, backend };
}

const SECTION: Section = section("S", ["a"]);

test("a delivered snapshot expands the first chapter and focuses its first section", () => {
  const { store, backend } = harness();
  backend.deliver(snapshot([chapter("C", [SECTION])]));

  const state = store.getState();
  assert.deepEqual(state.activeSection, { chapter: 0, section: 0 });
  assert.ok(state.expandedChapters.has(0));
  assert.equal(state.snapshot?.review.masterList.length, 1);
  assert.equal(state.grouping, null);
});

test("open skips a leading empty chapter to focus the first one with sections", () => {
  const { store, backend } = harness();
  backend.deliver(snapshot([chapter("Empty", []), chapter("Has content", [section("S", ["a"])])]));

  const state = store.getState();
  assert.deepEqual(state.activeSection, { chapter: 1, section: 0 });
  assert.ok(state.expandedChapters.has(1));
});

test("an empty diff leaves no active section", () => {
  const { store, backend } = harness();
  backend.deliver(snapshot([]));
  assert.equal(store.getState().activeSection, null);
});

test("a failed open surfaces the error instead of leaving state blank", () => {
  const { store, backend } = harness();
  backend.failOpen("boom");
  const state = store.getState();
  assert.equal(state.error, "boom");
  assert.equal(state.snapshot, null);
  assert.equal(state.grouping, null);
});

test("grouping progress streams elapsed time and revealed section titles before the snapshot", () => {
  const { store, backend } = harness();
  backend.fireConnection("open");
  assert.equal(store.getState().connection, "open");
  assert.deepEqual(store.getState().grouping, { elapsedMs: 0, sections: [] });

  backend.emitProgress(1200);
  backend.emitSection("Auth");
  backend.emitSection("Storage");
  assert.deepEqual(store.getState().grouping, { elapsedMs: 1200, sections: ["Auth", "Storage"] });

  backend.deliver(snapshot([chapter("C", [SECTION])]));
  assert.equal(store.getState().grouping, null);
});

test("mark updates the snapshot, returns it, and notifies subscribers", async () => {
  const { store, backend } = harness();
  backend.deliver(snapshot([chapter("C", [SECTION])]));

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
  backend.deliver(snapshot([chapter("C", [SECTION])]));
  store.setActiveSection({ chapter: 0, section: 0 });

  backend.reply = snapshot([chapter("C", [SECTION])], 1);
  await store.mark("a" as AtomHash, "done");

  assert.deepEqual(store.getState().activeSection, { chapter: 0, section: 0 });
});

test("unmark and comment send the context and patch the snapshot", async () => {
  const { store, backend } = harness();
  backend.deliver(snapshot([chapter("C", [SECTION])]));

  backend.reply = snapshot([chapter("C", [SECTION])]);
  await store.unmark("a" as AtomHash);
  assert.deepEqual(backend.calls.at(-1), "unmark:ctx:a");

  await store.comment("a" as AtomHash, "looks good");
  assert.deepEqual(backend.calls.at(-1), "comment:ctx:a:looks good");
});

test("dispatch sends the active context and returns the receipt", async () => {
  const { store, backend } = harness();
  backend.deliver(snapshot([chapter("C", [SECTION])]));

  backend.dispatchReply = { count: 2, location: "sink://ctx" };
  assert.deepEqual(await store.dispatch(), { count: 2, location: "sink://ctx" });
  assert.deepEqual(backend.calls.at(-1), "dispatch:ctx");
});

test("mutating before a review is open rejects", async () => {
  const { store } = harness();
  await assert.rejects(store.mark("a" as AtomHash, "done"), /No active review/);
  await assert.rejects(store.unmark("a" as AtomHash), /No active review/);
  await assert.rejects(store.comment("a" as AtomHash, "x"), /No active review/);
  await assert.rejects(store.dispatch(), /No active review/);
});

test("openInEditor and readFile pass through to the backend", async () => {
  const { store, backend } = harness();

  await store.openInEditor("f.ts", 12);
  assert.deepEqual(backend.calls.at(-1), "editor:f.ts:12");

  backend.fileReply = { text: "body" };
  assert.deepEqual(await store.readFile("f.ts", "head"), { text: "body" });
  assert.deepEqual(backend.calls.at(-1), "readFile:f.ts:head");
});

test("connection lifecycle drives the connection status", () => {
  const { store, backend } = harness();
  assert.equal(store.getState().connection, "connecting");

  backend.fireConnection("open");
  assert.equal(store.getState().connection, "open");

  backend.fireConnection("reconnecting");
  assert.equal(store.getState().connection, "reconnecting");
});
