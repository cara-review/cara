// The porcelain (`cara review`) driven against the stub LLM — no network. Covers
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
import { composeCore } from "../server/compose.ts";
import { GitLedgerStore } from "../git/ledger-store.ts";
import type { CliIo } from "./output.ts";
import type { ReviewWait } from "./review.ts";
import { FakeLlm } from "./fake-llm.ts";
import { writeDiscovery } from "./discovery.ts";
import type { AnswerRequest, GroupingRequest, LensRequest, PorcelainLlm } from "./llm.ts";

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
  const home = await mkdtemp(join(tmpdir(), "cara-rev-"));
  await mkdir(join(home, ".cara"), { recursive: true });
  await writeFile(join(home, ".cara", "config.toml"), toml);
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

test("git-order floor threads requireSummaries:false to the boot (ADR-0012 §1 — never rejected)", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(GIT_ORDER_CONFIG);
  try {
    let bootGate: boolean | undefined;
    const cap = capture();
    await runCli(["review", "--range", range], {
      ...base(repo, home, {
        bootServer: (_cmd, _ctx, requireSummaries) => {
          bootGate = requireSummaries;
          return Promise.resolve({ url: "ws://test" });
        },
        waitOnce: () => Promise.resolve({ state: "done" }),
      }),
      io: cap.io,
    });
    assert.equal(bootGate, false); // the exempt floor must boot without the summary gate
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("the misses-twice floor hands off to a live server with requireSummaries:false (ADR-0012 §1)", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(LLM_CONFIG);
  const stateDir = join((await repo.git("rev-parse", "--absolute-git-dir")).trim(), "cara", "reviews");
  const [b, h] = range.split("..");
  const spec = { kind: "range" as const, base: b!, head: h! };
  try {
    // A live server already serves this context, so the floor reaches the handover (path b
    // from the A/B B1 finding: LLM omits summaries twice mid-session, server always live).
    const { diffSource } = await composeCore({ cwd: repo.dir, spec });
    const context = await diffSource.resolveContext(spec);
    await writeDiscovery(stateDir, context, { url: "ws://test", pid: process.pid, ts: 1 });

    let handoffGate: boolean | undefined;
    const cap = capture();
    await runCli(["review", "--range", range], {
      ...base(repo, home, {
        makeLlm: () => new NoSummaryLlm(),
        handoff: (_url, _ctx, _grouping, requireSummaries) => {
          handoffGate = requireSummaries;
          return Promise.resolve();
        },
        waitOnce: () => Promise.resolve({ state: "closed" }),
      }),
      io: cap.io,
    });
    assert.equal(handoffGate, false); // the floor is never re-gated at the live handover
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

/** A stub that always omits the mandatory summaries, so `presentGrouping` rejects it. */
class NoSummaryLlm implements PorcelainLlm {
  groupCalls = 0;
  readonly #fake = new FakeLlm();
  group(req: GroupingRequest): Promise<unknown> {
    this.groupCalls++;
    return Promise.resolve({ chapters: [{ title: "C", sections: [{ title: "S", atomHashes: req.atoms.map((a) => a.hash) }] }] });
  }
  review(req: LensRequest) {
    return this.#fake.review(req);
  }
  answer(req: AnswerRequest) {
    return this.#fake.answer(req);
  }
}

/** Omits summaries on the first group call (so the gate rejects), then complies — recording the
 *  `summaryReminder` each call received, to prove the retry is not a byte-identical resend. */
class SummaryRetryLlm extends FakeLlm {
  readonly reminders: (string | undefined)[] = [];
  override group(req: GroupingRequest): Promise<unknown> {
    this.reminders.push(req.summaryReminder);
    if (this.reminders.length === 1) {
      return Promise.resolve({
        chapters: [{ title: "C", sections: [{ title: "S", atomHashes: req.atoms.map((a) => a.hash) }] }],
      });
    }
    return super.group(req); // a fully-summarised grouping → the gate accepts
  }
}

/** A compliant stub that records the reshape note passed to each `group` call. */
class ReshapeRecordingLlm extends FakeLlm {
  readonly reshapes: (string | undefined)[] = [];
  override group(req: GroupingRequest): Promise<unknown> {
    this.reshapes.push(req.reshape);
    return super.group(req);
  }
}

test("a human reshape request drives a re-group and a live hand-off (not a re-boot)", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(LLM_CONFIG);
  const stateDir = join((await repo.git("rev-parse", "--absolute-git-dir")).trim(), "cara", "reviews");
  // A shared advancing clock: the reshape request must land with a ts AFTER the initial
  // present, so the porcelain sees it as pending when it polls `done`.
  let tick = 1000;
  const clock = { now: () => tick++ };
  const [b, h] = range.split("..");
  const spec = { kind: "range" as const, base: b!, head: h! };
  try {
    const { diffSource } = await composeCore({ cwd: repo.dir, spec, clock });
    const context = await diffSource.resolveContext(spec);
    // Append the reshape straight to the shared event log (the browser→server path is absent
    // in this offline test). `dispatch` recomputes from the store, so the porcelain sees it.
    // Using the shared clock gives it a ts after the initial present and before the re-present.
    const store = new GitLedgerStore(repo.dir);

    const llm = new ReshapeRecordingLlm();
    const handoffs: unknown[] = [];
    let boots = 0;
    let waitCalls = 0;
    const waitOnce: ReviewWait = async () => {
      if (waitCalls++ === 0) {
        await store.append(context, { type: "reshape-requested", ts: clock.now(), body: "split the tests out" });
        return { state: "done" };
      }
      return { state: "closed" };
    };
    const cap = capture();
    await runCli(["review", "--range", range], {
      ...base(repo, home, {
        makeLlm: () => llm,
        clock,
        bootServer: async (_cmd, ctxId) => {
          boots++;
          await writeDiscovery(stateDir, ctxId, { url: "ws://test", pid: process.pid, ts: 1 });
          return { url: "ws://test" };
        },
        handoff: (_url, _ctx, grouping) => {
          handoffs.push(grouping);
          return Promise.resolve();
        },
        waitOnce,
      }),
      io: cap.io,
    });

    assert.equal(boots, 1); // booted once, on the initial present
    assert.equal(handoffs.length, 1); // the reshape re-presented via live hand-off, never a sibling boot
    assert.equal(llm.reshapes.length, 2); // initial group + one re-group
    assert.equal(llm.reshapes[1], "split the tests out"); // the re-group carried the human's note
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("LLM grouping that omits summaries retries once, then floors with a surfaced notice", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(LLM_CONFIG);
  try {
    const llm = new NoSummaryLlm();
    const cap = capture();
    await runCli(["review", "--range", range], {
      ...base(repo, home, {
        makeLlm: () => llm,
        bootServer: () => Promise.resolve({ url: "ws://test" }),
        waitOnce: () => Promise.resolve({ state: "closed" }),
      }),
      io: cap.io,
    });
    assert.equal(llm.groupCalls, 2); // first attempt + one retry, then the floor
    const notices = cap.json()["notices"] as string[] | undefined;
    assert.ok(notices?.some((n) => /summaries/i.test(n)), "floor fallback is surfaced, not silent");
    assert.equal((cap.json()["progress"] as { total: number }).total, 2); // the floor still covers every atom
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("a summary-gate rejection feeds the missing chapters/sections into the retry (A/B finding 11)", async () => {
  const { repo, range } = await twoAtomRepo();
  const home = await makeHome(LLM_CONFIG);
  try {
    const llm = new SummaryRetryLlm();
    const cap = capture();
    await runCli(["review", "--range", range], {
      ...base(repo, home, {
        makeLlm: () => llm,
        bootServer: () => Promise.resolve({ url: "ws://test" }),
        waitOnce: () => Promise.resolve({ state: "closed" }),
      }),
      io: cap.io,
    });
    assert.equal(llm.reminders.length, 2); // first attempt + one retry
    assert.equal(llm.reminders[0], undefined); // the first request carries no reminder
    // the retry names the gap (the offending chapter/section), so it is not an identical resend
    const reminder = llm.reminders[1];
    assert.ok(typeof reminder === "string", "the retry must carry a summaryReminder");
    assert.match(reminder, /summar/i);
    assert.match(reminder, /chapter "C"/);
    assert.match(reminder, /section "S"/);
    // it converged on the retry → no floor-fallback notice
    const notices = cap.json()["notices"] as string[] | undefined;
    assert.ok(!notices?.some((n) => /summaries/i.test(n)), "retry converged; the floor never fired");
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("mode llm with the key env-var unset fails loudly at the LLM call, never git-order", async () => {
  const { repo, range } = await twoAtomRepo();
  // api_key_env points at a guaranteed-unset variable → the lazy resolution must throw.
  const home = await makeHome(
    `[grouping]\nmode="llm"\n[llm]\nprovider="anthropic"\nmodel="m"\napi_key_env="CARA_DEFINITELY_UNSET_KEY"\n`,
  );
  try {
    await assert.rejects(
      // Headless, no stub: resolveLlm builds the real AnthropicLlm, which fails at first use.
      runCli(["review", "--headless", "--reviewer", "security", "--range", range], { ...base(repo, home), io: capture().io }),
      /CARA_DEFINITELY_UNSET_KEY is unset/,
    );
  } finally {
    await repo.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});
