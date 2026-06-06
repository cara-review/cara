// Deterministic, committed git fixtures for the e2e suite. Built at run time from
// committed content via makeTestRepo (which scrubs every GIT_* var first — the
// host-repo footgun — and pins identity/signing). The review is a `base..head`
// range, so no `origin/main` is needed.
//
// The review fixture exercises every diff surface: a modified file with two
// non-contiguous hunks (a gap), an added file, a deleted file, and a renamed file
// carrying an edit. FakeAgent groups one Section per file → master list = 5 atoms,
// section counts alpha=2, the rest 1.

import { makeTestRepo } from "../../packages/node/src/git/test-repo.ts";

export interface ReviewFixture {
  readonly dir: string;
  /** `base..head` range argument for the CLI. */
  readonly range: string;
  cleanup(): Promise<void>;
}

const ALPHA_BASE = lines(["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10"]);
// Change line 2 and line 9 — far apart, so `-U0` yields two hunks with a 6-line gap.
const ALPHA_HEAD = ALPHA_BASE.replace("export const a2 = 2;", "export const a2 = 22;").replace(
  "export const a9 = 9;",
  "export const a9 = 99;",
);

const BETA_HEAD = `export const beta = "added file";
export function greet(): string {
  return "hello from beta";
}
`;

const GAMMA_BASE = `export const gamma = "to be removed";
export const removeMe = true;
`;

// 4 lines; only line 1 changes → >50% similar → git -M reports a rename with an edit.
const DELTA_BASE = `export const delta = 1;
export const stableLine = "unchanged content kept for rename similarity";
export const anotherStable = "more shared content so the rename is detected";
export const yetMore = "even more shared lines to keep similarity high";
`;
const DELTA_HEAD = DELTA_BASE.replace("export const delta = 1;", "export const delta = 2;");

/** One `export const aN = N;` per name, joined with trailing newline. */
function lines(names: readonly string[]): string {
  return names.map((name) => `export const ${name} = ${name.slice(1)};`).join("\n") + "\n";
}

export async function makeReviewFixture(): Promise<ReviewFixture> {
  const repo = await makeTestRepo();
  await repo.write("src/alpha.ts", ALPHA_BASE);
  await repo.write("src/gamma.ts", GAMMA_BASE);
  await repo.write("src/delta.ts", DELTA_BASE);
  const base = await repo.commit("base");

  await repo.write("src/alpha.ts", ALPHA_HEAD);
  await repo.write("src/beta.ts", BETA_HEAD);
  await repo.remove("src/gamma.ts");
  await repo.remove("src/delta.ts");
  await repo.write("src/delta-renamed.ts", DELTA_HEAD);
  const head = await repo.commit("head");

  return { dir: repo.dir, range: `${base}..${head}`, cleanup: () => repo.cleanup() };
}

/** A single-commit repo whose `sha..sha` range has no changes — the empty-diff state. */
export async function makeEmptyFixture(): Promise<ReviewFixture> {
  const repo = await makeTestRepo();
  await repo.write("README.md", "# fixture\n");
  const sha = await repo.commit("only");
  return { dir: repo.dir, range: `${sha}..${sha}`, cleanup: () => repo.cleanup() };
}

/** Names that exercise git's path encoding: a space (tab-delimited) and non-ASCII (C-quoted). */
export const SPACE_PATH = "src/with space.ts";
export const UNICODE_PATH = "src/café.ts";

/** A review whose changed files have a space and a non-ASCII char in their paths. */
export async function makeSpecialPathsFixture(): Promise<ReviewFixture> {
  const repo = await makeTestRepo();
  await repo.write(SPACE_PATH, "export const a = 1;\n");
  await repo.write(UNICODE_PATH, "export const b = 2;\n");
  const base = await repo.commit("base");

  await repo.write(SPACE_PATH, "export const a = 11;\n");
  await repo.write(UNICODE_PATH, "export const b = 22;\n");
  const head = await repo.commit("head");

  return { dir: repo.dir, range: `${base}..${head}`, cleanup: () => repo.cleanup() };
}
