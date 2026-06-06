// GitCli WorkspaceReader (ADR-0003): file content for a side of the diff, or
// null when the file does not exist that side. A revision side reads via
// `git show`; the worktree side reads from disk.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileSide, WorkspaceReader } from "@clear-diff/core";
import type { GitRef, SpecRefs } from "./refs.ts";
import { GitError, runGit } from "./run.ts";

export class GitWorkspaceReader implements WorkspaceReader {
  readonly #cwd: string;
  readonly #refs: SpecRefs;

  constructor(cwd: string, refs: SpecRefs) {
    this.#cwd = cwd;
    this.#refs = refs;
  }

  async readFile(path: string, side: FileSide): Promise<string | null> {
    return this.#read(this.#refs[side], path);
  }

  async #read(ref: GitRef, path: string): Promise<string | null> {
    if (ref.kind === "worktree") {
      try {
        return await readFile(join(this.#cwd, path), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    }
    try {
      return await runGit(["show", `${ref.rev}:${path}`], this.#cwd);
    } catch (err) {
      // git exits non-zero when the path is absent at that revision; a spawn
      // failure (git missing, not a repo) has no exit code and must surface.
      if (err instanceof GitError && err.code !== null) return null;
      throw err;
    }
  }
}
