import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { ReviewService, ReviewSnapshot } from "@clear-diff/core";
import { makeTestRepo } from "../git/test-repo.ts";
import { UserFacingError } from "../user-facing-error.ts";
import { compose } from "./compose.ts";
import { startServer } from "./server.ts";
import type { AppRouter, RpcDeps } from "./router.ts";

/** A backend whose use-cases throw if touched — for tests that never reach a procedure. */
function stubDeps(): RpcDeps {
  const unused = (): never => {
    throw new Error("backend not exercised by this test");
  };
  return {
    service: { open: unused, mark: unused, unmark: unused, comment: unused, dispatch: unused, ask: unused, openInEditor: unused },
    workspace: { readFile: () => Promise.resolve(null) },
    spec: { kind: "worktree" },
  };
}

/** A tRPC client over the server's WebSocket, plus a close(). */
function connect(httpUrl: string) {
  const ws = createWSClient({ url: httpUrl.replace(/^http/, "ws") });
  const trpc = createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] });
  return { trpc, close: () => ws.close() };
}

/** Drive the `open` subscription to its terminal snapshot event. */
function openSnapshot(trpc: ReturnType<typeof connect>["trpc"]): Promise<ReviewSnapshot> {
  return new Promise((resolve, reject) => {
    const sub = trpc.open.subscribe(undefined, {
      onData: (event) => {
        if (event.kind === "snapshot") {
          resolve(event.snapshot);
          sub.unsubscribe();
        }
      },
      onError: (error) => reject(error),
    });
  });
}

test("WS round-trip: open, mark, and readFile over a real repo", async () => {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  const base = await repo.commit("base");
  await repo.write("a.ts", "one\ntwo\n");
  const head = await repo.commit("add line");

  const backend = await compose({
    cwd: repo.dir,
    spec: { kind: "range", base, head },
    stateDir: join(repo.dir, ".state"),
    config: { load: () => Promise.resolve({ editorCommand: "true" }) },
  });
  const server = await startServer(backend);
  assert.ok(server.url.startsWith("http://127.0.0.1:"), "binds localhost only");

  const { trpc, close } = connect(server.url);
  try {
    const opened = await openSnapshot(trpc);
    const hash = opened.review.masterList[0]?.hash;
    assert.ok(hash, "open returns at least one atom");

    const marked = await trpc.mark.mutate({ context: opened.context, atomHash: hash, disposition: "done" });
    assert.equal(marked.marks.length, 1);
    assert.equal(marked.progress.addressed, 1);

    const file = await trpc.readFile.query({ path: "a.ts", side: "head" });
    assert.deepEqual(file, { text: "one\ntwo\n" });
  } finally {
    close();
    await server.close();
    await repo.cleanup();
  }
});

test("a use-case failure is masked behind a generic error over the wire", async () => {
  const reject = () => Promise.reject(new Error("git stderr: /Users/secret/path leaked"));
  const failing: ReviewService = {
    open: reject,
    mark: reject,
    unmark: reject,
    comment: reject,
    dispatch: reject,
    ask: reject,
    openInEditor: reject,
  };
  const server = await startServer({ service: failing, workspace: stubDeps().workspace, spec: { kind: "worktree" } });
  const { trpc, close } = connect(server.url);
  try {
    await assert.rejects(() => openSnapshot(trpc), /Internal error\./);
  } finally {
    close();
    await server.close();
  }
});

test("a UserFacingError surfaces its curated message instead of being masked", async () => {
  const message = "AI grouping timed out — the diff may be too large. Try a smaller range.";
  const reject = () => Promise.reject(new UserFacingError(message));
  const failing: ReviewService = {
    open: reject,
    mark: reject,
    unmark: reject,
    comment: reject,
    dispatch: reject,
    ask: reject,
    openInEditor: reject,
  };
  const server = await startServer({ service: failing, workspace: stubDeps().workspace, spec: { kind: "worktree" } });
  const { trpc, close } = connect(server.url);
  try {
    await assert.rejects(() => openSnapshot(trpc), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    close();
    await server.close();
  }
});

test("a non-loopback Origin is rejected at the WS handshake", async () => {
  const server = await startServer(stubDeps());
  try {
    const socket = new WebSocket(server.url.replace(/^http/, "ws"), {
      headers: { Origin: "https://evil.example" },
    });
    const refused = await new Promise<boolean>((resolve) => {
      socket.addEventListener("open", () => resolve(false), { once: true });
      socket.addEventListener("close", () => resolve(true), { once: true });
      socket.addEventListener("error", () => resolve(true), { once: true });
    });
    assert.ok(refused, "the handshake is refused, not opened");
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
