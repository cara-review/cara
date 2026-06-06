import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { DiffSpec } from "@clear-diff/core";
import { makeTestRepo } from "../git/test-repo.ts";
import { compose } from "./compose.ts";

test("composition root wires a working ReviewService and WorkspaceReader", async () => {
  const repo = await makeTestRepo();
  try {
    await repo.write("a.ts", "one\n");
    const base = await repo.commit("base");
    await repo.write("a.ts", "one\ntwo\n");
    const head = await repo.commit("add line");

    const spec: DiffSpec = { kind: "range", base, head };
    const backend = compose({
      cwd: repo.dir,
      spec,
      stateDir: join(repo.dir, ".state"),
      editorCommand: "true",
    });

    const snapshot = await backend.service.open(spec);
    assert.ok(snapshot.review.masterList.length >= 1);
    assert.equal(snapshot.progress.total, snapshot.review.masterList.length);

    const text = await backend.workspace.readFile("a.ts", "head");
    assert.equal(text, "one\ntwo\n");
  } finally {
    await repo.cleanup();
  }
});
