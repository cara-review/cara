import { test } from "bun:test";
import assert from "node:assert/strict";
import type { DiffSpec } from "@cara/core";
import { GitDiffSource } from "./diff-source.ts";
import { makeTestRepo, type TestRepo } from "./test-repo.ts";

async function withRepo(fn: (repo: TestRepo) => Promise<void>): Promise<void> {
  const repo = await makeTestRepo();
  try {
    await fn(repo);
  } finally {
    await repo.cleanup();
  }
}

test("range diff: modify, add, delete, and rename in one diff", async () => {
  await withRepo(async (repo) => {
    await repo.write("keep.txt", "a\nb\nc\n");
    await repo.write("gone.txt", "x\ny\n");
    await repo.write("old.txt", "one\ntwo\nthree\nfour\n");
    const base = await repo.commit("v1");

    await repo.write("keep.txt", "a\nB\nc\n"); // modify line 2
    await repo.remove("gone.txt"); // delete
    await repo.write("new.txt", "fresh\n"); // add
    await repo.remove("old.txt");
    await repo.write("renamed.txt", "one\ntwo\nTHREE\nfour\n"); // rename + change
    const head = await repo.commit("v2");

    const hunks = await new GitDiffSource(repo.dir).diff({
      kind: "range",
      base,
      head,
    } satisfies DiffSpec);

    const byStatus = (s: string) => hunks.filter((h) => h.status === s);
    assert.equal(byStatus("added").length, 1, "one added");
    assert.equal(byStatus("deleted").length, 1, "one deleted");
    assert.equal(byStatus("modified").length, 1, "one modified");
    assert.equal(byStatus("renamed").length, 1, "one renamed");

    const renamed = byStatus("renamed")[0];
    assert.equal(renamed?.path, "renamed.txt");
    assert.equal(renamed?.previousPath, "old.txt");
    assert.deepEqual(renamed?.lines, [
      { kind: "removed", text: "three" },
      { kind: "added", text: "THREE" },
    ]);

    const added = byStatus("added")[0];
    assert.equal(added?.path, "new.txt");
    assert.deepEqual(added?.lines, [{ kind: "added", text: "fresh" }]);
  });
});

test("range diff: a multi-hunk file yields one RawHunk per hunk", async () => {
  await withRepo(async (repo) => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    await repo.write("multi.txt", lines);
    const base = await repo.commit("v1");

    const edited = lines.replace("line 2", "LINE 2").replace("line 18", "LINE 18");
    await repo.write("multi.txt", edited);
    const head = await repo.commit("v2");

    const hunks = await new GitDiffSource(repo.dir).diff({ kind: "range", base, head });
    assert.equal(hunks.length, 2);
    assert.ok(hunks.every((h) => h.path === "multi.txt"));
    assert.deepEqual(hunks[0]?.lines, [
      { kind: "removed", text: "line 2" },
      { kind: "added", text: "LINE 2" },
    ]);
    assert.deepEqual(hunks[1]?.lines, [
      { kind: "removed", text: "line 18" },
      { kind: "added", text: "LINE 18" },
    ]);
  });
});

test("range diff: paths with spaces and non-ASCII survive verbatim", async () => {
  // git C-quotes non-ASCII names (`"caf\303\251.ts"`) unless core.quotePath=false,
  // and tab-delimits names with spaces in the ---/+++ lines. Both must resolve to
  // the real on-disk path so marks, readFile, and openInEditor address it.
  await withRepo(async (repo) => {
    await repo.write("src/with space.ts", "a\n");
    await repo.write("src/café.ts", "b\n");
    const base = await repo.commit("v1");

    await repo.write("src/with space.ts", "A\n");
    await repo.write("src/café.ts", "B\n");
    const head = await repo.commit("v2");

    const hunks = await new GitDiffSource(repo.dir).diff({ kind: "range", base, head });
    assert.deepEqual(
      new Set(hunks.map((h) => h.path)),
      new Set(["src/with space.ts", "src/café.ts"]),
    );
  });
});

test("worktree diff: live tree vs simulated origin/main", async () => {
  await withRepo(async (repo) => {
    await repo.write("f.txt", "a\nb\n");
    const sha = await repo.commit("v1");
    // Simulate the trunk without a network remote.
    await repo.git("update-ref", "refs/remotes/origin/main", sha);

    await repo.write("f.txt", "a\nB\n"); // uncommitted worktree edit
    await repo.write("untracked.txt", "new\n"); // never git-added

    const hunks = await new GitDiffSource(repo.dir).diff({ kind: "worktree" });
    // Uncommitted edits to tracked files are in; untracked adds are not (TN-26-004 non-goal).
    assert.equal(hunks.length, 1);
    assert.equal(hunks[0]?.status, "modified");
    assert.equal(hunks[0]?.path, "f.txt");
    assert.deepEqual(hunks[0]?.lines, [
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
    ]);
  });
});

test("resolveContext: worktree -> current branch name", async () => {
  await withRepo(async (repo) => {
    await repo.write("f.txt", "x\n");
    await repo.commit("v1"); // repo is created on branch `main`
    assert.equal(await new GitDiffSource(repo.dir).resolveContext({ kind: "worktree" }), "main");
  });
});

test("resolveContext: detached HEAD -> short SHA", async () => {
  await withRepo(async (repo) => {
    await repo.write("f.txt", "x\n");
    const sha = await repo.commit("v1");
    await repo.git("checkout", sha); // detach HEAD
    const short = (await repo.git("rev-parse", "--short", "HEAD")).trim();
    assert.equal(await new GitDiffSource(repo.dir).resolveContext({ kind: "worktree" }), short);
  });
});

test("resolveContext: range -> base..head, pr -> pr/N", async () => {
  await withRepo(async (repo) => {
    const source = new GitDiffSource(repo.dir);
    assert.equal(
      await source.resolveContext({ kind: "range", base: "abc123", head: "def456" }),
      "abc123..def456",
    );
    assert.equal(await source.resolveContext({ kind: "pr", number: 42 }), "pr/42");
  });
});

test("pr spec is not yet supported", async () => {
  await withRepo(async (repo) => {
    await assert.rejects(
      () => new GitDiffSource(repo.dir).diff({ kind: "pr", number: 1 }),
      /not yet supported/,
    );
  });
});
