import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { join } from "node:path";
import { WebSocket, type RawData } from "ws";
import type { DiffSpec } from "@clear-diff/core";
import { makeTestRepo } from "../git/test-repo.ts";
import { compose } from "./compose.ts";
import { startServer } from "./server.ts";
import type { ClientRequest, ServerResponse } from "./protocol.ts";

function rpc(socket: WebSocket, request: ClientRequest): Promise<ServerResponse> {
  return new Promise((resolvePromise) => {
    socket.once("message", (data: RawData) => resolvePromise(JSON.parse(String(data)) as ServerResponse));
    socket.send(JSON.stringify(request));
  });
}

test("WS round-trip: open, mark, and readFile over a real repo", async () => {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  const base = await repo.commit("base");
  await repo.write("a.ts", "one\ntwo\n");
  const head = await repo.commit("add line");

  const spec: DiffSpec = { kind: "range", base, head };
  const backend = compose({
    cwd: repo.dir,
    spec,
    stateDir: join(repo.dir, ".state"),
    editorCommand: "true",
  });
  const server = await startServer(backend);
  assert.ok(server.url.startsWith("http://127.0.0.1:"), "binds localhost only");

  const socket = new WebSocket(server.url.replace(/^http/, "ws"));
  await once(socket, "open");
  try {
    const opened = await rpc(socket, { id: "1", method: "open", params: {} });
    assert.ok(opened.ok && opened.result !== null && "review" in opened.result);
    const hash = opened.result.review.masterList[0]?.hash;
    assert.ok(hash, "open returns at least one atom");

    const marked = await rpc(socket, {
      id: "2",
      method: "mark",
      params: { context: opened.result.context, atomHash: hash, disposition: "done" },
    });
    assert.ok(marked.ok && marked.result !== null && "marks" in marked.result);
    assert.equal(marked.result.marks.length, 1);
    assert.equal(marked.result.progress.addressed, 1);

    const file = await rpc(socket, {
      id: "3",
      method: "readFile",
      params: { path: "a.ts", side: "head" },
    });
    assert.ok(file.ok);
    assert.deepEqual(file.result, { text: "one\ntwo\n" });
  } finally {
    socket.close();
    await server.close();
    await repo.cleanup();
  }
});
