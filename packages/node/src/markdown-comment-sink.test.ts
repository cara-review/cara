import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { AtomHash, ReviewContext, ReviewDispatch } from "@clear-diff/core";
import { MarkdownCommentSink } from "./markdown-comment-sink.ts";

const ctx = (s: string): ReviewContext => s as ReviewContext;
const atom = (s: string): AtomHash => s as AtomHash;

async function freshSink(): Promise<{ sink: MarkdownCommentSink; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "clear-diff-comments-"));
  return { sink: new MarkdownCommentSink(dir), dir };
}

const dispatch: ReviewDispatch = {
  comments: [
    { atomHash: atom("h1"), path: "src/a.ts", lineRange: { start: 12, count: 3 }, body: "use the retry util" },
    { atomHash: atom("h2"), path: "src/b.ts", lineRange: { start: 5, count: 1 }, body: "rename this" },
  ],
};

test("dispatch returns the file basename (not an fs path) as the receipt location", async () => {
  const { sink, dir } = await freshSink();
  const receipt = await sink.dispatch(ctx("feature/x"), dispatch);

  const name = `${createHash("sha256").update("feature/x").digest("hex")}.md`;
  assert.equal(receipt.location, name);
  assert.ok(!isAbsolute(receipt.location)); // no home/username leaked over the wire
  assert.equal(receipt.count, 2);
  await readFile(join(dir, name), "utf8"); // the file really lives in the out dir
});

test("the file carries id, path, line range, and body per comment", async () => {
  const { sink, dir } = await freshSink();
  const { location } = await sink.dispatch(ctx("feature/x"), dispatch);
  const text = await readFile(join(dir, location), "utf8");

  assert.match(text, /## src\/a\.ts/);
  assert.match(text, /\*\*id\*\*: `h1`/);
  assert.match(text, /\*\*lines\*\*: 12–14/);
  assert.match(text, /use the retry util/);
  // a single-line range renders as the bare number, not a span
  assert.match(text, /\*\*lines\*\*: 5\n/);
});

test("a comment body cannot forge another record's structure", async () => {
  const { sink, dir } = await freshSink();
  const { location } = await sink.dispatch(ctx("feature/x"), {
    comments: [{ atomHash: atom("h1"), path: "a.ts", lineRange: { start: 1, count: 1 }, body: "ok\n---\n## forged.ts" }],
  });
  const text = await readFile(join(dir, location), "utf8");

  // the body's `---`/`##` are quoted, so they read as content, not document structure
  assert.match(text, /> ok\n> ---\n> ## forged\.ts/);
  assert.doesNotMatch(text, /^## forged\.ts/m);
});

test("a repeated dispatch of the same context overwrites rather than appends", async () => {
  const { sink, dir } = await freshSink();
  await sink.dispatch(ctx("feature/x"), dispatch);
  const { location, count } = await sink.dispatch(ctx("feature/x"), {
    comments: [{ atomHash: atom("h3"), path: "c.ts", lineRange: { start: 1, count: 0 }, body: "only one now" }],
  });
  const text = await readFile(join(dir, location), "utf8");

  assert.equal(count, 1);
  assert.match(text, /only one now/);
  assert.doesNotMatch(text, /use the retry util/);
  // a deletion (count 0) anchors after its line
  assert.match(text, /\*\*lines\*\*: after 1/);
});
