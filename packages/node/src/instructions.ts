import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InstructionsSource, ReviewInstructions } from "@clear-diff/core";

const PERSONAL_FILE = ".clear-diff/CLEAR_DIFF.md";
const PROJECT_FILE = "CLEAR_DIFF.md";

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Loads personal (~/.clear-diff/CLEAR_DIFF.md) and project (CLEAR_DIFF.md) instructions. */
export class FileInstructions implements InstructionsSource {
  readonly #homeDir: string;
  readonly #repoDir: string;

  constructor(homeDir: string = homedir(), repoDir: string = process.cwd()) {
    this.#homeDir = homeDir;
    this.#repoDir = repoDir;
  }

  async load(): Promise<ReviewInstructions> {
    const [personal, project] = await Promise.all([
      readIfPresent(join(this.#homeDir, PERSONAL_FILE)),
      readIfPresent(join(this.#repoDir, PROJECT_FILE)),
    ]);
    return { personal, project };
  }
}
