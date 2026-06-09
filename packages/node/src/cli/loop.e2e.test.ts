// End-to-end of the headless agent loop against the real spawned bin (a scripted fake
// agent): atoms → present --no-open → submit → dispatch, asserting the gap converges and
// every invocation exits 0 with a JSON envelope. Exercises index.js, stdin piping, and
// the full LLM-free composition under `bun`, not just the in-process verb functions.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makeTestRepo } from "../git/test-repo.ts";

const BIN = resolve(import.meta.dir, "../../../../index.js");

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function runBin(args: string[], cwd: string, input?: string, env?: Record<string, string | undefined>): Promise<Run> {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    cwd,
    ...(env ? { env } : {}),
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

test("the headless multi-reviewer porcelain converges over the spawned bin with the stub LLM", async () => {
  const repo = await makeTestRepo();
  const home = await mkdtemp(join(tmpdir(), "clear-diff-e2e-home-"));
  try {
    await mkdir(join(home, ".clear-diff"), { recursive: true });
    await writeFile(
      join(home, ".clear-diff", "config.toml"),
      `[grouping]\nmode = "llm"\n[llm]\nprovider="anthropic"\nmodel="m"\napi_key_env="ANTHROPIC_API_KEY"\n`,
    );
    await repo.write("a.ts", "one\n");
    const baseSha = await repo.commit("base");
    await repo.write("a.ts", "one\ntwo\n");
    const head = await repo.commit("edit");
    const range = `${baseSha}..${head}`;

    // --fake drives the stub LLM (no network, no key needed); HOME points at the temp config.
    const review = await runBin(["review", "--headless", "--reviewer", "security", "--fake", "--range", range], repo.dir, undefined, {
      ...process.env,
      HOME: home,
    });
    assert.equal(review.code, 0, review.err);
    const out = JSON.parse(review.out) as {
      gap: { total: number; missing: unknown[] };
      reviewers: { reviewer: string; comments: unknown[] }[];
    };
    assert.equal(out.gap.missing.length, 0);
    assert.deepEqual(
      out.reviewers.map((r) => r.reviewer),
      ["security"],
    );
    assert.ok(out.reviewers[0]!.comments.length >= 1);
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
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
