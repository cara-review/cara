// Build a throwaway git repo in a temp dir for adapter integration tests.
// Deterministic identity via env; commit signing disabled so a developer's
// global gpgsign config cannot break the fixture.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// Scrub every inherited GIT_* var from this test process so neither the fixture
// NOR the production adapters under test touch the host repo. Under the pre-push
// hook git exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE; GIT_DIR overrides
// cwd discovery, so `git init`/`show`/`update-ref` would hit the real repo. The
// adapters' runGit inherits process.env, so the scrub must mutate process.env
// itself, not just the fixture's env. Identity is then set explicitly.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

export interface TestRepo {
  readonly dir: string;
  git(...args: string[]): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  commit(message: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function makeTestRepo(): Promise<TestRepo> {
  const dir = await mkdtemp(join(tmpdir(), "cara-git-"));
  const git = async (...args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", args, { cwd: dir, env: ENV, encoding: "utf8" });
    return stdout;
  };
  await git("init", "-q", "-b", "main");
  await git("config", "commit.gpgsign", "false");

  return {
    dir,
    git,
    async write(path, content) {
      const full = join(dir, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
    },
    async remove(path) {
      await rm(join(dir, path));
    },
    async commit(message) {
      await git("add", "-A");
      await git("commit", "-q", "-m", message);
      return (await git("rev-parse", "HEAD")).trim();
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
