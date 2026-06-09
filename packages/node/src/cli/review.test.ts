// The porcelain (`clear-diff review`) driven against the stub LLM — no network. Covers
// the headless multi-reviewer loop (converges to a clean gap, per-reviewer labels), the
// human-in-loop wrapper loop (group → present → wait → answer → export), the git-order
// floor (no key, no nag), and the loud key-missing error at the LLM call.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock } from "../clock.ts";
import { makeTestRepo, type TestRepo } from "../git/test-repo.ts";
import { runCli, type CliDeps } from "../cli.ts";
import type { CliIo } from "./output.ts";
import type { ReviewWait } from "./review.ts";
import { FakeLlm } from "./fake-llm.ts";

interface Captured {
  readonly io: CliIo;
  json(): Record<string, unknown>;
}
function capture(stdin = ""): Captured {
  const out: string[] = [];
  return {
    io: { write: (t) => out.push(t), readStdin: () => Promise.resolve(stdin) },
    json: () => JSON.parse(out.join("")) as Record<string, unknown>,
  };
}

/** A repo with two distinct single-line edits → a two-atom diff over `base..head`. */
async function twoAtomRepo(): Promise<{ repo: TestRepo; range: string }> {
  const repo = await makeTestRepo();
  await repo.write("a.ts", "one\n");
  await repo.write("b.ts", "x\n");
  const base = await repo.commit("base");
  await repo.write("a.ts", "one\ntwo\n");
  await repo.write("b.ts", "x\ny\n");
  const head = await repo.commit("edit");
  return { repo, range: `${base}..${head}` };
}

async function makeHome(toml: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "clear-diff-rev-"));
  await mkdir(join(home, ".clear-diff"), { recursive: true });
  await writeFile(join(home, ".clear-diff", "config.toml"), toml);
  return home;
}

const LLM_CONFIG = `[grouping]\nmode = "llm"\n[llm]\nprovider="anthropic"\nmodel="m"\napi_key_env="ANTHROPIC_API_KEY"\n`;
const GIT_ORDER_CONFIG = `[grouping]\nmode = "git-order"\n`;

const base = (repo: TestRepo, home: string, extra: Partial<CliDeps> = {}): CliDeps => ({
  cwd: repo.dir,
  home,
  clock: fixedClock(1000),
  ...extra,
});

test("headless multi-reviewer converges to a clean gap with per-reviewer labels", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(LLM_CONFIG);
  try {
    const cap = capture();
    await runCli(["review", "--headless", "--reviewer", "security", "--reviewer", "architecture", "--range", range], {
      ...base(repo, home, { makeLlm: () => new FakeLlm() }),
      io: cap.io,
    });
    const out = cap.json();
    const gap = out["gap"] as { total: number; missing: unknown[] };
    assert.equal(gap.total, 2);
    assert.equal(gap.missing.length, 0); // every atom accounted across reviewers

    const reviewers = out["reviewers"] as { reviewer: string; comments: unknown[] }[];
    assert.deepEqual(
      reviewers.map((r) => r.reviewer),
      ["security", "architecture"],
    );
    // The stub comments under each lens, so both labels carry a comment.
    assert.ok(reviewers.every((r) => r.comments.length >= 1));
    assert.match(out["next"] as string, /accounted/);
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("headless defaults to the shipped security/architecture/quality lenses", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(LLM_CONFIG);
  try {
    const cap = capture();
    await runCli(["review", "--headless", "--range", range], {
      ...base(repo, home, { makeLlm: () => new FakeLlm() }),
      io: cap.io,
    });
    const reviewers = cap.json()["reviewers"] as { reviewer: string }[];
    assert.deepEqual(
      reviewers.map((r) => r.reviewer),
      ["security", "architecture", "quality"],
    );
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("the human-in-loop wrapper groups, waits, answers an open comment, and exports", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(LLM_CONFIG);
  try {
    // Seed an open comment (as if a prior round / the human raised it).
    const atomsCap = capture();
    await runCli(["atoms", "--range", range], { ...base(repo, home), io: atomsCap.io });
    const hash = (atomsCap.json()["atoms"] as { hash: string }[])[0]!.hash;
    await runCli(["submit", "-", "--range", range], {
      ...base(repo, home),
      io: capture(JSON.stringify({ comments: [{ atomHash: hash, body: "why this?" }] })).io,
    });

    // The browser server boot + the wait are injected: one `done`, then the session closes.
    let waitCalls = 0;
    const waitOnce: ReviewWait = () =>
      Promise.resolve(waitCalls++ === 0 ? { state: "done" } : { state: "closed" });
    const cap = capture();
    await runCli(["review", "--range", range], {
      ...base(repo, home, {
        makeLlm: () => new FakeLlm(),
        bootServer: () => Promise.resolve({ url: "ws://test" }),
        waitOnce,
      }),
      io: cap.io,
    });
    assert.match(cap.json()["next"] as string, /Review complete/);

    // The porcelain answered the open comment → it is now addressed.
    const dispatchCap = capture();
    await runCli(["dispatch", "--range", range], { ...base(repo, home), io: dispatchCap.io });
    const comments = dispatchCap.json()["comments"] as { answer: string | null; status: string }[];
    assert.equal(comments.length, 1);
    assert.ok(comments[0]!.answer !== null);
    assert.equal(comments[0]!.status, "addressed");
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("git-order mode floors the grouping with no key and no nag", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(GIT_ORDER_CONFIG);
  try {
    const cap = capture();
    await runCli(["review", "--range", range], {
      ...base(repo, home, {
        // No makeLlm, no [llm] block: must not require a key.
        bootServer: () => Promise.resolve({ url: "ws://test" }),
        waitOnce: () => Promise.resolve({ state: "done" }),
      }),
      io: cap.io,
    });
    const out = cap.json();
    assert.match(out["next"] as string, /Review complete/);
    assert.equal((out["progress"] as { total: number }).total, 2);
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("mode llm with the key env-var unset fails loudly at the LLM call, never git-order", async () => {
  const { repo, range } = await twoAtomRepo();
  // api_key_env points at a guaranteed-unset variable → the lazy resolution must throw.
  const home = await makeHome(
    `[grouping]\nmode="llm"\n[llm]\nprovider="anthropic"\nmodel="m"\napi_key_env="CLEAR_DIFF_DEFINITELY_UNSET_KEY"\n`,
  );
  try {
    await assert.rejects(
      // Headless, no stub: resolveLlm builds the real AnthropicLlm, which fails at first use.
      runCli(["review", "--headless", "--reviewer", "security", "--range", range], { ...base(repo, home), io: capture().io }),
      /CLEAR_DIFF_DEFINITELY_UNSET_KEY is unset/,
    );
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});
