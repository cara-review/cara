import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { WebSocket, type RawData } from "ws";
import type { DiffSpec } from "@clear-diff/core";
import { makeTestRepo } from "../git/test-repo.ts";
import { compose } from "./compose.ts";
import { startServer } from "./server.ts";
import type { RpcDeps } from "./dispatch.ts";
import type { ClientRequest, ServerResponse } from "./protocol.ts";

/** A backend whose use-cases throw if touched — for tests that never reach an RPC. */
function stubDeps(): RpcDeps {
  const unused = (): never => {
    throw new Error("backend not exercised by this test");
  };
  return {
    service: { open: unused, mark: unused, unmark: unused, comment: unused, dispatch: unused, openInEditor: unused },
    workspace: { readFile: () => Promise.resolve(null) },
    spec: { kind: "worktree" },
  };
}

function rpc(socket: WebSocket, request: ClientRequest): Promise<ServerResponse> {
  return new Promise((resolve) => {
    socket.once("message", (data: RawData) => resolve(JSON.parse(String(data)) as ServerResponse));
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
  const backend = await compose({
    cwd: repo.dir,
    spec,
    stateDir: join(repo.dir, ".state"),
    config: { load: () => Promise.resolve({ editorCommand: "true" }) },
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

test("a non-loopback Origin is rejected at the WS handshake", async () => {
  const server = await startServer(stubDeps());
  try {
    const socket = new WebSocket(server.url.replace(/^http/, "ws"), { origin: "https://evil.example" });
    const [error] = (await once(socket, "error")) as [Error];
    assert.ok(error instanceof Error, "the handshake is refused, not opened");
    socket.terminate();
  } finally {
    await server.close();
  }
});

test("an over-cap WS frame is rejected without crashing the backend", async () => {
  const server = await startServer(stubDeps());
  // Exceed the 1 MiB maxPayload. ws emits 'error' on the socket for an over-cap
  // frame; with no listener that would be an uncaught exception — a one-frame DoS.
  const overCap = "x".repeat((1 << 20) + 1);
  try {
    const sender = new WebSocket(server.url.replace(/^http/, "ws"));
    await once(sender, "open");
    sender.on("error", () => {}); // the server closes this socket; ignore the client-side error
    sender.send(JSON.stringify({ id: "big", method: "open", params: {}, pad: overCap }));
    await once(sender, "close"); // the server rejects the frame and closes the offending socket

    // The backend must still serve other clients: a fresh connection gets a clean
    // error reply, proving the process survived the unhandled-'error' crash path.
    const probe = new WebSocket(server.url.replace(/^http/, "ws"));
    await once(probe, "open");
    const reply = await new Promise<ServerResponse>((resolve) => {
      probe.once("message", (data: RawData) => resolve(JSON.parse(String(data)) as ServerResponse));
      probe.send("not json");
    });
    assert.equal(reply.ok, false, "the backend is alive and answering");
    probe.close();
  } finally {
    await server.close();
  }
});

test("static serving refuses to read outside the web root", async () => {
  const root = await mkdtemp(join(tmpdir(), "clear-diff-web-"));
  const secret = await mkdtemp(join(tmpdir(), "clear-diff-secret-"));
  await writeFile(join(root, "index.html"), "<h1>app</h1>");
  await writeFile(join(secret, "secret.txt"), "TOPSECRET");

  const server = await startServer(stubDeps(), { webRoot: root });
  try {
    const index = await fetch(`${server.url}/`);
    assert.equal(await index.text(), "<h1>app</h1>");

    // %2e%2e survives client-side normalisation; the server decodes then must reject the escape.
    const escaped = await fetch(`${server.url}/%2e%2e/${basename(secret)}/secret.txt`);
    assert.ok(!(await escaped.text()).includes("TOPSECRET"), "traversal must not leak outside the root");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    await rm(secret, { recursive: true, force: true });
  }
});
