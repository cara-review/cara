// The self-narrating protocol surface (ADR-0011). Every
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

// Exact invocation grammar (ADR-0012 §h): a cold agent must never guess how to pass a
// payload or a spec. Every payload-bearing hint spells out the `'<…>'` form, the stdin
// `-`, and the optional `--range`, so the protocol stays self-narrating end to end.
const PAYLOAD = "(inline JSON, a file path, or - for stdin)";
const SPEC = "[--range <base>..<head>]";

/** Trim a human's reshape note for a one-line `next` hint without breaking the JSON string. */
function truncate(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export const NEXT = {
  atomsEmpty: "No changes to review.",
  atoms: `Group these into chapters/sections — give every Chapter and Section a one-line summary — then run: clear-diff present '<grouping-json>' ${SPEC}  ${PAYLOAD}`,
  presentOpened: "Wait for the human (they'll say 'done'), or auto-pick-up: clear-diff dispatch --wait",
  presentReshaped:
    "Live review refreshed in the open browser. Wait for the human, or auto-pick-up: clear-diff dispatch --wait",
  presentNoOpen: `Review each section, then run: clear-diff submit '<batch-json>' ${SPEC}  ${PAYLOAD}`,
  dispatch: `Address each open comment — edit code (the hash changes → auto-addressed) or run: clear-diff submit '<batch-json>' ${SPEC}  ${PAYLOAD}`,
  reshape: (body: string) =>
    `The human asked to reshape: "${truncate(body)}". Re-group and run: clear-diff present '<grouping-json>' ${SPEC}  ${PAYLOAD}`,
  summariesRequired: `Every Chapter and Section needs a one-line summary. Add the missing ones and re-run: clear-diff present '<grouping-json>' ${SPEC}  ${PAYLOAD}`,
  waitDone: "Address open comments, or all clear → finish.",
  waitInProgress: "Human still reviewing. Re-run: clear-diff dispatch --wait",
  waitIdle: "No UI activity for ~5 min. Stop polling; await the human.",
  submitClean: (total: number) => `All ${total} accounted. Review complete.`,
  submitGap: (missing: number) =>
    `${missing} ${missing === 1 ? "atom" : "atoms"} unaccounted. Mark or comment each, then resubmit: clear-diff submit '<batch-json>' ${SPEC}  ${PAYLOAD}`,
} as const;

/** The `instructions` verb's verb-reference block, appended after the merged methodology. */
export const VERB_REFERENCE: string = [
  "—",
  "clear-diff — agent review protocol",
  "",
  "The loop:",
  "  1. clear-diff atoms                  → the change set + this methodology. Group it.",
  "  2. clear-diff present '<grouping>'    → persist your grouping; boots the human's browser",
  "                                         (--no-open to stay headless). A live review for this",
  "                                         context is refreshed in place, never duplicated.",
  "  3. clear-diff dispatch [--wait]      → every open comment with its lifecycle + author, plus",
  "                                         any human Reshape request. --wait blocks for the human",
  "                                         and returns done / reviewInProgress / reviewIdle. Tune",
  "                                         with --timeout <seconds> and --idle-threshold <seconds>.",
  "  4. clear-diff submit '<batch>'       → apply marks / comments / answers; returns a gap",
  "                                         report. Resubmit until every atom is accounted.",
  "",
  "Passing payloads: present and submit take their JSON inline ('{…}'), as a file path, or from",
  "stdin with '-'. The spec defaults to the worktree vs origin/main; pass --range <base>..<head>",
  "for a range (or the positional <base>..<head> form on atoms).",
  "",
  "Every verb prints JSON with a `next` hint. Your submissions are recorded as the agent tier",
  "(--reviewer <label> to distinguish lenses, or a `reviewer` field in the batch object —",
  "same lowercase-slug rule); the browser human is the human tier.",
].join("\n");
