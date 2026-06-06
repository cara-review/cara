// Run git and return stdout. The one place this adapter shells out.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// git diffs can be large; allow plenty of headroom over the default 1MB.
const MAX_BUFFER = 256 * 1024 * 1024;

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
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    const { code, stderr, message } = readExecError(err);
    throw new GitError(`git ${args.join(" ")} failed: ${stderr.trim() || message}`, code, stderr);
  }
}
