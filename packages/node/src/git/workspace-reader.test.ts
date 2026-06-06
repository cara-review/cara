import { test } from "node:test";
import assert from "node:assert/strict";
import { GitWorkspaceReader } from "./workspace-reader.ts";
import { refsForSpec } from "./refs.ts";
import { makeTestRepo, type TestRepo } from "./test-repo.ts";

async function withRepo(fn: (repo: TestRepo) => Promise<void>): Promise<void> {
  const repo = await makeTestRepo();
  try {
    await fn(repo);
  } finally {
    await repo.cleanup();
  }
}

test("range refs: reads each side via git show, null when absent that side", async () => {
  await withRepo(async (repo) => {
    await repo.write("kept.txt", "base content\n");
    await repo.write("deleted-later.txt", "doomed\n");
    const base = await repo.commit("v1");

    await repo.write("kept.txt", "head content\n");
    await repo.remove("deleted-later.txt");
    await repo.write("added-later.txt", "new\n");
    const head = await repo.commit("v2");

    const reader = new GitWorkspaceReader(repo.dir, refsForSpec({ kind: "range", base, head }));

    assert.equal(await reader.readFile("kept.txt", "base"), "base content\n");
    assert.equal(await reader.readFile("kept.txt", "head"), "head content\n");

    assert.equal(await reader.readFile("deleted-later.txt", "base"), "doomed\n");
    assert.equal(await reader.readFile("deleted-later.txt", "head"), null);

    assert.equal(await reader.readFile("added-later.txt", "base"), null);
    assert.equal(await reader.readFile("added-later.txt", "head"), "new\n");
  });
});

test("worktree refs: head reads from disk, base from origin/main", async () => {
  await withRepo(async (repo) => {
    await repo.write("f.txt", "committed\n");
    const sha = await repo.commit("v1");
    await repo.git("update-ref", "refs/remotes/origin/main", sha);

    await repo.write("f.txt", "working tree\n"); // uncommitted
    await repo.write("untracked.txt", "only on disk\n");

    const reader = new GitWorkspaceReader(repo.dir, refsForSpec({ kind: "worktree" }));

    assert.equal(await reader.readFile("f.txt", "base"), "committed\n");
    assert.equal(await reader.readFile("f.txt", "head"), "working tree\n");

    // Present on disk (head) but never committed to the trunk (base).
    assert.equal(await reader.readFile("untracked.txt", "head"), "only on disk\n");
    assert.equal(await reader.readFile("untracked.txt", "base"), null);
  });
});
