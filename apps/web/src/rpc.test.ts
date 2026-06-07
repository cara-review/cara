import { test } from "bun:test";
import assert from "node:assert/strict";
import { RpcClient } from "./rpc.ts";
import { FakeTransport } from "./test-support.ts";

test("request sends a correlated frame and resolves with the matching result", async () => {
  const transport = new FakeTransport();
  const rpc = new RpcClient(transport);

  const pending = rpc.request("openInEditor", { path: "f.ts", line: 3 });
  const { id, method } = transport.lastRequest();
  assert.equal(method, "openInEditor");
  transport.deliver(JSON.stringify({ id, ok: true, result: null }));
  assert.equal(await pending, null);
});

test("an ok:false response rejects with the error message", async () => {
  const transport = new FakeTransport();
  const rpc = new RpcClient(transport);

  const pending = rpc.request("readFile", { path: "f.ts", side: "head" });
  const { id } = transport.lastRequest();
  transport.deliver(JSON.stringify({ id, ok: false, error: "no such file" }));
  await assert.rejects(pending, /no such file/);
});

test("an ok:false frame with no error message is dropped (stays pending)", async () => {
  const transport = new FakeTransport();
  const rpc = new RpcClient(transport);

  const pending = rpc.request("readFile", { path: "f.ts", side: "head" });
  const { id } = transport.lastRequest();
  transport.deliver(JSON.stringify({ id, ok: false })); // malformed: ignored, not a blank Error
  transport.deliver(JSON.stringify({ id, ok: true, result: { text: "ok" } }));
  assert.deepEqual(await pending, { text: "ok" });
});

test("responses for unknown or already-settled ids are ignored", async () => {
  const transport = new FakeTransport();
  const rpc = new RpcClient(transport);

  const pending = rpc.request("readFile", { path: "f.ts", side: "head" });
  const { id } = transport.lastRequest();
  transport.deliver(JSON.stringify({ id: "999", ok: true, result: { text: "wrong" } }));
  transport.deliver("not json");
  transport.deliver(JSON.stringify({ id, ok: true, result: { text: "right" } }));
  transport.deliver(JSON.stringify({ id, ok: true, result: { text: "late" } })); // ignored
  assert.deepEqual(await pending, { text: "right" });
});

test("a pending request rejects when the socket drops", async () => {
  const transport = new FakeTransport();
  const rpc = new RpcClient(transport);

  const pending = rpc.request("readFile", { path: "f.ts", side: "head" });
  transport.fire("reconnecting");
  await assert.rejects(pending, /Connection lost\./);
});

test("a pending request rejects when the connection closes terminally", async () => {
  const transport = new FakeTransport();
  const rpc = new RpcClient(transport);

  const pending = rpc.request("readFile", { path: "f.ts", side: "head" });
  transport.fire("close");
  await assert.rejects(pending, /Connection lost\./);
});

test("requests issued after a drop settle normally", async () => {
  const transport = new FakeTransport();
  const rpc = new RpcClient(transport);

  const stranded = rpc.request("readFile", { path: "a", side: "head" });
  transport.fire("reconnecting");
  await assert.rejects(stranded, /Connection lost\./);

  const fresh = rpc.request("readFile", { path: "b", side: "head" });
  transport.deliver(JSON.stringify({ id: transport.lastId(), ok: true, result: { text: "B" } }));
  assert.deepEqual(await fresh, { text: "B" });
});

test("out-of-order responses resolve their own requests", async () => {
  const transport = new FakeTransport();
  const rpc = new RpcClient(transport);

  const first = rpc.request("readFile", { path: "a", side: "head" });
  const firstId = transport.lastRequest().id;
  const second = rpc.request("readFile", { path: "b", side: "head" });
  const secondId = transport.lastRequest().id;

  transport.deliver(JSON.stringify({ id: secondId, ok: true, result: { text: "B" } }));
  transport.deliver(JSON.stringify({ id: firstId, ok: true, result: { text: "A" } }));

  assert.deepEqual(await first, { text: "A" });
  assert.deepEqual(await second, { text: "B" });
});
