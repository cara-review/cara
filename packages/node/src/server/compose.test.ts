import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { DiffSpec } from "@clear-diff/core";
import { fixedClock } from "../clock.ts";
import { makeTestRepo } from "../git/test-repo.ts";
import { compose, composeCore } from "./compose.ts";

const config = { load: () => Promise.resolve({ editorCommand: "true" }) };

async function oneAtomRepo() {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  const base = await repo.commit("base");
  await repo.write("a.ts", "one\ntwo\n");
  const head = await repo.commit("add line");
  return { repo, spec: { kind: "range", base, head } as DiffSpec };
}

test("composeCore wires an LLM-free service over the git adapters", async () => {
  const { repo, spec } = await oneAtomRepo();
  try {
    const core = await composeCore({ cwd: repo.dir, spec, stateDir: join(repo.dir, ".state"), config });
    const atoms = await core.service.getAtoms(spec);
    assert.ok(atoms.atoms.length >= 1);
    assert.equal(atoms.methodologyVersion, 4);
    assert.equal(await core.workspace.readFile("a.ts", "head"), "one\ntwo\n");
    assert.equal(await core.diffSource.resolveContext(spec), atoms.context);
  } finally {
    await repo.cleanup();
  }
});

test("compose adds the activity tracker + clock the server router carries", async () => {
  const { repo, spec } = await oneAtomRepo();
  try {
    const backend = await compose({
      cwd: repo.dir,
      spec,
      stateDir: join(repo.dir, ".state"),
      config,
      clock: fixedClock(4242),
    });
    assert.equal(backend.clock.now(), 4242);
    assert.deepEqual(backend.activity.state(), { lastActivityTs: 4242, completed: false });
    assert.equal(backend.spec, spec);
  } finally {
    await repo.cleanup();
  }
});
