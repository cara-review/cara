// CARA ledger persistence (TN-26-034, #52). The composition root now persists every
// review fact to a committed orphan ref `refs/cara/ledger` instead of gitignored JSONL,
// so a mark made through the service (the browser channel, human tier) becomes a durable
// git fact that survives the process. These prove the vertical slice end-to-end:
//
//  1. a browser-channel mark + comment land as facts under `refs/cara/ledger`, attributed
//     to the human tier, with the working tree left untouched;
//  2. a FRESH composition over the same repo replays them identically — marks survive
//     sessions, now via git, not in-memory state;
//  3. the real `cara` bin round-trips across separate processes: a `submit` in one
//     process is read back by a `dispatch` in another, through the ledger alone.
//
// Travel note: the ledger rides git but needs an explicit refspec to push/fetch, e.g.
//   git config --add remote.origin.push  'refs/cara/*:refs/cara/*'
//   git config --add remote.origin.fetch 'refs/cara/*:refs/cara/*'

import { test } from "bun:test";
import assert from "node:assert/strict";
import type { Atom } from "@cara/core";
import { LEDGER_REF } from "../../packages/node/src/git/ledger-store.ts";
import { compose } from "../../packages/node/src/server/compose.ts";
import { runGit } from "../../packages/node/src/git/run.ts";
import { parseCommand } from "../../packages/node/src/cli/parse.ts";
import { makeReviewFixture } from "../support/fixture-repo.ts";
import { json, runBin } from "./support/run-bin.ts";

function specOf(range: string) {
  const cmd = parseCommand(["atoms", range]);
  if (cmd.verb !== "atoms") throw new Error("unreachable");
  return cmd.spec;
}

/** A one-section grouping placing every atom under one fully-summarised chapter. */
function grouping(atoms: readonly Atom[]): unknown {
  return {
    chapters: [
      {
        title: "All",
        summary: "every change",
        sections: [{ title: "All", summary: "all atoms", atomHashes: atoms.map((a) => a.hash) }],
      },
    ],
  };
}

test("a browser-channel mark + comment land as human-tier facts in refs/cara/ledger; working tree stays clean", async () => {
  const fixture = await makeReviewFixture();
  try {
    const spec = specOf(fixture.range);
    const backend = await compose({ cwd: fixture.dir, spec });
    const snapshot = await backend.service.presentGrouping(spec, grouping((await backend.service.getAtoms(spec)).atoms));
    const hash = snapshot.review.masterList[0]!.hash;

    // The browser channel (human tier — `present`/`mark`/`comment` over the service).
    await backend.service.mark(snapshot.context, hash, "done", { tier: "human", reviewer: null });
    await backend.service.comment(snapshot.context, hash, "Is this guard correct?", { tier: "human", reviewer: null });

    // The facts are committed under refs/cara/ledger — durable git, not gitignored JSONL.
    const paths = (await runGit(["ls-tree", "-r", "--name-only", LEDGER_REF], fixture.dir)).trim().split("\n");
    assert.ok(paths.length >= 2, "the mark and the comment are each a fact blob");
    const facts = await Promise.all(
      paths.map(async (p) => JSON.parse(await runGit(["cat-file", "-p", `${LEDGER_REF}:${p}`], fixture.dir))),
    );
    const markFact = facts.find((f) => f.type === "marked");
    const commentFact = facts.find((f) => f.type === "commented");
    assert.deepEqual(markFact?.author, { tier: "human", reviewer: null }, "browser channel ⇒ human tier");
    assert.equal(commentFact?.body, "Is this guard correct?");
    // No atom payload ever lands in the ledger (ADR-0004).
    assert.equal("lines" in markFact, false);

    // The review fact must not itself surface as a working-tree change.
    assert.equal((await runGit(["status", "--porcelain"], fixture.dir)).trim(), "");
  } finally {
    await fixture.cleanup();
  }
});

test("a fresh composition replays the ledger identically — marks survive the session via git", async () => {
  const fixture = await makeReviewFixture();
  try {
    const spec = specOf(fixture.range);

    // Session 1: present + mark, then drop the backend (end of process, conceptually).
    const first = await compose({ cwd: fixture.dir, spec });
    const snap1 = await first.service.presentGrouping(spec, grouping((await first.service.getAtoms(spec)).atoms));
    const hash = snap1.review.masterList[0]!.hash;
    await first.service.mark(snap1.context, hash, "skipped", { tier: "human", reviewer: null });

    // Session 2: a brand-new composition over the same repo — no shared in-memory state.
    // The grouping is disposable (in-memory), so re-present it; the marks come from git.
    const second = await compose({ cwd: fixture.dir, spec });
    const snap2 = await second.service.presentGrouping(spec, grouping((await second.service.getAtoms(spec)).atoms));
    const replayed = snap2.marks.find((m) => m.atomHash === hash);
    assert.equal(replayed?.disposition, "skipped", "the prior session's mark is read back from git");
    assert.deepEqual(replayed?.author, { tier: "human", reviewer: null });
  } finally {
    await fixture.cleanup();
  }
});

test("the real bin round-trips a fact across processes through the ledger", async () => {
  const fixture = await makeReviewFixture();
  try {
    // Process A: discover an atom hash, then submit a disposition for it (agent tier via CLI).
    const atoms = json(await runBin(["atoms", "--range", fixture.range], fixture.dir));
    const hash = (atoms["atoms"] as { hash: string }[])[0]!.hash;
    const submit = json(
      await runBin(["submit", "-", "--range", fixture.range], fixture.dir, {
        input: JSON.stringify({ marks: [{ atomHash: hash, disposition: "done" }] }),
      }),
    );
    assert.equal((submit["gap"] as { accounted: number }).accounted >= 1, true);

    // Process B: a separate `dispatch` invocation sees the fact — it travelled via the ledger.
    const dispatch = json(await runBin(["dispatch", "--range", fixture.range], fixture.dir));
    assert.equal((dispatch["progress"] as { addressed: number }).addressed, 1);

    // The fact is on the orphan ref, not in any gitignored file and not in HEAD's history.
    const ledgerCommits = (await runGit(["rev-list", "--count", LEDGER_REF], fixture.dir)).trim();
    assert.equal(Number(ledgerCommits) >= 1, true);
  } finally {
    await fixture.cleanup();
  }
});
