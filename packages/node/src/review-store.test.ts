import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { project, type AtomHash, type MarkEvent, type ReviewContext } from "@clear-diff/core";
import { JsonlReviewStore } from "./review-store.ts";

const ctx = (s: string): ReviewContext => s as ReviewContext;
const atom = (s: string): AtomHash => s as AtomHash;
const fileFor = (dir: string, context: ReviewContext): string =>
  join(dir, `${createHash("sha256").update(context).digest("hex")}.jsonl`);

async function freshStore(): Promise<JsonlReviewStore> {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  return new JsonlReviewStore(dir);
}

test("load on a never-written context returns no events", async () => {
  const store = await freshStore();
  assert.deepEqual(await store.load(ctx("worktree:feature/x")), []);
});

test("append then load round-trips events in append order", async () => {
  const store = await freshStore();
  const context = ctx("base..head");
  const events: MarkEvent[] = [
    { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done" },
    { type: "commented", ts: 2, atomHash: atom("a"), body: "looks off" },
    { type: "unmarked", ts: 3, atomHash: atom("a") },
  ];
  for (const event of events) await store.append(context, event);
  assert.deepEqual(await store.load(context), events);
});

test("core's project folds the loaded log to current state", async () => {
  const store = await freshStore();
  const context = ctx("pr:42");
  await store.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done" });
  await store.append(context, { type: "marked", ts: 2, atomHash: atom("b"), disposition: "skipped" });
  await store.append(context, { type: "unmarked", ts: 3, atomHash: atom("a") });
  await store.append(context, { type: "commented", ts: 4, atomHash: atom("b"), body: "why?" });

  const state = project(await store.load(context));
  assert.equal(state.marks.has(atom("a")), false); // marked then unmarked
  assert.equal(state.marks.get(atom("b")), "skipped");
  assert.deepEqual(state.comments, [{ atomHash: atom("b"), body: "why?", ts: 4 }]);
});

test("marks do not bleed between contexts", async () => {
  const store = await freshStore();
  const a = ctx("worktree:feature/a");
  const b = ctx("worktree:feature/b");
  await store.append(a, { type: "marked", ts: 1, atomHash: atom("x"), disposition: "done" });

  assert.deepEqual(await store.load(b), []);
  assert.deepEqual(await store.load(a), [
    { type: "marked", ts: 1, atomHash: atom("x"), disposition: "done" },
  ]);
});

test("the same context maps to a stable file across runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  const context = ctx("base..head");
  const first = new JsonlReviewStore(dir);
  await first.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done" });
  const second = new JsonlReviewStore(dir);
  await second.append(context, { type: "unmarked", ts: 2, atomHash: atom("a") });

  assert.equal((await second.load(context)).length, 2);
});

test("persisted lines are newline-framed JSON, no atom payload stored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  const store = new JsonlReviewStore(dir);
  const context = ctx("worktree:feature/x");
  await store.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done" });
  await store.append(context, { type: "unmarked", ts: 2, atomHash: atom("a") });

  const raw = await readFile(fileFor(dir, context), "utf8");
  const lines = raw.split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]!), {
    type: "marked",
    ts: 1,
    atomHash: "a",
    disposition: "done",
  });
});

test("load throws on a non-JSON line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  const context = ctx("worktree:feature/x");
  await writeFile(fileFor(dir, context), "not json\n", "utf8");
  await assert.rejects(new JsonlReviewStore(dir).load(context));
});

test("load throws on a structurally invalid event (missing disposition)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  const context = ctx("worktree:feature/x");
  await writeFile(fileFor(dir, context), `${JSON.stringify({ type: "marked", ts: 1, atomHash: "a" })}\n`, "utf8");
  await assert.rejects(new JsonlReviewStore(dir).load(context), /Corrupt event log line/);
});
