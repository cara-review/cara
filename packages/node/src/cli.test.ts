import { test } from "bun:test";
import assert from "node:assert/strict";
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import { CliError, parseArgs, runCli } from "./cli.ts";
import { makeTestRepo } from "./git/test-repo.ts";
import type { AppRouter } from "./server/router.ts";

test("no arguments review the worktree", () => {
  assert.deepEqual(parseArgs([]), { spec: { kind: "worktree" }, open: true, fake: false });
});

test("--no-open suppresses the browser launch", () => {
  assert.deepEqual(parseArgs(["--no-open"]), { spec: { kind: "worktree" }, open: false, fake: false });
});

test("--fake opts into the offline demo agent", () => {
  assert.deepEqual(parseArgs(["--fake"]), { spec: { kind: "worktree" }, open: true, fake: true });
});

test("a <base>..<head> argument is a range spec", () => {
  assert.deepEqual(parseArgs(["main..feature"]), {
    spec: { kind: "range", base: "main", head: "feature" },
    open: true,
    fake: false,
  });
});

test("--pr is rejected as not yet supported", () => {
  assert.throws(() => parseArgs(["--pr", "63"]), CliError);
});

test("a non-range argument is rejected", () => {
  assert.throws(() => parseArgs(["main"]), CliError);
});

test("a half-empty range is rejected", () => {
  assert.throws(() => parseArgs(["main.."]), CliError);
});

test("the git three-dot form is rejected, not silently mangled", () => {
  assert.throws(() => parseArgs(["main...feature"]), CliError);
});

test("a doubled range is rejected", () => {
  assert.throws(() => parseArgs(["a..b..c"]), CliError);
});

test("a second positional argument is rejected", () => {
  assert.throws(() => parseArgs(["a..b", "c..d"]), CliError);
});

test("runCli boots a server that serves a snapshot over WS", async () => {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  const base = await repo.commit("base");
  await repo.write("a.ts", "one\ntwo\n");
  const head = await repo.commit("add line");

  const server = await runCli([`${base}..${head}`, "--no-open", "--fake"], {
    cwd: repo.dir,
    openApp: () => {},
    log: () => {},
  });

  const ws = createWSClient({ url: server.url.replace(/^http/, "ws") });
  const trpc = createTRPCClient<AppRouter>({ links: [wsLink({ client: ws })] });
  try {
    const snapshot = await new Promise<{ review: { masterList: readonly unknown[] } }>((resolve, reject) => {
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
    assert.ok(snapshot.review.masterList.length >= 1);
  } finally {
    ws.close();
    await server.close();
    await repo.cleanup();
  }
});
