import { test } from "node:test";
import assert from "node:assert/strict";
import type { AtomHash, ReviewSnapshot, Section } from "./protocol.ts";
import { RpcClient } from "./rpc.ts";
import { AppStore } from "./store.ts";
import { FakeTransport, section } from "./test-support.ts";

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

function harness(): { store: AppStore; transport: FakeTransport } {
  const transport = new FakeTransport();
  const store = new AppStore(new RpcClient(transport));
  return { store, transport };
}

const SECTION: Section = section("S", ["a"]);

async function openWith(store: AppStore, transport: FakeTransport, snap: ReviewSnapshot): Promise<void> {
  const pending = store.open();
  transport.deliver(JSON.stringify({ id: transport.lastId(), ok: true, result: snap }));
  await pending;
}

test("open expands the first chapter and focuses its first section", async () => {
  const { store, transport } = harness();
  await openWith(store, transport, snapshot([chapter("C", [SECTION])]));

  const state = store.getState();
  assert.deepEqual(state.activeSection, { chapter: 0, section: 0 });
  assert.ok(state.expandedChapters.has(0));
  assert.equal(state.snapshot?.review.masterList.length, 1);
});

test("open skips a leading empty chapter to focus the first one with sections", async () => {
  const { store, transport } = harness();
  await openWith(store, transport, snapshot([chapter("Empty", []), chapter("Has content", [section("S", ["a"])])]));

  const state = store.getState();
  assert.deepEqual(state.activeSection, { chapter: 1, section: 0 });
  assert.ok(state.expandedChapters.has(1));
});

test("an empty diff leaves no active section", async () => {
  const { store, transport } = harness();
  await openWith(store, transport, snapshot([]));
  assert.equal(store.getState().activeSection, null);
});

test("a failed open surfaces the error instead of leaving state blank", async () => {
  const { store, transport } = harness();
  const pending = store.open();
  transport.deliver(JSON.stringify({ id: transport.lastId(), ok: false, error: "boom" }));
  await assert.rejects(pending, /boom/);
  const state = store.getState();
  assert.equal(state.error, "boom");
  assert.equal(state.snapshot, null);
});

test("mark updates the snapshot, returns it, and notifies subscribers", async () => {
  const { store, transport } = harness();
  await openWith(store, transport, snapshot([chapter("C", [SECTION])]));

  let notified = 0;
  store.subscribe(() => (notified += 1));

  const marked = store.mark("a" as AtomHash, "done");
  const request = transport.lastRequest();
  assert.equal(request.method, "mark");
  assert.equal(request.params.disposition, "done");
  transport.deliver(JSON.stringify({ id: request.id, ok: true, result: snapshot([chapter("C", [SECTION])], 1) }));

  const result = await marked;
  assert.equal(result.progress.addressed, 1);
  assert.equal(store.getState().snapshot?.progress.addressed, 1);
  assert.ok(notified > 0);
});

test("mark preserves the active section (a mark does not regroup)", async () => {
  const { store, transport } = harness();
  await openWith(store, transport, snapshot([chapter("C", [SECTION])]));
  store.setActiveSection({ chapter: 0, section: 0 });

  const marked = store.mark("a" as AtomHash, "done");
  transport.deliver(JSON.stringify({ id: transport.lastId(), ok: true, result: snapshot([chapter("C", [SECTION])], 1) }));
  await marked;

  assert.deepEqual(store.getState().activeSection, { chapter: 0, section: 0 });
});

test("unmark and comment send the context-bearing frame and patch the snapshot", async () => {
  const { store, transport } = harness();
  await openWith(store, transport, snapshot([chapter("C", [SECTION])]));

  const unmarked = store.unmark("a" as AtomHash);
  const unmarkReq = transport.lastRequest();
  assert.equal(unmarkReq.method, "unmark");
  assert.equal(unmarkReq.params.context, "ctx");
  transport.deliver(JSON.stringify({ id: unmarkReq.id, ok: true, result: snapshot([chapter("C", [SECTION])]) }));
  await unmarked;

  const commented = store.comment("a" as AtomHash, "looks good");
  const commentReq = transport.lastRequest();
  assert.equal(commentReq.method, "comment");
  assert.equal(commentReq.params.body, "looks good");
  transport.deliver(JSON.stringify({ id: commentReq.id, ok: true, result: snapshot([chapter("C", [SECTION])]) }));
  await commented;
});

test("dispatch sends the active context and returns the receipt", async () => {
  const { store, transport } = harness();
  await openWith(store, transport, snapshot([chapter("C", [SECTION])]));

  const sent = store.dispatch();
  const req = transport.lastRequest();
  assert.equal(req.method, "dispatch");
  assert.equal(req.params.context, "ctx");
  transport.deliver(JSON.stringify({ id: req.id, ok: true, result: { count: 2, location: "sink://ctx" } }));
  assert.deepEqual(await sent, { count: 2, location: "sink://ctx" });
});

test("mutating before a review is open rejects", async () => {
  const { store } = harness();
  await assert.rejects(store.mark("a" as AtomHash, "done"), /No active review/);
  await assert.rejects(store.unmark("a" as AtomHash), /No active review/);
  await assert.rejects(store.comment("a" as AtomHash, "x"), /No active review/);
  await assert.rejects(store.dispatch(), /No active review/);
});

test("openInEditor and readFile pass through to the rpc", async () => {
  const { store, transport } = harness();

  const opened = store.openInEditor("f.ts", 12);
  const openReq = transport.lastRequest();
  assert.equal(openReq.method, "openInEditor");
  assert.equal(openReq.params.line, 12);
  transport.deliver(JSON.stringify({ id: openReq.id, ok: true, result: null }));
  assert.equal(await opened, null);

  const read = store.readFile("f.ts", "head");
  const readReq = transport.lastRequest();
  assert.equal(readReq.method, "readFile");
  assert.equal(readReq.params.side, "head");
  transport.deliver(JSON.stringify({ id: readReq.id, ok: true, result: { text: "body" } }));
  assert.deepEqual(await read, { text: "body" });
});

test("transport lifecycle drives the connection status", () => {
  const { store, transport } = harness();
  store.bindTransport(transport);
  assert.equal(store.getState().connection, "connecting");

  transport.fire("open");
  assert.equal(store.getState().connection, "open");

  transport.fire("reconnecting");
  assert.equal(store.getState().connection, "reconnecting");

  transport.fire("close");
  assert.equal(store.getState().connection, "closed");
});
