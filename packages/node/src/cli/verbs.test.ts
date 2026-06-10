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
import { NEXT, VERB_REFERENCE, type CliIo } from "./output.ts";
import { readDiscovery, writeDiscovery } from "./discovery.ts";

/** A grouping placing `hash` in one fully-summarised chapter/section (passes the gate). */
function oneSectionGrouping(hash: string): string {
  return JSON.stringify({
    chapters: [
      { title: "Core", summary: "the core change", sections: [{ title: "Edit", summary: "the edit", atomHashes: [hash] }] },
    ],
  });
}

/** A pid that is guaranteed dead: spawn a trivial process and wait for it to exit. */
async function deadPid(): Promise<number> {
  const proc = Bun.spawn(["true"]);
  await proc.exited;
  return proc.pid;
}

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
    assert.equal(out["methodologyVersion"], 4);
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
    const grouping = JSON.stringify({
      chapters: [{ title: "Core", summary: "the core change", sections: [{ title: "Edit", summary: "the edit", atomHashes: [hash] }] }],
    });
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

test("a submit comment body over the cap is rejected (CWE-770 — bound matches the browser channel)", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    await assert.rejects(
      runCli(["submit", "-", "--range", range], {
        ...deps(repo),
        io: capture(JSON.stringify({ comments: [{ atomHash: hash, body: "x".repeat(4001) }] })).io,
      }),
      /too long/,
    );
  } finally {
    await repo.cleanup();
  }
});

/** Run `atoms` to learn the review context the verbs key state on. */
async function contextFor(repo: TestRepo, range: string): Promise<string> {
  const cap = capture();
  await runCli(["atoms", "--range", range], { ...deps(repo), io: cap.io });
  return cap.json()["context"] as string;
}

const stateDirOf = (repo: TestRepo) => join(repo.dir, ".agent-state", "reviews");

// --- present: single server per context (ADR-0012 §4) ------------------------

test("present hands a live server the new grouping (live-refresh), never booting a second", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    const context = await contextFor(repo, range);
    // A live server for this context: our own pid is unmistakably alive.
    await writeDiscovery(stateDirOf(repo), context as never, { url: "http://127.0.0.1:9123", pid: process.pid, ts: 1 });

    let handedTo: string | null = null;
    let booted = false;
    const cap = capture(oneSectionGrouping(hash));
    await runCli(["present", "-", "--range", range], {
      ...deps(repo),
      io: cap.io,
      handoff: async (url) => {
        handedTo = url;
      },
      bootServer: async () => {
        booted = true;
        return { url: "http://should-not-boot" };
      },
    });

    const out = cap.json();
    assert.equal(out["opened"], true);
    assert.equal(out["reshaped"], true);
    assert.equal(out["url"], "http://127.0.0.1:9123");
    assert.equal(handedTo, "http://127.0.0.1:9123");
    assert.equal(booted, false); // no second process for the same context
    assert.match(out["next"] as string, /refreshed/);
  } finally {
    await repo.cleanup();
  }
});

test("present cleans a stale discovery record (dead pid) and boots a fresh server", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    const context = await contextFor(repo, range);
    await writeDiscovery(stateDirOf(repo), context as never, { url: "http://dead", pid: await deadPid(), ts: 1 });

    let handed = false;
    let booted = false;
    const cap = capture(oneSectionGrouping(hash));
    await runCli(["present", "-", "--range", range], {
      ...deps(repo),
      io: cap.io,
      handoff: async () => {
        handed = true;
      },
      bootServer: async () => {
        booted = true;
        return { url: "http://fresh" };
      },
    });

    const out = cap.json();
    assert.equal(out["opened"], true);
    assert.equal(out["reshaped"], undefined); // a fresh boot, not a hand-off
    assert.equal(out["url"], "http://fresh");
    assert.equal(handed, false);
    assert.equal(booted, true);
    // The stale record was removed; the fake boot writes no new one, so discovery is clean.
    assert.equal(await readDiscovery(stateDirOf(repo), context as never), null);
  } finally {
    await repo.cleanup();
  }
});

test("present boots when no server is live", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    let booted = false;
    const cap = capture(oneSectionGrouping(hash));
    await runCli(["present", "-", "--range", range], {
      ...deps(repo),
      io: cap.io,
      bootServer: async () => {
        booted = true;
        return { url: "http://fresh" };
      },
    });
    assert.equal(booted, true);
    assert.equal(cap.json()["url"], "http://fresh");
  } finally {
    await repo.cleanup();
  }
});

test("two presents converge on one server: the second hands off, never booting again", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    const context = await contextFor(repo, range);
    const stateDir = stateDirOf(repo);

    let boots = 0;
    let handoffs = 0;
    // The injected boot mimics the real server: it writes the discovery record so a
    // later present in the same context finds it live.
    const bootServer = async () => {
      boots++;
      await writeDiscovery(stateDir, context as never, { url: "http://live", pid: process.pid, ts: 1 });
      return { url: "http://live" };
    };
    const handoff = async () => {
      handoffs++;
    };

    const grouping = oneSectionGrouping(hash);
    await runCli(["present", "-", "--range", range], { ...deps(repo), io: capture(grouping).io, bootServer, handoff });
    await runCli(["present", "-", "--range", range], { ...deps(repo), io: capture(grouping).io, bootServer, handoff });

    assert.equal(boots, 1); // exactly one server ever booted
    assert.equal(handoffs, 1); // the second present refreshed it live
  } finally {
    await repo.cleanup();
  }
});

test("present rejects a summary-less grouping with a usage envelope and no boot", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const hash = await atomHash(repo, range);
    // A chapter + section with no summary fields → the gate rejects.
    const grouping = JSON.stringify({ chapters: [{ title: "Core", sections: [{ title: "Edit", atomHashes: [hash] }] }] });

    let booted = false;
    const cap = capture(grouping);
    await runCli(["present", "-", "--range", range], {
      ...deps(repo),
      io: cap.io,
      bootServer: async () => {
        booted = true;
        return { url: "http://x" };
      },
    });

    const out = cap.json();
    assert.equal(out["error"], "summaries_required");
    const missing = out["missing"] as { chapter: number; section: number | null }[];
    assert.deepEqual(missing, [{ chapter: 0, section: null }, { chapter: 0, section: 0 }]);
    assert.match(out["next"] as string, /summary/);
    assert.match(out["next"] as string, /present/);
    assert.equal(booted, false); // a pre-boot validation: no server churn
  } finally {
    await repo.cleanup();
  }
});

// --- dispatch: a pending Reshape redirects the agent to re-present -------------

test("dispatch surfaces a pending human reshape with a re-present hint", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    const context = await contextFor(repo, range);
    // A human reshape note in the log, with no later `presented` marker → still pending.
    await new JsonlReviewStore(stateDirOf(repo)).append(context as never, {
      type: "reshape-requested",
      ts: 5000,
      body: "split the tests out",
    });

    const cap = capture();
    await runCli(["dispatch", "--range", range], { ...deps(repo), io: cap.io });
    const out = cap.json();
    assert.equal(out["reshape"], "split the tests out");
    assert.match(out["next"] as string, /reshape|Re-group/);
    assert.match(out["next"] as string, /split the tests out/);
  } finally {
    await repo.cleanup();
  }
});

// --- ruling h: every payload-bearing hint states the exact invocation shape ----

test("payload-bearing next hints and the verb reference state --range, stdin '-', and the '<…>' form", () => {
  const payloadHints = [
    NEXT.atoms,
    NEXT.presentNoOpen,
    NEXT.dispatch,
    NEXT.summariesRequired,
    NEXT.reshape("regroup please"),
    NEXT.submitGap(2),
  ];
  for (const hint of payloadHints) {
    assert.match(hint, /--range/, `hint states --range: ${hint}`);
    assert.match(hint, /- for stdin/, `hint states stdin '-': ${hint}`);
    assert.match(hint, /'<[^']+>'/, `hint states the '<…>' payload form: ${hint}`);
  }
  assert.match(VERB_REFERENCE, /--range/);
  assert.match(VERB_REFERENCE, /stdin/);
  assert.match(VERB_REFERENCE, /'<[^>]+>'/);
});

test("an unbounded or unsafe batch.reviewer label is rejected before it reaches the store", async () => {
  const { repo, range } = await oneAtomRepo();
  try {
    await assert.rejects(
      runCli(["submit", "-", "--range", range], {
        ...deps(repo),
        io: capture(JSON.stringify({ reviewer: "a".repeat(41), marks: [] })).io,
      }),
      /at most 40 characters/,
    );
    await assert.rejects(
      runCli(["submit", "-", "--range", range], {
        ...deps(repo),
        io: capture(JSON.stringify({ reviewer: "Bad Label", marks: [] })).io,
      }),
      /lowercase slug/,
    );
  } finally {
    await repo.cleanup();
  }
});
