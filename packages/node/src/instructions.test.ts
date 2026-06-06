import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileInstructions } from "./instructions.ts";

test("FileInstructions reads personal and project files when present", async () => {
  const home = await mkdtemp(join(tmpdir(), "cd-home-"));
  const repo = await mkdtemp(join(tmpdir(), "cd-repo-"));
  try {
    await writeFile(join(home, ".clear-diff.md"), "personal");
    await writeFile(join(repo, "clear-diff.md"), "project");
    const instructions = await new FileInstructions(home, repo).load();
    assert.deepEqual(instructions, { personal: "personal", project: "project" });
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});

test("FileInstructions yields null for absent files", async () => {
  const empty = await mkdtemp(join(tmpdir(), "cd-empty-"));
  try {
    const instructions = await new FileInstructions(empty, empty).load();
    assert.deepEqual(instructions, { personal: null, project: null });
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});
