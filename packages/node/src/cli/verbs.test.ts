// Contract tests for the agent verbs: the JSON wire shape of each, the presence of a
// `next` hint, and the channel-inferred tier (a CLI submit is always the agent tier).
// Driven through `runCli` over a real temp git repo so the whole composition is exercised.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fixedClock } from "../clock.ts";
import { makeTestRepo, type TestRepo } from "../git/test-repo.ts";
import { JsonlReviewStore } from "../review-store.ts";
import { runCli } from "../cli.ts";
import type { CliIo } from "./output.ts";

interface Captured {
  readonly io: CliIo;
  text(): string;
  json(): Record<string, unknown>;
}

function capture(stdin = ""): Captured {
  const out: string[] = [];
  return {
    io: { write: (t) => out.push(t), readStdin: () => Promise.resolve(stdin) },
    text: () => out.join(""),
    json: () => JSON.parse(out.join("")) as Record<string, unknown>,
  };
}

/** A repo with one modified file → a single-atom diff over `base..head`. */
async function oneAtomRepo(): Promise<{ repo: TestRepo; range: string }> {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  const base = await repo.commit("base");
  await repo.write("a.ts", "one\ntwo\n");
  const head = await repo.commit("add line");
  return { repo, range: `${base}..${head}` };
}

const deps = (repo: TestRepo) => ({ cwd: repo.dir, clock: fixedClock(1000) });

async function atomHash(repo: TestRepo, range: string): Promise<string> {
  const cap = capture();
  await runCli(["atoms", "--range", range], { ...deps(repo), io: cap.io });
  const atoms = cap.json()["atoms"] as { hash: string }[];
  return atoms[0]!.hash;
}

test("atoms emits context, methodology, atoms, openItems, and a next hint", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const cap = capture();
    await runCli(["atoms", "--range", range], { ...deps(repo), io: cap.io });
    const out = cap.json();
    assert.ok(typeof out["context"] === "string");
    assert.ok(typeof out["methodology"] === "string" && (out["methodology"] as string).length > 0);
    assert.equal(out["methodologyVersion"], 1);
    assert.equal((out["atoms"] as unknown[]).length, 1);
    assert.deepEqual(out["openItems"], []);
    assert.match(out["next"] as string, /present/);
  } finally {
    await repo.cleanup();
  }
});

test("atoms over an empty diff yields no atoms and a 'no changes' hint", async () => {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  const base = await repo.commit("base");
  try {
    const cap = capture();
    await runCli(["atoms", "--range", `${base}..${base}`], { ...deps(repo), io: cap.io });
    const out = cap.json();
    assert.deepEqual(out["atoms"], []);
    assert.match(out["next"] as string, /No changes/);
  } finally {
    await repo.cleanup();
  }
});

test("present --no-open persists the grouping and reports headless progress", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    const grouping = JSON.stringify({ chapters: [{ title: "Core", sections: [{ title: "Edit", atomHashes: [hash] }] }] });
    const cap = capture(grouping);
    await runCli(["present", "-", "--no-open", "--range", range], { ...deps(repo), io: cap.io });
    const out = cap.json();
    assert.equal(out["opened"], false);
    assert.equal((out["progress"] as { total: number }).total, 1);
    assert.match(out["next"] as string, /submit/);
    assert.equal(out["url"], undefined);
  } finally {
    await repo.cleanup();
  }
});

test("submit returns a gap report and stamps the agent tier with the reviewer label", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    const batch = JSON.stringify({ marks: [{ atomHash: hash, disposition: "done" }] });
    const cap = capture(batch);
    await runCli(["submit", "-", "--reviewer", "security", "--range", range], { ...deps(repo), io: cap.io });
    const out = cap.json();
    assert.equal((out["gap"] as { total: number }).total, 1);
    assert.equal((out["gap"] as { accounted: number }).accounted, 1);
    assert.match(out["next"] as string, /Review complete/);

    // Channel-inferred tier: the persisted event is the agent tier with the label.
    const events = await new JsonlReviewStore(join(repo.dir, ".agent-state", "reviews")).load(
      out["context"] as never,
    );
    const marked = events.find((e) => e.type === "marked");
    assert.deepEqual(marked && "author" in marked ? marked.author : null, { tier: "agent", reviewer: "security" });
  } finally {
    await repo.cleanup();
  }
});

test("submit reports the unaccounted atoms when the batch is incomplete", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const cap = capture(JSON.stringify({ marks: [] }));
    await runCli(["submit", "-", "--range", range], { ...deps(repo), io: cap.io });
    const out = cap.json();
    assert.equal((out["gap"] as { missing: unknown[] }).missing.length, 1);
    assert.match(out["next"] as string, /unaccounted/);
  } finally {
    await repo.cleanup();
  }
});

test("dispatch lists located comments carrying their author tier + reviewer", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    await runCli(["submit", "-", "--reviewer", "security", "--range", range], {
      ...deps(repo),
      io: capture(JSON.stringify({ comments: [{ atomHash: hash, body: "explain this" }] })).io,
    });
    const cap = capture();
    await runCli(["dispatch", "--range", range], { ...deps(repo), io: cap.io });
    const out = cap.json();
    const comments = out["comments"] as { tier: string; reviewer: string | null; body: string }[];
    assert.equal(comments.length, 1);
    assert.equal(comments[0]!.tier, "agent");
    assert.equal(comments[0]!.reviewer, "security");
    assert.match(out["next"] as string, /comment/);
  } finally {
    await repo.cleanup();
  }
});

test("instructions prints the methodology plus the verb reference, as plain text", async () => {
  const repo = await makeTestRepo();
  try {
    const cap = capture();
    await runCli(["instructions"], { ...deps(repo), io: cap.io });
    const text = cap.text();
    assert.match(text, /Chapters/);
    assert.match(text, /clear-diff atoms/);
    assert.match(text, /clear-diff submit/);
    assert.doesNotMatch(text.split("\n")[0]!, /^\{/); // not JSON
  } finally {
    await repo.cleanup();
  }
});

test("the bare review porcelain fails loudly when no config exists", async () => {
  const repo = await makeTestRepo();
  try {
    // Point home at an empty dir so no config.toml is found; the error pastes a sample.
    await assert.rejects(runCli([], { ...deps(repo), home: repo.dir, io: capture().io }), /No clear-diff config/);
  } finally {
    await repo.cleanup();
  }
});

test("a malformed submit batch fails loudly with paste-ready guidance", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    await assert.rejects(
      runCli(["submit", "-", "--range", range], { ...deps(repo), io: capture("not json").io }),
      /valid JSON/,
    );
    await assert.rejects(
      runCli(["submit", "-", "--range", range], {
        ...deps(repo),
        io: capture(JSON.stringify({ marks: [{ atomHash: "h", disposition: "maybe" }] })).io,
      }),
      /done.*skipped/,
    );
  } finally {
    await repo.cleanup();
  }
});
