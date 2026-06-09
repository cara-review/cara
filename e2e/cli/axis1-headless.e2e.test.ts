// AXIS 1 — headless deterministic agentic review. A scripted "fake agent" drives the
// raw plumbing verbs (no porcelain, no LLM, no network): atoms → submit under two
// reviewer labels → dispatch. Asserts completeness (every atom accounted), per-label
// attribution, comment persistence, determinism across reruns, and the content-hash
// invariant (an edit to reviewed lines resurfaces only the changed atom).

import { test } from "bun:test";
import assert from "node:assert/strict";
import { makeReviewFixture } from "../support/fixture-repo.ts";
import { makeWorktreeFixture } from "./support/worktree-fixture.ts";
import { json, runBin } from "./support/run-bin.ts";

interface AtomsView {
  readonly atoms: readonly { readonly hash: string; readonly path: string }[];
}
interface DispatchView {
  readonly comments: readonly { readonly atomHash: string; readonly tier: string; readonly reviewer: string | null; readonly body: string }[];
  readonly progress: { readonly total: number; readonly addressed: number; readonly byReviewer?: readonly { reviewer: string; addressed: number }[] };
}
interface SubmitResult {
  readonly gap: { readonly total: number; readonly accounted: number; readonly missing: readonly { readonly path: string }[] };
}

/** Drive the scripted two-reviewer agent over a range; return the final dispatch + gap. */
async function runTwoReviewerAgent(dir: string, range: string): Promise<{ dispatch: DispatchView; gap: SubmitResult["gap"] }> {
  const atoms = json<AtomsView>(await runBin(["atoms", "--range", range], dir)).atoms;
  assert.equal(atoms.length, 5, "the review fixture is a 5-atom diff");
  const hashes = atoms.map((a) => a.hash);

  // security owns the first two atoms; quality owns the rest. Union = every atom.
  const securityBatch = JSON.stringify({
    marks: hashes.slice(0, 2).map((hash) => ({ atomHash: hash, disposition: "done" })),
    comments: [{ atomHash: hashes[0], body: "Validate this input before use." }],
  });
  const qualityBatch = JSON.stringify({
    marks: hashes.slice(2).map((hash) => ({ atomHash: hash, disposition: "done" })),
    comments: [{ atomHash: hashes[2], body: "Name this more precisely." }],
  });
  await runBin(["submit", securityBatch, "--reviewer", "security", "--range", range], dir);
  await runBin(["submit", qualityBatch, "--reviewer", "quality", "--range", range], dir);

  const gap = json<SubmitResult>(await runBin(["submit", "{}", "--range", range], dir)).gap;
  const dispatch = json<DispatchView>(await runBin(["dispatch", "--range", range], dir));
  return { dispatch, gap };
}

test("two labelled reviewers account for every atom, with per-label attribution", async () => {
  const fixture = await makeReviewFixture();
  try {
    const { dispatch, gap } = await runTwoReviewerAgent(fixture.dir, fixture.range);

    // Completeness: the gap report is empty — every atom is marked or commented.
    assert.equal(gap.total, 5);
    assert.equal(gap.accounted, 5);
    assert.deepEqual(gap.missing, []);

    // Per-label attribution: each comment carries the agent tier + its reviewer label.
    const byReviewer = new Map(dispatch.comments.map((c) => [c.reviewer, c]));
    assert.equal(byReviewer.get("security")?.tier, "agent");
    assert.equal(byReviewer.get("quality")?.tier, "agent");
    assert.equal(dispatch.comments.length, 2);
    assert.ok(dispatch.comments.every((c) => c.tier === "agent"), "no CLI submission is ever human tier");

    // The cross-cutting mark breakdown attributes coverage to each lens.
    const marks = new Map((dispatch.progress.byReviewer ?? []).map((r) => [r.reviewer, r.addressed]));
    assert.equal(marks.get("security"), 2);
    assert.equal(marks.get("quality"), 3);
  } finally {
    await fixture.cleanup();
  }
});

test("the headless review is deterministic across independent reruns", async () => {
  const a = await makeReviewFixture();
  const b = await makeReviewFixture();
  try {
    const first = await runTwoReviewerAgent(a.dir, a.range);
    const second = await runTwoReviewerAgent(b.dir, b.range);
    // Identical fixtures (pinned content + dates) → identical atom hashes, gap, and
    // comment set. Comments carry no timestamp, so the dispatch view is byte-stable.
    assert.deepEqual(second.gap, first.gap);
    assert.deepEqual(second.dispatch.comments, first.dispatch.comments);
    assert.equal(a.range, b.range, "the fixture's range is reproducible");
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test("comments persist across separate dispatch invocations", async () => {
  const fixture = await makeReviewFixture();
  try {
    await runTwoReviewerAgent(fixture.dir, fixture.range);
    const first = json<DispatchView>(await runBin(["dispatch", "--range", fixture.range], fixture.dir));
    const second = json<DispatchView>(await runBin(["dispatch", "--range", fixture.range], fixture.dir));
    assert.deepEqual(second.comments, first.comments);
    assert.equal(first.comments.length, 2);
  } finally {
    await fixture.cleanup();
  }
});

test("content-hash invariant: editing reviewed lines resurfaces only the changed atom", async () => {
  const fixture = await makeWorktreeFixture({ "a.ts": "const a = 1;\n", "b.ts": "const b = 1;\n" });
  try {
    // Two independent worktree edits → one atom per file.
    await fixture.write("a.ts", "const a = 1;\nconst a2 = 2;\n");
    await fixture.write("b.ts", "const b = 1;\nconst b2 = 2;\n");

    const atoms = json<AtomsView>(await runBin(["atoms"], fixture.dir)).atoms;
    assert.equal(atoms.length, 2);
    // Worktree default spec (no --range): mark both atoms done.
    const marks = atoms.map((a) => ({ atomHash: a.hash, disposition: "done" }));
    await runBin(["submit", JSON.stringify({ marks })], fixture.dir);
    const clean = json<SubmitResult>(await runBin(["submit", "{}"], fixture.dir)).gap;
    assert.deepEqual(clean.missing, [], "both worktree atoms are accounted after marking");

    // Edit a.ts again → its atom's content hash changes; b.ts is untouched.
    await fixture.write("a.ts", "const a = 1;\nconst a2 = 2;\nconst a3 = 3;\n");
    const after = json<SubmitResult>(await runBin(["submit", "{}"], fixture.dir)).gap;

    // Exactly the changed atom resurfaces as unaccounted; the untouched atom keeps its mark.
    assert.equal(after.accounted, 1, "the untouched atom is still accounted");
    assert.equal(after.missing.length, 1, "only the edited atom resurfaces");
    assert.equal(after.missing[0]?.path, "a.ts");
  } finally {
    await fixture.cleanup();
  }
});
