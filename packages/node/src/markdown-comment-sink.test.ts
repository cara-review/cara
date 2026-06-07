import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("dispatch writes a markdown file and returns its path as the receipt location", async () => {
  const { sink, dir } = await freshSink();
  const receipt = await sink.dispatch(ctx("feature/x"), dispatch);

  const expected = join(dir, `${createHash("sha256").update("feature/x").digest("hex")}.md`);
  assert.equal(receipt.location, expected);
  assert.equal(receipt.count, 2);
});

test("the file carries atom hash, path, line range, and body per comment", async () => {
  const { sink } = await freshSink();
  const { location } = await sink.dispatch(ctx("feature/x"), dispatch);
  const text = await readFile(location, "utf8");

  assert.match(text, /## src\/a\.ts/);
  assert.match(text, /\*\*atom\*\*: `h1`/);
  assert.match(text, /\*\*lines\*\*: 12–14/);
  assert.match(text, /use the retry util/);
  // a single-line range renders as the bare number, not a span
  assert.match(text, /\*\*lines\*\*: 5\n/);
});

test("a repeated dispatch of the same context overwrites rather than appends", async () => {
  const { sink } = await freshSink();
  await sink.dispatch(ctx("feature/x"), dispatch);
  const { location, count } = await sink.dispatch(ctx("feature/x"), {
    comments: [{ atomHash: atom("h3"), path: "c.ts", lineRange: { start: 1, count: 0 }, body: "only one now" }],
  });
  const text = await readFile(location, "utf8");

  assert.equal(count, 1);
  assert.match(text, /only one now/);
  assert.doesNotMatch(text, /use the retry util/);
  // a deletion (count 0) anchors after its line
  assert.match(text, /\*\*lines\*\*: after 1/);
});
