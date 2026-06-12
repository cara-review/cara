// GitLedgerStore adapter tests (ADR-0005 rewrite, TN-26-034). The ledger is a
// committed orphan ref `refs/cara/ledger`; these prove the load-bearing details:
// round-trip, append order from commit topology (NOT ts/blob name), the ADR-0004
// constraint (atom hashes only, never the atom set), empty-ledger load, and the
// disjoint concurrent-append merge that the content-addressed layout enables.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { project, type AtomHash, type MarkAuthor, type MarkEvent, type ReviewContext } from "@clear-diff/core";
import { GitLedgerStore, LEDGER_REF } from "./ledger-store.ts";
import { contextHash } from "../context-hash.ts";
import { runGitStdin } from "./run.ts";
import { makeTestRepo, type TestRepo } from "./test-repo.ts";

const ctx = (s: string): ReviewContext => s as ReviewContext;
const atom = (s: string): AtomHash => s as AtomHash;
const human: MarkAuthor = { tier: "human", reviewer: null };
const agent: MarkAuthor = { tier: "agent", reviewer: "security" };

async function freshRepo(): Promise<{ repo: TestRepo; store: GitLedgerStore }> {
  const repo = await makeTestRepo();
  await repo.write("seed.txt", "seed");
  await repo.commit("seed");
  return { repo, store: new GitLedgerStore(repo.dir) };
}

test("load on an empty ledger returns no events", async () => {
  const { repo, store } = await freshRepo();
  try {
    assert.deepEqual(await store.load(ctx("worktree:feature/x")), []);
  } finally {
    await repo.cleanup();
  }
});

test("append then load round-trips every event type in append order", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("base..head");
    const events: MarkEvent[] = [
      { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done", author: human },
      { type: "commented", ts: 2, atomHash: atom("a"), body: "looks off", author: agent },
      { type: "commented", ts: 3, atomHash: atom("a"), body: "this line", author: human, line: { side: "added", text: "x" } },
      { type: "answered", ts: 4, commentId: "c0", body: "fixed", author: human },
      { type: "unmarked", ts: 5, atomHash: atom("a"), author: human },
      { type: "reshape-requested", ts: 6, body: "split the tests out" },
      { type: "presented", ts: 7 },
      { type: "completed", ts: 8 },
    ];
    for (const event of events) await store.append(context, event);
    assert.deepEqual(await store.load(context), events);
  } finally {
    await repo.cleanup();
  }
});

test("append order is reconstructed from commit topology, not ts (fixed clock collides ts)", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("worktree:order");
    // All events share ts=1 (a fixed clock). Distinct comment bodies make the ordinal
    // assignment observable: c0 must be the first appended, regardless of ts or blob name.
    const bodies = ["first", "second", "third", "fourth", "fifth"];
    for (const body of bodies) {
      await store.append(context, { type: "commented", ts: 1, atomHash: atom("a"), body, author: human });
    }
    const loaded = await store.load(context);
    assert.deepEqual(loaded.map((e) => (e.type === "commented" ? e.body : null)), bodies);

    // The fold's commentId ordinal therefore matches append order, the load-bearing guarantee.
    const state = project(loaded);
    assert.deepEqual(
      state.comments.map((c) => [c.id, c.body]),
      bodies.map((body, i) => [`c${i}`, body]),
    );
  } finally {
    await repo.cleanup();
  }
});

test("last-write-wins survives a round-trip (order-dependent mark fold)", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("pr:42");
    await store.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done", author: human });
    await store.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "skipped", author: agent });
    const state = project(await store.load(context));
    assert.equal(state.marks.get(atom("a"))?.disposition, "skipped"); // the later append wins
    assert.deepEqual(state.marks.get(atom("a"))?.author, agent);
  } finally {
    await repo.cleanup();
  }
});

test("marks do not bleed between contexts", async () => {
  const { repo, store } = await freshRepo();
  try {
    const a = ctx("worktree:feature/a");
    const b = ctx("worktree:feature/b");
    await store.append(a, { type: "marked", ts: 1, atomHash: atom("x"), disposition: "done", author: human });
    assert.deepEqual(await store.load(b), []);
    assert.equal((await store.load(a)).length, 1);
  } finally {
    await repo.cleanup();
  }
});

test("each append is one commit on refs/cara/ledger; the working tree stays clean", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("worktree:clean");
    await store.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done", author: human });
    await store.append(context, { type: "completed", ts: 2 });

    // Two appends → two ledger commits (first-parent walk has length 2).
    const log = (await repo.git("rev-list", "--first-parent", "--count", LEDGER_REF)).trim();
    assert.equal(log, "2");

    // The working tree and index are untouched — no review fact appears as a change.
    assert.equal((await repo.git("status", "--porcelain")).trim(), "");
    // HEAD's history is untouched: the ledger is an orphan ref, not on main.
    assert.equal((await repo.git("rev-list", "--count", "HEAD")).trim(), "1");
  } finally {
    await repo.cleanup();
  }
});

test("the ledger stores only the MarkEvent (atom hash), never the atom set (ADR-0004)", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("worktree:adr4");
    await store.append(context, { type: "marked", ts: 1, atomHash: atom("deadbeef"), disposition: "done", author: human });

    // Read the single blob under <contextHash>/ straight from the ledger tree.
    const entries = (await repo.git("ls-tree", "-r", "--name-only", LEDGER_REF)).trim().split("\n");
    assert.equal(entries.length, 1);
    assert.match(entries[0]!, new RegExp(`^${contextHash(context)}/[0-9a-f]+\\.json$`));
    const blob = JSON.parse(await repo.git("show", `${LEDGER_REF}:${entries[0]!}`)) as Record<string, unknown>;
    assert.deepEqual(blob, {
      type: "marked",
      ts: 1,
      atomHash: "deadbeef",
      disposition: "done",
      author: { tier: "human", reviewer: null },
    });
    // No atom payload (lines / oldStart / newStart) ever lands in the ledger.
    assert.equal("lines" in blob, false);
  } finally {
    await repo.cleanup();
  }
});

test("an identical fact dedupes — content-addressed factId collapses the re-append", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("worktree:dedupe");
    const event: MarkEvent = { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done", author: human };
    await store.append(context, event);
    await store.append(context, event); // same canonical bytes → same factId → same path

    const entries = (await repo.git("ls-tree", "-r", "--name-only", LEDGER_REF)).trim().split("\n");
    assert.equal(entries.length, 1); // one blob, not two
  } finally {
    await repo.cleanup();
  }
});

test("concurrent disjoint appends to one context all land (CAS-serialized, order preserved)", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("worktree:concurrent");
    // Fire many distinct facts concurrently. They are disjoint (distinct bodies → distinct
    // factIds → distinct paths), so none is lost; the CAS retry serializes the ref update.
    const bodies = Array.from({ length: 8 }, (_, i) => `c${i}`);
    await Promise.all(
      bodies.map((body) => store.append(context, { type: "commented", ts: 1, atomHash: atom("a"), body, author: human })),
    );
    const loaded = await store.load(context);
    assert.deepEqual(new Set(loaded.map((e) => (e.type === "commented" ? e.body : null))), new Set(bodies));
    assert.equal(loaded.length, bodies.length); // every concurrent append survived
  } finally {
    await repo.cleanup();
  }
});

test("a tree merged from two disjoint ledger tips is a clean union of both facts", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("worktree:merge");
    // Two clones would diverge from a common tip. Model it: append A, branch the ref, append
    // B on each side via the store, then merge — disjoint paths union with no conflict.
    await store.append(context, { type: "commented", ts: 1, atomHash: atom("a"), body: "base", author: human });
    const base = (await repo.git("rev-parse", LEDGER_REF)).trim();

    await store.append(context, { type: "commented", ts: 1, atomHash: atom("a"), body: "left", author: human });
    const left = (await repo.git("rev-parse", LEDGER_REF)).trim();

    await repo.git("update-ref", LEDGER_REF, base); // rewind to the common tip
    await store.append(context, { type: "commented", ts: 1, atomHash: atom("a"), body: "right", author: human });
    const right = (await repo.git("rev-parse", LEDGER_REF)).trim();

    // Merge the two trees against their common base — git unions the disjoint blobs.
    const merged = (await repo.git("merge-tree", "--write-tree", "--merge-base", base, left, right)).trim();
    const bodies = (await repo.git("ls-tree", "-r", "--name-only", merged))
      .trim()
      .split("\n")
      .map(async (path) => JSON.parse(await repo.git("cat-file", "-p", `${merged}:${path}`))["body"]);
    const resolved = await Promise.all(bodies);
    assert.deepEqual(new Set(resolved), new Set(["base", "left", "right"]));
  } finally {
    await repo.cleanup();
  }
});

test("a structurally invalid fact in the ledger is rejected as corrupt on load", async () => {
  const { repo, store } = await freshRepo();
  try {
    const context = ctx("worktree:corrupt");
    // Seed a valid commit so the ref exists, then plant a malformed blob (missing
    // `disposition`) under the context path via plumbing and assert load surfaces it.
    await store.append(context, { type: "marked", ts: 1, atomHash: atom("a"), disposition: "done", author: human });
    const bad = JSON.stringify({ type: "marked", ts: 1, atomHash: "a", author: { tier: "human", reviewer: null } });
    const blob = (await runGitStdin(["hash-object", "-w", "--stdin"], repo.dir, bad)).trim();
    const tip = (await repo.git("rev-parse", LEDGER_REF)).trim();
    const baseTree = (await repo.git("rev-parse", `${LEDGER_REF}^{tree}`)).trim();
    const idx = join(await mkdtemp(join(tmpdir(), "ledger-corrupt-")), "index");
    const env = { GIT_INDEX_FILE: idx };
    await runGitStdin(["read-tree", baseTree], repo.dir, "", env);
    await runGitStdin(["update-index", "--add", "--cacheinfo", `100644,${blob},${contextHash(context)}/bad.json`], repo.dir, "", env);
    const tree = (await runGitStdin(["write-tree"], repo.dir, "", env)).trim();
    const commit = (await repo.git("commit-tree", tree, "-p", tip, "-m", "corrupt")).trim();
    await repo.git("update-ref", LEDGER_REF, commit);

    await assert.rejects(store.load(context), /Corrupt/);
  } finally {
    await repo.cleanup();
  }
});
