// MarkdownFile CommentSink adapter (ADR-0007): the first `Go` egress. Writes the
// accumulated comments out as a single markdown file carrying enough metadata —
// atom hash, path, line range, body — that a downstream agent can pick it up and
// action each comment. PR posting is a later GitHubPR adapter over the same port.
//
// Every adapter concern (markdown shape, output path, frontmatter, node:fs) lives
// here and never leaks into core (ADR-0003): the domain hands over a domain-neutral
// ReviewDispatch and gets back a DispatchReceipt whose `location` it treats as opaque.
//
// The receipt's `location` is the written file's basename, never an absolute path —
// the receipt crosses the WS boundary to a possibly-remote page, and leaking the
// user's home/username would breach the no-fs-paths-on-the-wire rule (dispatch.ts).

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  CommentRecord,
  CommentSink,
  DispatchReceipt,
  LineRange,
  ReviewContext,
  ReviewDispatch,
} from "@clear-diff/core";

export class MarkdownCommentSink implements CommentSink {
  readonly #outDir: string;

  /** `outDir` is per-clone runtime state (gitignored), supplied by the composition root. */
  constructor(outDir: string) {
    this.#outDir = outDir;
  }

  async dispatch(context: ReviewContext, payload: ReviewDispatch): Promise<DispatchReceipt> {
    await mkdir(this.#outDir, { recursive: true });
    // One file per Go, keyed by context hash so repeated dispatches of the same
    // review overwrite rather than accumulate — stable whatever the branch/range.
    const name = `${createHash("sha256").update(context).digest("hex")}.md`;
    await writeFile(join(this.#outDir, name), render(context, payload.comments), "utf8");
    return { count: payload.comments.length, location: name };
  }
}

function render(context: ReviewContext, comments: readonly CommentRecord[]): string {
  const header = `# clear-diff review comments\n\n${comments.length} comment(s) for review \`${context}\`.\n`;
  return [header, ...comments.map(renderComment)].join("\n");
}

function renderComment(comment: CommentRecord): string {
  return [
    "---",
    "",
    `## ${comment.path}`,
    "",
    `- **id**: \`${comment.atomHash}\``,
    `- **lines**: ${describeRange(comment.lineRange)}`,
    "",
    // Quote the body so a body containing `---`/`##`/`- **…**` can't forge another
    // record's structure in the file a downstream actor parses (output neutralisation).
    quote(comment.body),
    "",
  ].join("\n");
}

function quote(body: string): string {
  return body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function describeRange(range: LineRange): string {
  if (range.count <= 0) return `after ${range.start}`;
  if (range.count === 1) return `${range.start}`;
  return `${range.start}–${range.start + range.count - 1}`;
}
