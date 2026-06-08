import { test } from "bun:test";
import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "./run.ts";
import { makeTestRepo } from "./test-repo.ts";

// Regression for the GIT_* footgun (#41): a clone that inherits GIT_DIR/GIT_WORK_TREE
// (a git hook, an interrupted rebase, a leaked shell export) must still review the
// directory it runs in, not the pinned repo. runGit strips the location-pinning vars
// so cwd governs. Without the fix, --show-toplevel would resolve to the decoy.
test("runGit follows cwd even when GIT_DIR/GIT_WORK_TREE pin another repo", async () => {
  const repo = await makeTestRepo();
  const decoy = await makeTestRepo();
  const savedDir = process.env["GIT_DIR"];
  const savedTree = process.env["GIT_WORK_TREE"];
  try {
    process.env["GIT_DIR"] = join(decoy.dir, ".git");
    process.env["GIT_WORK_TREE"] = decoy.dir;

    const top = (await runGit(["rev-parse", "--show-toplevel"], repo.dir)).trim();
    assert.equal(await realpath(top), await realpath(repo.dir));
  } finally {
    if (savedDir === undefined) delete process.env["GIT_DIR"];
    else process.env["GIT_DIR"] = savedDir;
    if (savedTree === undefined) delete process.env["GIT_WORK_TREE"];
    else process.env["GIT_WORK_TREE"] = savedTree;
    await repo.cleanup();
    await decoy.cleanup();
  }
});
