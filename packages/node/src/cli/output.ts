// The self-narrating protocol surface (ADR-0011, TN-26-027 decisions #6/#11). Every
// verb prints one JSON object to stdout carrying a `next` hint — the agent never needs
// out-of-band docs, the protocol explains itself. The hints and the `instructions`
// verb-reference are defined here, the single source, so they version-lock with the
// `present` grouping schema and can never drift from the wire shapes they describe.

import { readFile } from "node:fs/promises";
import type { PayloadSource } from "./parse.ts";
import { CliError } from "./parse.ts";

/** The IO seam — stdout + stdin — injected so verbs are testable without the real streams. */
export interface CliIo {
  write(text: string): void;
  readStdin(): Promise<string>;
}

export const systemIo: CliIo = {
  write: (text) => process.stdout.write(text),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  },
};

/** Print one JSON object (pretty, newline-terminated) to stdout. */
export function emit(io: CliIo, value: unknown): void {
  io.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Resolve a grouping/batch payload to its raw JSON text from inline / file / stdin. */
export async function readPayload(source: PayloadSource, io: CliIo): Promise<string> {
  switch (source.kind) {
    case "inline":
      return source.json;
    case "stdin":
      return io.readStdin();
    case "file":
      try {
        return await readFile(source.path, "utf8");
      } catch {
        throw new CliError(`Cannot read ${source.path}.`);
      }
  }
}

/** Parse a payload as JSON, failing loudly with paste-ready guidance (no config needed). */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new CliError("Payload is not valid JSON. Pass inline JSON, a file path, or '-' for stdin.");
  }
}

// --- `next` hints: one source, version-locked to the wire shapes -------------

export const NEXT = {
  atomsEmpty: "No changes to review.",
  atoms: "Group these into chapters/sections, then run: clear-diff present <grouping.json>",
  presentOpened: "Wait for the human (they'll say 'done'), or auto-pick-up: clear-diff dispatch --wait",
  presentNoOpen: "Review each section, then run: clear-diff submit '{\"marks\":[…],\"comments\":[…]}'",
  dispatch:
    'Address each open comment — edit code (hash changes → auto-addressed) or run: clear-diff submit \'{"answers":[…]}\'',
  waitDone: "Address open comments, or all clear → finish.",
  waitInProgress: "Human still reviewing. Re-run: clear-diff dispatch --wait",
  waitIdle: "No UI activity for ~5 min. Stop polling; await the human.",
  submitClean: (total: number) => `All ${total} accounted. Review complete.`,
  submitGap: (missing: number) =>
    `${missing} ${missing === 1 ? "atom" : "atoms"} unaccounted. Mark or comment each, then resubmit: clear-diff submit '{…}'`,
} as const;

/** The `instructions` verb's verb-reference block, appended after the merged methodology. */
export const VERB_REFERENCE: string = [
  "—",
  "clear-diff — agent review protocol",
  "",
  "The loop:",
  "  1. clear-diff atoms              → the change set + this methodology. Group it.",
  "  2. clear-diff present <grouping> → persist your grouping; boots the human's browser",
  "                                     (--no-open to stay headless).",
  "  3. clear-diff dispatch [--wait]  → every open comment with its lifecycle + author.",
  "                                     --wait blocks for the human and returns done /",
  "                                     reviewInProgress / reviewIdle. Tune with",
  "                                     --timeout <seconds> and --idle-threshold <seconds>.",
  "  4. clear-diff submit <batch>     → apply marks / comments / answers; returns a gap",
  "                                     report. Resubmit until every atom is accounted.",
  "",
  "Every verb prints JSON with a `next` hint. Spec defaults to the worktree vs origin/main;",
  "pass --range <base>..<head> for a range. Your submissions are recorded as the agent tier",
  "(--reviewer <label> to distinguish lenses); the browser human is the human tier.",
].join("\n");
