// A worktree-review fixture: a committed base wired up as `origin/main` (the trunk a
// worktree is reviewed against), plus a mutable working tree. The review context is the
// branch name (`main`) — stable across working-tree edits — so marks keyed by atom
// content hash can be observed surviving (or resurfacing) as the tree changes. This is
// the substrate for the content-hash invariant: an edit to reviewed lines changes that
// atom's hash and resurfaces it, while untouched atoms keep their marks.

import { makeTestRepo, type TestRepo } from "../../../packages/node/src/git/test-repo.ts";

export interface WorktreeFixture {
  readonly dir: string;
  readonly repo: TestRepo;
  /** Overwrite a file in the working tree (uncommitted) — reshapes the worktree diff. */
  write(path: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** Commit `files` as the base, point origin/main at it, and hand back the live worktree. */
export async function makeWorktreeFixture(files: Record<string, string>): Promise<WorktreeFixture> {
  const repo = await makeTestRepo();
  for (const [path, content] of Object.entries(files)) await repo.write(path, content);
  const base = await repo.commit("base");
  await repo.git("update-ref", "refs/remotes/origin/main", base);
  return { dir: repo.dir, repo, write: (path, content) => repo.write(path, content), cleanup: () => repo.cleanup() };
}
