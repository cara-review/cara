// AXIS 3 — the standalone wrapper `cara review`. Proves the bundled porcelain
// drives the full loop with the stub LLM (no network, no key), honours git-order mode
// (no LLM at all), and fails loudly — never silently degrading — when its config or its
// API key is missing. The happy paths run the real bin; git-order's human-loop boots a
// browser, so it is exercised through the porcelain entry with injected boot/wait seams.

import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeReviewFixture } from "../support/fixture-repo.ts";
import { runReview } from "../../packages/node/src/cli/review.ts";
import { groupingPath } from "../../packages/node/src/cli/discovery.ts";
import { parseCommand } from "../../packages/node/src/cli/parse.ts";
import type { ReviewContext } from "@cara/core";
import { runBin } from "./support/run-bin.ts";

const LLM_CONFIG = `[grouping]
mode = "llm"
[llm]
provider = "anthropic"
model = "claude-sonnet-4-6"
api_key_env = "ANTHROPIC_API_KEY"
[editor]
command = "true"
`;
const GIT_ORDER_CONFIG = `[grouping]
mode = "git-order"
[editor]
command = "true"
`;

async function makeHome(configToml: string | null): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "cara-home-"));
  if (configToml !== null) {
    await mkdir(join(home, ".cara"), { recursive: true });
    await writeFile(join(home, ".cara", "config.toml"), configToml);
  }
  return home;
}

/** process.env with the Anthropic credentials scrubbed and HOME redirected. */
function envWithout(home: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home };
  delete env["ANTHROPIC_API_KEY"];
  delete env["ANTHROPIC_AUTH_TOKEN"];
  return env;
}

test("headless multi-reviewer converges over the bin with the stub LLM (no network/key)", async () => {
  const fixture = await makeReviewFixture();
  const home = await makeHome(LLM_CONFIG);
  try {
    const run = await runBin(
      ["review", "--headless", "--reviewer", "security", "--reviewer", "quality", "--fake", "--range", fixture.range],
      fixture.dir,
      { env: envWithout(home) },
    );
    assert.equal(run.code, 0, run.err);
    const out = JSON.parse(run.out) as {
      gap: { total: number; missing: unknown[] };
      reviewers: { reviewer: string; comments: unknown[] }[];
    };
    assert.equal(out.gap.missing.length, 0, "every atom accounted across both lenses");
    assert.deepEqual(
      out.reviewers.map((r) => r.reviewer),
      ["security", "quality"],
    );
    assert.ok(out.reviewers.every((r) => r.comments.length >= 1), "each lens recorded at least one comment");
  } finally {
    await fixture.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("a missing config is a loud error carrying a paste-ready sample", async () => {
  const fixture = await makeReviewFixture();
  const home = await makeHome(null);
  try {
    const run = await runBin(["review", "--headless", "--reviewer", "security", "--fake", "--range", fixture.range], fixture.dir, {
      env: envWithout(home),
    });
    assert.equal(run.code, 1);
    assert.match(run.err, /No cara config/);
    assert.match(run.err, /\[grouping\]/); // the paste-ready TOML sample
  } finally {
    await fixture.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("mode=llm with no API key fails loudly at the LLM call — never silently git-order", async () => {
  const fixture = await makeReviewFixture();
  const home = await makeHome(LLM_CONFIG);
  try {
    // No --fake, key scrubbed: the real client resolves its key lazily and must throw.
    const run = await runBin(["review", "--headless", "--reviewer", "security", "--range", fixture.range], fixture.dir, {
      env: envWithout(home),
    });
    assert.equal(run.code, 1);
    assert.match(run.err, /ANTHROPIC_API_KEY is unset/);
  } finally {
    await fixture.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

test("git-order mode floors the grouping and needs no LLM (human answers their own comments)", async () => {
  const fixture = await makeReviewFixture();
  const home = await makeHome(GIT_ORDER_CONFIG);
  const out: string[] = [];
  try {
    // Injected boot (no browser) + wait (human signals done immediately). No LLM, no key.
    await runReview(
      { verb: "review", spec: parseRange(fixture.range), headless: false, reviewers: [], fake: false },
      {
        cwd: fixture.dir,
        stateDir: join(fixture.dir, ".git", "cara", "reviews"),
        home,
        io: { write: (t) => out.push(t), readStdin: () => Promise.resolve("") },
        bootServer: () => Promise.resolve({ url: "http://127.0.0.1:0" }),
        waitOnce: () => Promise.resolve({ state: "done" }),
      },
    );
    const result = JSON.parse(out.join("")) as { context: string; commentFile: string; next: string };
    assert.match(result.next, /complete/i);

    // The grouping persisted for the browser is the git-order floor: one "Other changes" chapter.
    const grouping = JSON.parse(
      await readFile(groupingPath(join(fixture.dir, ".git", "cara", "reviews"), result.context as ReviewContext), "utf8"),
    ) as { chapters: { title: string }[] };
    assert.equal(grouping.chapters.length, 1);
    assert.equal(grouping.chapters[0]?.title, "Other changes");
  } finally {
    await fixture.cleanup();
    await rm(home, { recursive: true, force: true });
  }
});

/** Parse a `base..head` range into a DiffSpec via the canonical CLI parser. */
function parseRange(range: string) {
  const cmd = parseCommand(["atoms", range]);
  if (cmd.verb !== "atoms") throw new Error("unreachable");
  return cmd.spec;
}
