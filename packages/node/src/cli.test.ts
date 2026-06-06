import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket, type RawData } from "ws";
import { CliError, parseArgs, runCli } from "./cli.ts";
import { makeTestRepo } from "./git/test-repo.ts";
import type { ServerResponse } from "./server/protocol.ts";

test("no arguments review the worktree", () => {
  assert.deepEqual(parseArgs([]), { spec: { kind: "worktree" }, open: true });
});

test("--no-open suppresses the browser launch", () => {
  assert.deepEqual(parseArgs(["--no-open"]), { spec: { kind: "worktree" }, open: false });
});

test("a <base>..<head> argument is a range spec", () => {
  assert.deepEqual(parseArgs(["main..feature"]), {
    spec: { kind: "range", base: "main", head: "feature" },
    open: true,
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

  const server = await runCli([`${base}..${head}`, "--no-open"], {
    cwd: repo.dir,
    openApp: () => {},
    log: () => {},
  });

  const socket = new WebSocket(server.url.replace(/^http/, "ws"));
  await once(socket, "open");
  try {
    const opened = await new Promise<ServerResponse>((resolve) => {
      socket.once("message", (data: RawData) => resolve(JSON.parse(String(data)) as ServerResponse));
      socket.send(JSON.stringify({ id: "1", method: "open", params: {} }));
    });
    assert.ok(opened.ok && opened.result !== null && "review" in opened.result);
    assert.ok(opened.result.review.masterList.length >= 1);
  } finally {
    socket.close();
    await server.close();
    await repo.cleanup();
  }
});
