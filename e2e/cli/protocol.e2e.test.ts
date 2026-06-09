// Protocol conformance — the self-narrating contract (ADR-0011). Every verb prints a
// JSON envelope (or, for `instructions`, plain text) with a stable top-level shape and a
// `next` hint that points at the next verb. These assertions pin the wire shape so a
// drift in the envelope or a missing hint fails loudly — agents depend on this contract
// with no out-of-band docs.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { makeEmptyFixture, makeReviewFixture } from "../support/fixture-repo.ts";
import { json, runBin } from "./support/run-bin.ts";

/** Sorted top-level keys of a JSON envelope — the structural fingerprint of a verb. */
function shape(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

test("atoms envelope: shape + a hint pointing at present", async () => {
  const fixture = await makeReviewFixture();
  try {
    const out = json(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    assert.deepEqual(shape(out), ["atoms", "context", "methodology", "methodologyVersion", "next", "openItems"]);
    assert.match(out["next"] as string, /clear-diff present/);
  } finally {
    await fixture.cleanup();
  }
});

test("atoms over an empty diff: no atoms, a 'no changes' hint", async () => {
  const fixture = await makeEmptyFixture();
  try {
    const out = json(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    assert.deepEqual(out["atoms"], []);
    assert.match(out["next"] as string, /No changes/);
  } finally {
    await fixture.cleanup();
  }
});

test("present --no-open envelope: headless shape + a hint pointing at submit", async () => {
  const fixture = await makeReviewFixture();
  try {
    const atoms = json<{ atoms: { hash: string }[] }>(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    const grouping = JSON.stringify({
      chapters: [{ title: "All", sections: [{ title: "All", atomHashes: atoms.atoms.map((a) => a.hash) }] }],
    });
    const out = json(await runBin(["present", "-", "--no-open", "--range", fixture.range], fixture.dir, { input: grouping }));
    assert.deepEqual(shape(out), ["context", "next", "opened", "progress"]);
    assert.equal(out["opened"], false);
    assert.deepEqual(shape(out["progress"] as Record<string, unknown>), ["addressed", "total", "unaddressed"]);
    assert.match(out["next"] as string, /submit/);
  } finally {
    await fixture.cleanup();
  }
});

test("submit envelope: gap report shape + clean vs unaccounted hints", async () => {
  const fixture = await makeReviewFixture();
  try {
    const atoms = json<{ atoms: { hash: string }[] }>(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    const hashes = atoms.atoms.map((a) => a.hash);

    const partial = json(await runBin(["submit", JSON.stringify({ marks: [{ atomHash: hashes[0], disposition: "done" }] }), "--range", fixture.range], fixture.dir));
    assert.deepEqual(shape(partial), ["context", "gap", "next", "progress"]);
    assert.deepEqual(shape(partial["gap"] as Record<string, unknown>), ["accounted", "missing", "total"]);
    assert.match(partial["next"] as string, /unaccounted/);

    const full = json(await runBin(["submit", JSON.stringify({ marks: hashes.map((h) => ({ atomHash: h, disposition: "done" })) }), "--range", fixture.range], fixture.dir));
    assert.match(full["next"] as string, /Review complete/);
  } finally {
    await fixture.cleanup();
  }
});

test("dispatch envelope: comments + progress shape + a hint pointing at submit/edit", async () => {
  const fixture = await makeReviewFixture();
  try {
    const atoms = json<{ atoms: { hash: string }[] }>(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    await runBin(["submit", JSON.stringify({ comments: [{ atomHash: atoms.atoms[0]!.hash, body: "Look here." }] }), "--range", fixture.range], fixture.dir);
    const out = json(await runBin(["dispatch", "--range", fixture.range], fixture.dir));
    assert.deepEqual(shape(out), ["comments", "context", "next", "progress"]);
    const comment = (out["comments"] as Record<string, unknown>[])[0]!;
    assert.deepEqual(shape(comment), ["answer", "atomHash", "body", "id", "lineRange", "path", "reviewer", "status", "tier"]);
    assert.match(out["next"] as string, /submit|edit/);
  } finally {
    await fixture.cleanup();
  }
});

test("instructions: plain-text methodology + the verb reference (not JSON)", async () => {
  const fixture = await makeReviewFixture();
  try {
    const run = await runBin(["instructions"], fixture.dir);
    assert.equal(run.code, 0, run.err);
    assert.doesNotMatch(run.out.trimStart()[0] ?? "", /[{[]/); // not a JSON document
    assert.match(run.out, /Chapters/); // the methodology
    for (const verb of ["clear-diff atoms", "clear-diff present", "clear-diff dispatch", "clear-diff submit"]) {
      assert.ok(run.out.includes(verb), `instructions reference ${verb}`);
    }
    assert.match(run.out, /--timeout|--idle-threshold/); // the wait knobs are self-documented
  } finally {
    await fixture.cleanup();
  }
});
