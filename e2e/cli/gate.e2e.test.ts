// CLI gate axis — the ledger IS the gate. Two labelled agent reviewers split the
// 5-atom fixture (security 2, quality 3); `clear-diff gate` then reads role coverage
// straight off the committed ledger and turns `--require` predicates into a pass/fail
// exit code. Proves: per-role coverage, a met bar exits 0, an unmet bar exits non-zero
// while still emitting the JSON report, and a bare readout never fails.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { makeReviewFixture } from "../support/fixture-repo.ts";
import { json, runBin } from "./support/run-bin.ts";

interface AtomsView {
  readonly atoms: readonly { readonly hash: string }[];
}
interface GateView {
  readonly pass: boolean;
  readonly coverage: Record<string, number>;
  readonly requirements: readonly { readonly role: string; readonly percent: number; readonly pass: boolean }[];
  readonly progress: { readonly total: number };
}

/** security dispositions the first two atoms, quality the rest — union = every atom. */
async function seedTwoReviewers(dir: string, range: string): Promise<void> {
  const hashes = json<AtomsView>(await runBin(["atoms", "--range", range], dir)).atoms.map((a) => a.hash);
  assert.equal(hashes.length, 5, "the review fixture is a 5-atom diff");
  const security = JSON.stringify({ marks: hashes.slice(0, 2).map((hash) => ({ atomHash: hash, disposition: "done" })) });
  const quality = JSON.stringify({ marks: hashes.slice(2).map((hash) => ({ atomHash: hash, disposition: "done" })) });
  await runBin(["submit", security, "--reviewer", "security", "--range", range], dir);
  await runBin(["submit", quality, "--reviewer", "quality", "--range", range], dir);
}

test("gate reads per-role coverage off the ledger and passes when every bar is met", async () => {
  const fixture = await makeReviewFixture();
  try {
    await seedTwoReviewers(fixture.dir, fixture.range);
    const run = await runBin(
      ["gate", "--require", "addressed=100%,security>=40%,quality>=60%,agent=100%", "--range", fixture.range],
      fixture.dir,
    );
    assert.equal(run.code, 0, "a met gate exits 0");
    const gate = json<GateView>(run);
    assert.equal(gate.pass, true);
    assert.equal(gate.coverage["security"], 40);
    assert.equal(gate.coverage["quality"], 60);
    assert.equal(gate.coverage["agent"], 100);
    assert.equal(gate.coverage["human"], 0);
    assert.ok(gate.requirements.every((r) => r.pass));
  } finally {
    await fixture.cleanup();
  }
});

test("gate exits non-zero on an unmet bar but still emits the JSON report", async () => {
  const fixture = await makeReviewFixture();
  try {
    await seedTwoReviewers(fixture.dir, fixture.range);
    // No human-tier mark exists (every CLI submit is the agent tier), so a human bar fails.
    const run = await runBin(["gate", "--require", "human=100%", "--range", fixture.range], fixture.dir);
    assert.equal(run.code, 1, "an unmet gate exits non-zero for CI");
    const gate = JSON.parse(run.out) as GateView;
    assert.equal(gate.pass, false);
    const human = gate.requirements.find((r) => r.role === "human");
    assert.deepEqual({ percent: human?.percent, pass: human?.pass }, { percent: 0, pass: false });
    assert.match(run.err, /gate not met/i);
  } finally {
    await fixture.cleanup();
  }
});

test("gate without --require is a coverage readout that never fails", async () => {
  const fixture = await makeReviewFixture();
  try {
    await seedTwoReviewers(fixture.dir, fixture.range);
    const gate = json<GateView>(await runBin(["gate", "--range", fixture.range], fixture.dir));
    assert.equal(gate.pass, true);
    assert.deepEqual(gate.requirements, []);
    assert.equal(gate.coverage["addressed"], 100);
    assert.equal(gate.progress.total, 5);
  } finally {
    await fixture.cleanup();
  }
});
