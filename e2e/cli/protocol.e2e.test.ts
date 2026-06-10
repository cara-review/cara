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
      chapters: [{ title: "All", summary: "every change", sections: [{ title: "All", summary: "all atoms", atomHashes: atoms.atoms.map((a) => a.hash) }] }],
    });
    const out = json(await runBin(["present", "-", "--no-open", "--range", fixture.range], fixture.dir, { input: grouping }));
    assert.deepEqual(shape(out), ["context", "next", "opened", "progress"]);
    assert.equal(out["opened"], false);
    assert.deepEqual(shape(out["progress"] as Record<string, unknown>), ["accounted", "addressed", "total", "unaddressed"]);
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
    assert.deepEqual(shape(out), ["comments", "context", "next", "progress", "reshape"]);
    const comment = (out["comments"] as Record<string, unknown>[])[0]!;
    assert.deepEqual(shape(comment), ["answer", "atomHash", "body", "id", "line", "lineRange", "path", "reviewer", "status", "tier"]);
    assert.match(out["next"] as string, /submit|edit/);
  } finally {
    await fixture.cleanup();
  }
});

test("present summary-rejection round trip: a summary-less grouping is rejected, then accepted once fixed", async () => {
  const fixture = await makeReviewFixture();
  try {
    const atoms = json<{ atoms: { hash: string }[] }>(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    const hashes = atoms.atoms.map((a) => a.hash);

    // A grouping with no chapter/section summaries → rejected as a usage envelope, no boot.
    const bare = JSON.stringify({ chapters: [{ title: "All", sections: [{ title: "All", atomHashes: hashes }] }] });
    const rejected = await runBin(["present", bare, "--no-open", "--range", fixture.range], fixture.dir);
    assert.equal(rejected.code, 0, "a summary gap is a usage envelope, not a crash — exit stays boring");
    const out = json(rejected);
    assert.deepEqual(shape(out), ["error", "missing", "next"]);
    assert.equal(out["error"], "summaries_required");
    assert.deepEqual(out["missing"], [
      { chapter: 0, section: null },
      { chapter: 0, section: 0 },
    ]);
    assert.match(out["next"] as string, /summary/);
    assert.match(out["next"] as string, /present/);

    // The agent adds the summaries and re-presents → accepted.
    const fixed = JSON.stringify({
      chapters: [{ title: "All", summary: "every change", sections: [{ title: "All", summary: "all atoms", atomHashes: hashes }] }],
    });
    const accepted = json(await runBin(["present", fixed, "--no-open", "--range", fixture.range], fixture.dir));
    assert.equal(accepted["opened"], false);
    assert.deepEqual(shape(accepted), ["context", "next", "opened", "progress"]);
  } finally {
    await fixture.cleanup();
  }
});

test("next hints state exact invocation shapes — payload form, stdin '-', and --range", async () => {
  const fixture = await makeReviewFixture();
  try {
    const atoms = json<{ atoms: { hash: string }[] }>(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    const hashes = atoms.atoms.map((a) => a.hash);

    // atoms → present hint: the grouping payload grammar is spelled out, never guessed.
    const atomsOut = json(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    for (const re of [/'<[^']+>'/, /- for stdin/, /--range/]) assert.match(atomsOut["next"] as string, re);

    // present --no-open → submit hint: same grammar.
    const grouping = JSON.stringify({
      chapters: [{ title: "All", summary: "every change", sections: [{ title: "All", summary: "all atoms", atomHashes: hashes }] }],
    });
    const presentOut = json(await runBin(["present", grouping, "--no-open", "--range", fixture.range], fixture.dir));
    for (const re of [/'<[^']+>'/, /- for stdin/, /--range/]) assert.match(presentOut["next"] as string, re);

    // submit gap hint: same grammar.
    const submitOut = json(await runBin(["submit", "{}", "--range", fixture.range], fixture.dir));
    for (const re of [/'<[^']+>'/, /- for stdin/, /--range/]) assert.match(submitOut["next"] as string, re);
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
    // The payload grammar is spelled out so a cold agent never guesses the arg shape (ADR-0012 §h).
    assert.match(run.out, /Passing payloads/);
    assert.match(run.out, /stdin/);
    assert.match(run.out, /--range <base>\.\.<head>/);
  } finally {
    await fixture.cleanup();
  }
});
