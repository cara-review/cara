import { spawn, type SpawnOptions } from "node:child_process";
import { basename } from "node:path";
import type { EditorPort } from "@clear-diff/core";

// VS Code-family editors need an explicit --goto flag to parse `path:line`;
// others (e.g. zed) take the target positionally.
const CODE_FAMILY = new Set(["code", "code-insiders", "codium", "cursor"]);

/** Command-line arguments to open `path` at `line` in `command`. */
export function editorArgs(command: string, path: string, line: number): readonly string[] {
  const target = `${path}:${line}`;
  return CODE_FAMILY.has(basename(command)) ? ["--goto", target] : [target];
}

export interface SpawnedProcess {
  unref(): void;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => SpawnedProcess;

const defaultSpawn: SpawnFn = (command, args, options) => spawn(command, args, options);

/** Opens files by spawning the configured editor command, detached (ADR-0003). */
export class SpawnEditor implements EditorPort {
  readonly #command: string;
  readonly #spawn: SpawnFn;

  constructor(command: string, spawnFn: SpawnFn = defaultSpawn) {
    this.#command = command;
    this.#spawn = spawnFn;
  }

  open(path: string, line: number): Promise<void> {
    this.#spawn(this.#command, editorArgs(this.#command, path, line), {
      detached: true,
      stdio: "ignore",
    }).unref();
    return Promise.resolve();
  }
}
