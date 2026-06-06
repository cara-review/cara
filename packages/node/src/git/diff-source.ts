// GitCli DiffSource (ADR-0003): run `git diff -U0 --histogram -M` and parse to
// RawHunks. Parsing only — the domain maps RawHunk -> Atom and owns identity.

import type { DiffSource, DiffSpec, RawHunk, ReviewContext } from "@clear-diff/core";
import { reviewContext } from "@clear-diff/core";
import { parseDiff } from "./parse-diff.ts";
import { refsForSpec } from "./refs.ts";
import { runGit } from "./run.ts";

const DIFF_FLAGS = ["diff", "-U0", "--histogram", "-M"] as const;

/**
 * git args for a spec, derived from the shared ref mapping so DiffSource and
 * WorkspaceReader agree on the trunk. A worktree head means no head arg:
 * `git diff <base>` diffs the live tree against base.
 */
function diffArgs(spec: DiffSpec): string[] {
  const { base, head } = refsForSpec(spec); // throws for pr
  if (base.kind !== "rev") throw new Error("diff base must be a revision");
  return head.kind === "worktree"
    ? [...DIFF_FLAGS, base.rev]
    : [...DIFF_FLAGS, base.rev, head.rev];
}

export class GitDiffSource implements DiffSource {
  readonly #cwd: string;

  constructor(cwd: string) {
    this.#cwd = cwd;
  }

  async diff(spec: DiffSpec): Promise<readonly RawHunk[]> {
    return parseDiff(await runGit(diffArgs(spec), this.#cwd));
  }

  /** The stable per-review key. git owns the worktree's branch name (or short SHA when detached). */
  async resolveContext(spec: DiffSpec): Promise<ReviewContext> {
    switch (spec.kind) {
      case "worktree":
        return reviewContext(await this.#worktreeRef());
      case "range":
        return reviewContext(`${spec.base}..${spec.head}`);
      case "pr":
        return reviewContext(`pr/${spec.number}`);
    }
  }

  async #worktreeRef(): Promise<string> {
    const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], this.#cwd)).trim();
    // Detached HEAD reports the literal "HEAD"; fall back to the short commit SHA.
    return branch === "HEAD"
      ? (await runGit(["rev-parse", "--short", "HEAD"], this.#cwd)).trim()
      : branch;
  }
}
