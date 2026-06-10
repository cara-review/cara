import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { project, type AtomHash, type MarkAuthor, type MarkEvent, type ReviewContext } from "@clear-diff/core";
import { JsonlReviewStore } from "./review-store.ts";

const ctx = (s: string): ReviewContext => s as ReviewContext;
const atom = (s: string): AtomHash => s as AtomHash;
const human: MarkAuthor = { tier: "human", reviewer: null };
const agent: MarkAuthor = { tier: "agent", reviewer: "security" };
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

test("append then load round-trips every event type in append order", async () => {
  const store = await freshStore();
  const context = ctx("base..head");
  const events: MarkEvent[] = [
    { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done", author: human },
    { type: "commented", ts: 2, atomHash: atom("a"), body: "looks off", author: agent },
    { type: "commented", ts: 3, atomHash: atom("a"), body: "this line", author: human, line: { side: "added", text: "x" } },
    { type: "answered", ts: 4, commentId: "c0", body: "fixed", author: human },
    { type: "unmarked", ts: 5, atomHash: atom("a"), author: human },
    { type: "reshape-requested", ts: 6, body: "split the tests out" },
    { type: "presented", ts: 7 },
    { type: "completed", ts: 8 },
  ];
  for (const event of events) await store.append(context, event);
  assert.deepEqual(await store.load(context), events);
});

test("the new review-level events fold to pending-reshape state after a round-trip", async () => {
  const store = await freshStore();
  const context = ctx("worktree:reshape");
  await store.append(context, { type: "presented", ts: 1 });
  await store.append(context, { type: "reshape-requested", ts: 2, body: "regroup by subsystem" });
  assert.equal(project(await store.load(context)).pendingReshape, "regroup by subsystem");
});

test("a reshape-requested line missing its body is rejected as corrupt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  const context = ctx("worktree:feature/x");
  await writeFile(fileFor(dir, context), `${JSON.stringify({ type: "reshape-requested", ts: 1 })}\n`, "utf8");
  await assert.rejects(new JsonlReviewStore(dir).load(context), /Corrupt event log line/);
});

test("the loaded log folds to current marks, carrying author", async () => {
  const store = await freshStore();
  const context = ctx("pr:42");
  await store.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done", author: human });
  await store.append(context, { type: "marked", ts: 2, atomHash: atom("b"), disposition: "skipped", author: agent });
  await store.append(context, { type: "unmarked", ts: 3, atomHash: atom("a"), author: human });

  const state = project(await store.load(context));
  assert.equal(state.marks.has(atom("a")), false); // marked then unmarked
  assert.equal(state.marks.get(atom("b"))?.disposition, "skipped");
  assert.deepEqual(state.marks.get(atom("b"))?.author, agent);
});

test("marks do not bleed between contexts", async () => {
  const store = await freshStore();
  const a = ctx("worktree:feature/a");
  const b = ctx("worktree:feature/b");
  await store.append(a, { type: "marked", ts: 1, atomHash: atom("x"), disposition: "done", author: human });

  assert.deepEqual(await store.load(b), []);
  assert.equal((await store.load(a)).length, 1);
});

test("persisted lines are newline-framed JSON, no atom payload stored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  const store = new JsonlReviewStore(dir);
  const context = ctx("worktree:feature/x");
  await store.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done", author: human });

  const raw = await readFile(fileFor(dir, context), "utf8");
  const lines = raw.split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), {
    type: "marked",
    ts: 1,
    atomHash: "a",
    disposition: "done",
    author: { tier: "human", reviewer: null },
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
  const line = JSON.stringify({ type: "marked", ts: 1, atomHash: "a", author: { tier: "human", reviewer: null } });
  await writeFile(fileFor(dir, context), `${line}\n`, "utf8");
  await assert.rejects(new JsonlReviewStore(dir).load(context), /Corrupt event log line/);
});

test("a legacy log (no author) is a hard error naming the file, not silent corruption", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  const context = ctx("worktree:feature/x");
  // The old format: a marked event with no `author` field.
  await writeFile(fileFor(dir, context), `${JSON.stringify({ type: "marked", ts: 1, atomHash: "a", disposition: "done" })}\n`, "utf8");
  await assert.rejects(
    new JsonlReviewStore(dir).load(context),
    /incompatible review log \(missing author tier\) — delete it and re-review/,
  );
});

test("a marked event with a malformed author is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-store-"));
  const context = ctx("worktree:feature/x");
  const line = JSON.stringify({ type: "marked", ts: 1, atomHash: "a", disposition: "done", author: { tier: "ghost", reviewer: null } });
  await writeFile(fileFor(dir, context), `${line}\n`, "utf8");
  await assert.rejects(new JsonlReviewStore(dir).load(context), /missing author tier/);
});
