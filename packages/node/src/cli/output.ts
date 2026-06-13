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
  atoms: `Group these into chapters/sections — give every Chapter and Section a one-line summary — then run: cara present '<grouping-json>' ${SPEC}  ${PAYLOAD}`,
  presentOpened: "Wait for the human (they'll say 'done'), or auto-pick-up: cara dispatch --wait",
  presentReshaped:
    "Live review refreshed in the open browser. Wait for the human, or auto-pick-up: cara dispatch --wait",
  presentNoOpen: `Review each section, then run: cara submit '<batch-json>' ${SPEC}  ${PAYLOAD}`,
  dispatch: `Address each open comment — edit code (the hash changes → auto-addressed) or run: cara submit '<batch-json>' ${SPEC}  ${PAYLOAD}`,
  reshape: (body: string) =>
    `The human asked to reshape: "${truncate(body)}". Re-group and run: cara present '<grouping-json>' ${SPEC}  ${PAYLOAD}`,
  summariesRequired: `Every Chapter and Section needs a one-line summary. Add the missing ones and re-run: cara present '<grouping-json>' ${SPEC}  ${PAYLOAD}`,
  waitDone: "Address open comments, or all clear → finish.",
  waitInProgress: "Human still reviewing. Re-run: cara dispatch --wait",
  waitIdle: "No UI activity for ~5 min. Stop polling; await the human.",
  submitClean: (total: number) => `All ${total} accounted. Review complete.`,
  submitGap: (missing: number) =>
    `${missing} ${missing === 1 ? "atom" : "atoms"} unaccounted. Mark or comment each, then resubmit: cara submit '<batch-json>' ${SPEC}  ${PAYLOAD}`,
  gateReadout:
    "Coverage only (no bar set). Enforce with: cara gate --require <role>=<percent>% (e.g. security=100%,human>=50%).",
  gateCrossContext: (n: number) =>
    `${n} ${n === 1 ? "atom is" : "atoms are"} unaddressed in this review's context but already reviewed under other contexts in the ledger (e.g. each agent's own worktree). Count cross-context coverage with: cara gate --repo ${SPEC}  (advisory, unsigned — ADR-0014 §7).`,
  gatePass: "Review gate met — every required role cleared its bar. Safe to proceed / merge.",
  gateFail: (roles: readonly string[]) =>
    `Review gate not met: ${roles.join(", ")} below bar. Have the missing role(s) review the unaddressed atoms, then re-run: cara gate.`,
  gateIndeterminate:
    "Repo gate over an empty range — no introduced content to measure. Pass --range <baseline>..<target> (the adoption baseline → HEAD).",
} as const;

/** The `instructions` verb's verb-reference block, appended after the merged methodology. */
export const VERB_REFERENCE: string = [
  "—",
  "cara — agent review protocol",
  "",
  "The loop:",
  "  1. cara atoms                  → the change set + this methodology. Group it.",
  "  2. cara present '<grouping>'    → persist your grouping; boots the human's browser",
  "                                         (--no-open to stay headless). A live review for this",
  "                                         context is refreshed in place, never duplicated.",
  "  3. cara dispatch [--wait]      → every open comment with its lifecycle + author, plus",
  "                                         any human Reshape request. --wait blocks for the human",
  "                                         and returns done / reviewInProgress / reviewIdle. Tune",
  "                                         with --timeout <seconds> and --idle-threshold <seconds>.",
  "  4. cara submit '<batch>'       → apply marks / comments / answers; returns a gap",
  "                                         report. Resubmit until every atom is accounted.",
  "",
  "Gating (CI, optional):",
  "  cara gate [--require …]        → role coverage over the ledger as a pass/fail bar,",
  "                                         e.g. --require security=100%,human>=50%. Exits non-zero",
  "                                         when unmet; no --require just prints coverage. Roles:",
  "                                         addressed, accounted, human, agent, or a reviewer label.",
  "",
  "Passing payloads: present and submit take their JSON inline ('{…}'), as a file path, or from",
  "stdin with '-'. The spec defaults to the worktree vs origin/main; pass --range <base>..<head>",
  "for a range (or the positional <base>..<head> form on atoms).",
  "",
  "Every verb prints JSON with a `next` hint. Your submissions are recorded as the agent tier",
  "(--reviewer <label> to distinguish lenses, or a `reviewer` field in the batch object —",
  "same lowercase-slug rule); the browser human is the human tier. Optionally attach a `meta`",
  "object to a submit batch (e.g. {\"model\":\"…\",\"thinking\":\"…\"}) — descriptive audit only,",
  "never gate-trusted.",
].join("\n");

// --- Help surfaces: the entry door for a cold agent (bare `cara` / `--help`) ---
// The banner names every verb and points at `cara instructions` (the full protocol +
// grouping rubric). Per-verb usage is a terse synopsis — the deep doc stays in
// `instructions`, so the two never duplicate the methodology.

/** The root banner: bare `cara`, `cara help`, `cara --help`. Orientation, then the signpost. */
export const HELP: string = [
  "cara — local-first, completeness-gated code review. git owns the changes; you (the agent)",
  "group them and drive the review. No API key needed for the protocol verbs.",
  "",
  "Usage: cara <verb> [args]",
  "",
  "Review protocol (run in order):",
  "  atoms                  the change set + the grouping methodology — the start of every review",
  "  present '<grouping>'   persist your Chapter/Section grouping; open the human's browser",
  "  dispatch [--wait]      open comments + any human reshape request; --wait blocks for the human",
  "  submit '<batch>'       apply marks / comments / answers; returns a gap report",
  "",
  "Other:",
  "  gate [--require …]     role coverage as a CI pass/fail bar (exits non-zero when unmet)",
  "  instructions           the full agent protocol + grouping rubric — read this first",
  "  review                 porcelain: cara groups and reviews for you (the only API-key path)",
  "",
  "Run `cara instructions` for the complete protocol, or `cara <verb> --help` for one verb.",
].join("\n");

/** Per-verb usage for `cara <verb> --help` / `cara help <verb>`. A synopsis, not the methodology. */
export const USAGE: Record<string, string> = {
  atoms: [
    `cara atoms [<base>..<head>] ${SPEC}`,
    "Emit the change set plus the grouping methodology — the first step of every review.",
    "Defaults to the worktree vs origin/main. Next: group, then cara present.",
  ].join("\n"),
  present: [
    `cara present '<grouping>' [--no-open] ${SPEC}`,
    "Persist your Chapter/Section grouping and boot the human's browser (--no-open stays headless).",
    `Every Chapter and Section needs a one-line summary. Payload: ${PAYLOAD}.`,
  ].join("\n"),
  dispatch: [
    `cara dispatch [--wait] [--timeout <seconds>] [--idle-threshold <seconds>] ${SPEC}`,
    "Every open comment (lifecycle + author) and any human reshape request.",
    "--wait blocks for the human and returns done / reviewInProgress / reviewIdle.",
  ].join("\n"),
  submit: [
    `cara submit '<batch>' [--reviewer <label>] ${SPEC}`,
    "Apply marks / comments / answers; returns a gap report. Resubmit until every atom is accounted.",
    `Recorded as the agent tier; --reviewer <label> distinguishes lenses. Payload: ${PAYLOAD}.`,
  ].join("\n"),
  gate: [
    `cara gate [--require <role>=<percent>%,…] [--repo] [--by-file] ${SPEC}`,
    "Role coverage as a pass/fail bar — exits non-zero when unmet; no --require prints coverage only.",
    "Roles: addressed, accounted, human, agent, or a reviewer label (e.g. security=100%,human>=50%).",
  ].join("\n"),
  instructions: [
    "cara instructions",
    "Print the full agent protocol and the Chapter/Section grouping rubric. No arguments.",
  ].join("\n"),
  review: [
    `cara review [<base>..<head>] [--headless] [--reviewer <label>]… [--fake]`,
    "Porcelain: cara groups and drives the review itself — the only path that uses an API key.",
    "--headless is autonomous (no browser); --reviewer adds a labelled lens; --fake uses the stub LLM.",
  ].join("\n"),
};
