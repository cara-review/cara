import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMasterList, repairGrouping, type RawHunk } from "@clear-diff/core";
import { FakeAgent } from "./fake-agent.ts";

function hunk(path: string, text: string): RawHunk {
  return {
    status: "modified",
    path,
    previousPath: null,
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 1,
    lines: [{ kind: "added", text }],
  };
}

// a.ts appears twice (distinct payloads), interleaved with b.ts.
const atoms = buildMasterList([hunk("a.ts", "0"), hunk("b.ts", "1"), hunk("a.ts", "2")]);
const instructions = { personal: null, project: null };

test("FakeAgent is deterministic: same atoms produce a deep-equal proposal", async () => {
  const agent = new FakeAgent();
  const first = await agent.proposeGrouping({ atoms, instructions });
  const second = await agent.proposeGrouping({ atoms, instructions });
  assert.deepEqual(first, second);
});

test("core repairGrouping accepts FakeAgent output and the bijection holds", async () => {
  const proposal = await new FakeAgent().proposeGrouping({ atoms, instructions });
  const review = repairGrouping(atoms, proposal);
  const placed = review.chapters.flatMap((c) => c.sections.flatMap((s) => s.atoms));
  assert.equal(placed.length, atoms.length);
  assert.deepEqual(
    placed.map((a) => a.hash).sort(),
    [...atoms].map((a) => a.hash).sort(),
  );
  // The agent placed every atom — nothing sweeps to a trailing "Other changes".
  assert.ok(!review.chapters.some((c) => c.title === "Other changes"));
});

test("FakeAgent groups one section per file, in first-appearance order", async () => {
  const proposal = await new FakeAgent().proposeGrouping({ atoms, instructions });
  const review = repairGrouping(atoms, proposal);
  assert.equal(review.chapters.length, 1);
  assert.equal(review.chapters[0]!.title, "Changes");
  assert.deepEqual(
    review.chapters[0]!.sections.map((s) => s.title),
    ["a.ts", "b.ts"],
  );
  // a.ts section holds both a.ts atoms in git order.
  assert.deepEqual(
    review.chapters[0]!.sections[0]!.atoms.map((a) => a.lines[0]!.text),
    ["0", "2"],
  );
});
