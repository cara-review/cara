// MarkdownFile CommentSink adapter (ADR-0007): the first `Go` egress. Writes the
// accumulated comments out as a single markdown file carrying enough metadata —
// atom hash, path, line range, body — that a downstream agent can pick it up and
// action each comment. PR posting is a later GitHubPR adapter over the same port.
//
// Every adapter concern (markdown shape, output path, frontmatter, node:fs) lives
// here and never leaks into core (ADR-0003): the domain hands over a domain-neutral
// ReviewDispatch and gets back a DispatchReceipt whose `location` it treats as opaque.

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

  async dispatch(context: ReviewContext, dispatch: ReviewDispatch): Promise<DispatchReceipt> {
    await mkdir(this.#outDir, { recursive: true });
    // One file per Go, keyed by context hash so repeated dispatches of the same
    // review overwrite rather than accumulate — stable whatever the branch/range.
    const name = createHash("sha256").update(context).digest("hex");
    const path = join(this.#outDir, `${name}.md`);
    await writeFile(path, render(context, dispatch.comments), "utf8");
    return { count: dispatch.comments.length, location: path };
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
    `- **atom**: \`${comment.atomHash}\``,
    `- **lines**: ${describeRange(comment.lineRange)}`,
    "",
    comment.body,
    "",
  ].join("\n");
}

function describeRange(range: LineRange): string {
  if (range.count <= 0) return `after ${range.start}`;
  if (range.count === 1) return `${range.start}`;
  return `${range.start}–${range.start + range.count - 1}`;
}
