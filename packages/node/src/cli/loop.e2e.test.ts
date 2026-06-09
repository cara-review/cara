// End-to-end of the headless agent loop against the real spawned bin (a scripted fake
// agent): atoms → present --no-open → submit → dispatch, asserting the gap converges and
// every invocation exits 0 with a JSON envelope. Exercises index.js, stdin piping, and
// the full LLM-free composition under `bun`, not just the in-process verb functions.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { makeTestRepo } from "../git/test-repo.ts";

const BIN = resolve(import.meta.dir, "../../../../index.js");

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function runBin(args: string[], cwd: string, input?: string): Promise<Run> {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    cwd,
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

test("the headless loop converges over the spawned bin", async () => {
  const repo = await makeTestRepo();
  try {
    await repo.write("a.ts", "one\n");
    const base = await repo.commit("base");
    await repo.write("a.ts", "one\ntwo\nthree\n");
    const head = await repo.commit("edit");
    const range = `${base}..${head}`;

    // 1. atoms → the change set + methodology.
    const atoms = await runBin(["atoms", "--range", range], repo.dir);
    assert.equal(atoms.code, 0, atoms.err);
    const atomsView = JSON.parse(atoms.out) as { atoms: { hash: string }[]; next: string };
    assert.ok(atomsView.atoms.length >= 1);
    assert.match(atomsView.next, /present/);
    const hashes = atomsView.atoms.map((a) => a.hash);

    // 2. present --no-open via stdin → headless, grouping persisted.
    const grouping = JSON.stringify({
      chapters: [{ title: "Edit", sections: [{ title: "a.ts", atomHashes: hashes }] }],
    });
    const present = await runBin(["present", "-", "--no-open", "--range", range], repo.dir, grouping);
    assert.equal(present.code, 0, present.err);
    assert.equal((JSON.parse(present.out) as { opened: boolean }).opened, false);

    // 3. submit a disposition for every atom → gap closes.
    const batch = JSON.stringify({ marks: hashes.map((hash) => ({ atomHash: hash, disposition: "done" })) });
    const submit = await runBin(["submit", batch, "--range", range], repo.dir);
    assert.equal(submit.code, 0, submit.err);
    const result = JSON.parse(submit.out) as { gap: { total: number; accounted: number }; next: string };
    assert.equal(result.gap.accounted, result.gap.total);
    assert.match(result.next, /Review complete/);

    // 4. dispatch (no live server) → no open comments to chase.
    const dispatch = await runBin(["dispatch", "--range", range], repo.dir);
    assert.equal(dispatch.code, 0, dispatch.err);
    assert.deepEqual((JSON.parse(dispatch.out) as { comments: unknown[] }).comments, []);

    // instructions is plain text and exits 0.
    const instructions = await runBin(["instructions"], repo.dir);
    assert.equal(instructions.code, 0, instructions.err);
    assert.match(instructions.out, /clear-diff atoms/);
  } finally {
    await repo.cleanup();
  }
}, 30_000);

test("an invocation error exits non-zero with a clean message", async () => {
  const repo = await makeTestRepo();
  try {
    const bad = await runBin(["dispatch", "--bogus"], repo.dir);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /Unknown option/);
  } finally {
    await repo.cleanup();
  }
}, 15_000);
