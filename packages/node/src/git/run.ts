// Run git and return stdout. The one place this adapter shells out.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// git diffs can be large; allow plenty of headroom over the default 1MB.
const MAX_BUFFER = 256 * 1024 * 1024;

// git reads these from the environment and lets them OVERRIDE cwd (GIT_DIR
// especially). If a clone inherits them — a git hook, an interrupted rebase, a
// leaked shell export — every review would target that pinned repo instead of the
// directory it was launched in. Strip them so cwd always governs; PATH, config,
// and identity stay intact.
const REPO_PINNING_GIT_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
] as const;

function hermeticEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of REPO_PINNING_GIT_VARS) delete env[key];
  return env;
}

/** A git invocation that failed. `code` is git's exit code, or null if git never ran. */
export class GitError extends Error {
  readonly code: number | null;
  readonly stderr: string;

  constructor(message: string, code: number | null, stderr: string) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.stderr = stderr;
  }
}

interface ExecError {
  readonly code: number | null;
  readonly stderr: string;
  readonly message: string;
}

/** Narrow an unknown catch value to the bits of an execFile error we use. */
function readExecError(err: unknown): ExecError {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    return {
      code: typeof e["code"] === "number" ? e["code"] : null,
      stderr: typeof e["stderr"] === "string" ? e["stderr"] : "",
      message: typeof e["message"] === "string" ? e["message"] : "unknown error",
    };
  }
  return { code: null, stderr: "", message: "unknown error" };
}

/** Run `git <args>` in `cwd`, resolving to stdout. Rejects with a GitError on failure. */
export async function runGit(args: readonly string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      env: hermeticEnv(),
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    const { code, stderr, message } = readExecError(err);
    throw new GitError(`git ${args.join(" ")} failed: ${stderr.trim() || message}`, code, stderr);
  }
}

/** Extra env to merge over the hermetic base, e.g. a throwaway `GIT_INDEX_FILE` for tree building. */
export type GitEnv = Readonly<Record<string, string>>;

/**
 * Run `git <args>` feeding `stdin`, resolving to stdout. Used by the ledger plumbing
 * (`hash-object --stdin`) and for index-based tree building (`read-tree`/`update-index`/
 * `write-tree`) where a scratch `GIT_INDEX_FILE` is threaded so the real index is never touched.
 */
export async function runGitStdin(
  args: readonly string[],
  cwd: string,
  stdin: string,
  env: GitEnv = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      { cwd, env: { ...hermeticEnv(), ...env }, encoding: "utf8", maxBuffer: MAX_BUFFER },
      (err, stdout) => {
        if (err === null) return resolve(stdout);
        const { code, stderr, message } = readExecError(err);
        reject(new GitError(`git ${args.join(" ")} failed: ${stderr.trim() || message}`, code, stderr));
      },
    );
    child.stdin?.end(stdin);
  });
}
