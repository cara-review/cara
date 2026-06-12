import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { ReviewService } from "@clear-diff/core";
import { fixedClock } from "../clock.ts";
import { makeTestRepo } from "../git/test-repo.ts";
import { UserFacingError } from "../user-facing-error.ts";
import { createReviewActivity } from "./activity.ts";
import { compose } from "./compose.ts";
import { startServer } from "./server.ts";
import type { AppRouter, RpcDeps } from "./router.ts";

/** A backend whose use-cases throw if touched — for tests that never reach a procedure. */
function stubDeps(service?: ReviewService): RpcDeps {
  const unused = (): never => {
    throw new Error("backend not exercised by this test");
  };
  const full: ReviewService = service ?? {
    getAtoms: unused,
    presentGrouping: unused,
    requestReshape: unused,
    snapshot: unused,
    mark: unused,
    unmark: unused,
    comment: unused,
    submit: unused,
    dispatch: unused,
    repoCoverage: unused,
    markComplete: unused,
    openInEditor: unused,
  };
  return {
    service: full,
    workspace: { readFile: () => Promise.resolve(null) },
    spec: { kind: "worktree" },
    activity: createReviewActivity(fixedClock(0)),
    clock: fixedClock(0),
  };
}

function connect(httpUrl: string) {
  const ws = createWSClient({ url: httpUrl.replace(/^http/, "ws") });
  const trpc = createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] });
  return { trpc, close: () => ws.close() };
}

test("WS round-trip: snapshot query, mark, and readFile over a real repo", async () => {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  const base = await repo.commit("base");
  await repo.write("a.ts", "one\ntwo\n");
  const head = await repo.commit("add line");

  const spec = { kind: "range", base, head } as const;
  const backend = await compose({
    cwd: repo.dir,
    spec,
    config: { load: () => Promise.resolve({ editorCommand: "true" }) },
  });
  // The browser boots against a grouping the CLI `present` has already cached.
  const presented = await backend.service.presentGrouping(spec, { chapters: [] });
  const hash = presented.review.masterList[0]?.hash;
  assert.ok(hash, "the diff has at least one atom");

  const server = await startServer(backend);
  assert.ok(server.url.startsWith("http://127.0.0.1:"), "binds localhost only");
  const { trpc, close } = connect(server.url);
  try {
    const snap = await trpc.snapshot.query({ context: presented.context });
    assert.ok(snap.review.masterList.length >= 1);

    const marked = await trpc.mark.mutate({ context: presented.context, atomHash: hash, disposition: "done" });
    assert.equal(marked.marks.length, 1);
    assert.equal(marked.marks[0]!.author.tier, "human"); // channel-inferred
    assert.equal(marked.progress.addressed, 1);

    assert.deepEqual(await trpc.readFile.query({ path: "a.ts", side: "head" }), { text: "one\ntwo\n" });
  } finally {
    close();
    await server.close();
    await repo.cleanup();
  }
});

test("reshape handover re-presents on the live server and returns the new grouping", async () => {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  const base = await repo.commit("base");
  await repo.write("a.ts", "one\ntwo\n");
  const head = await repo.commit("add line");

  const spec = { kind: "range", base, head } as const;
  const backend = await compose({
    cwd: repo.dir,
    spec,
    config: { load: () => Promise.resolve({ editorCommand: "true" }) },
  });
  // Boot the browser against an initial (ungrouped) review the CLI present cached.
  const presented = await backend.service.presentGrouping(spec, { chapters: [] });
  const hash = presented.review.masterList[0]!.hash;

  const server = await startServer(backend);
  const { trpc, close } = connect(server.url);
  try {
    // The CLI present-client hands a fresh, fully-summarised grouping to the live server.
    const grouping = {
      chapters: [
        { title: "Core", summary: "the core change", sections: [{ title: "Edit", summary: "the edit", atomHashes: [hash] }] },
      ],
    };
    // The mutation re-presents on the server and returns the now-current snapshot — proof
    // the live server's cached review is updated (a reconnecting browser reads this).
    const refreshed = await trpc.reshape.mutate({ context: presented.context, grouping });
    assert.equal(refreshed.review.chapters[0]?.title, "Core");
    assert.equal(refreshed.progress.total, 1);
  } finally {
    close();
    await server.close();
    await repo.cleanup();
  }
});

test("callWait round-trips the wait verdict over a live server (done once complete)", async () => {
  const { callWait } = await import("../cli/wait.ts");
  const base = stubDeps();
  const service = {
    ...base.service,
    dispatch: async () => ({ context: "ctx" as never, comments: [], progress: { total: 2, addressed: 2, accounted: 2, unaddressed: 0, scrutiny: [] }, reshape: null }),
  } as ReviewService;
  const activity = createReviewActivity(fixedClock(0));
  activity.complete();
  const server = await startServer({ ...base, service, activity });
  try {
    const result = await callWait(server.url, "ctx" as never, {});
    assert.equal(result.state, "done");
    assert.ok(result.state === "done" && result.progress.addressed === 2);
  } finally {
    await server.close();
  }
});

test("a use-case failure is masked behind a generic error over the wire", async () => {
  const reject = () => Promise.reject(new Error("git stderr: /Users/secret/path leaked"));
  const failing = { ...stubDeps().service, snapshot: reject } as ReviewService;
  const server = await startServer(stubDeps(failing));
  const { trpc, close } = connect(server.url);
  try {
    await assert.rejects(() => trpc.snapshot.query({ context: "c" }), /Internal error\./);
  } finally {
    close();
    await server.close();
  }
});

test("a UserFacingError surfaces its curated message instead of being masked", async () => {
  const message = "This review log predates the pivot — delete it and re-review.";
  const reject = () => Promise.reject(new UserFacingError(message));
  const failing = { ...stubDeps().service, snapshot: reject } as ReviewService;
  const server = await startServer(stubDeps(failing));
  const { trpc, close } = connect(server.url);
  try {
    await assert.rejects(
      () => trpc.snapshot.query({ context: "c" }),
      new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  } finally {
    close();
    await server.close();
  }
});

test("a non-loopback Origin is rejected at the WS handshake", async () => {
  const server = await startServer(stubDeps());
  try {
    const socket = new WebSocket(server.url.replace(/^http/, "ws"), { headers: { Origin: "https://evil.example" } });
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
    assert.equal(await (await fetch(`${server.url}/`)).text(), "<h1>app</h1>");
    const escaped = await fetch(`${server.url}/%2e%2e/${basename(secret)}/secret.txt`);
    assert.ok(!(await escaped.text()).includes("TOPSECRET"), "traversal must not leak outside the root");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    await rm(secret, { recursive: true, force: true });
  }
});
