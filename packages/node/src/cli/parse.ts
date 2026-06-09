// argv → a typed command (ADR-0011, TN-26-027 §b). The CLI is the agent's whole
// protocol surface: four plumbing verbs (`atoms`/`present`/`dispatch`/`submit`),
// the `instructions` reference, the `review` porcelain (bare invocation), and the
// internal `serve` boot the `present` verb spawns. Parsing is pure — no IO, no
// composition — so every verb's argument grammar is unit-testable in isolation.

import type { DiffSpec } from "@clear-diff/core";

/** A usage error. Carries a message fit to print to the user; no stack noise. */
export class CliError extends Error {}

/** A grouping/batch payload location: inline JSON, a file path, or stdin (`-`/omitted). */
export type PayloadSource =
  | { readonly kind: "inline"; readonly json: string }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "stdin" };

export interface AtomsCommand {
  readonly verb: "atoms";
  readonly spec: DiffSpec;
}
export interface PresentCommand {
  readonly verb: "present";
  readonly spec: DiffSpec;
  readonly grouping: PayloadSource;
  /** Boot the browser. `--no-open` persists the grouping only (autonomous). */
  readonly open: boolean;
}
export interface DispatchCommand {
  readonly verb: "dispatch";
  readonly spec: DiffSpec;
  readonly wait: boolean;
  /** Max seconds to block before returning `reviewInProgress` (`--timeout`). */
  readonly timeoutS: number | null;
  /** Idle seconds before returning `reviewIdle` (`--idle-threshold`). */
  readonly idleThresholdS: number | null;
}
export interface SubmitCommand {
  readonly verb: "submit";
  readonly spec: DiffSpec;
  readonly batch: PayloadSource;
  /** Agent reviewer label (`--reviewer`), e.g. "security"; null for an unlabelled pass. */
  readonly reviewer: string | null;
}
export interface InstructionsCommand {
  readonly verb: "instructions";
}
export interface ReviewCommand {
  readonly verb: "review";
  readonly spec: DiffSpec;
  /** Autonomous multi-reviewer mode (no browser). Implied when `--reviewer` is given. */
  readonly headless: boolean;
  /** Reviewer lenses for headless mode; empty = the shipped defaults. */
  readonly reviewers: readonly string[];
  /** Drive the deterministic stub LLM (tests / offline) instead of a real provider. */
  readonly fake: boolean;
}
/** Internal: the long-lived server `present` spawns (not advertised to agents). */
export interface ServeCommand {
  readonly verb: "serve";
  readonly spec: DiffSpec;
  readonly groupingPath: string;
  readonly openBrowser: boolean;
}

export type Command =
  | AtomsCommand
  | PresentCommand
  | DispatchCommand
  | SubmitCommand
  | InstructionsCommand
  | ReviewCommand
  | ServeCommand;

const VERBS = new Set(["atoms", "present", "dispatch", "submit", "instructions", "review", "serve"]);

/** Split argv into options (`--flag` / `--flag value`) and positionals, per a flag spec. */
interface Flags {
  readonly positional: readonly string[];
  readonly bool: ReadonlySet<string>;
  readonly value: ReadonlyMap<string, string>;
}

function splitFlags(argv: readonly string[], valueFlags: ReadonlySet<string>): Flags {
  const positional: string[] = [];
  const bool = new Set<string>();
  const value = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (valueFlags.has(name)) {
      const next = argv[i + 1];
      if (next === undefined) throw new CliError(`Option --${name} needs a value.`);
      value.set(name, next);
      i++;
    } else {
      bool.add(name);
    }
  }
  return { positional, bool, value };
}

function rejectUnknownBool(bool: ReadonlySet<string>, allowed: ReadonlySet<string>): void {
  for (const flag of bool) if (!allowed.has(flag)) throw new CliError(`Unknown option: --${flag}`);
}

/** A `<base>..<head>` range, or worktree when omitted. Shared by every verb's spec. */
function parseSpec(arg: string | undefined): DiffSpec {
  if (arg === undefined) return { kind: "worktree" };
  if (arg === "--pr" || arg.startsWith("--pr")) throw new CliError("clear-diff --pr is not yet supported.");
  // Exactly one ".." with non-empty sides. A second ".." (a..b..c) or a third dot
  // (the git three-dot form main...feature) is corrupt, not a two-dot range.
  const parts = arg.split("..");
  const base = parts[0] ?? "";
  const head = parts[1] ?? "";
  if (parts.length !== 2 || base === "" || head === "" || base.endsWith(".") || head.startsWith(".")) {
    throw new CliError(`Invalid range "${arg}". Use <base>..<head>.`);
  }
  return { kind: "range", base, head };
}

/** Read `--range <base..head>` (default worktree), rejecting a stray positional spec. */
function specFromRange(flags: Flags): DiffSpec {
  return parseSpec(flags.value.get("range"));
}

function payloadFromPositional(arg: string | undefined): PayloadSource {
  if (arg === undefined || arg === "-") return { kind: "stdin" };
  const trimmed = arg.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return { kind: "inline", json: arg };
  return { kind: "file", path: arg };
}

function positiveSeconds(raw: string | undefined, flag: string): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new CliError(`--${flag} must be a positive number of seconds.`);
  return n;
}

/**
 * argv (without node/script) → a Command. The first token is the verb; a bare
 * invocation (or a leading range) is the `review` porcelain. `--pr` is rejected.
 */
export function parseCommand(argv: readonly string[]): Command {
  const [first, ...rest] = argv;
  const verb = first !== undefined && VERBS.has(first) ? first : null;
  const args = verb === null ? argv : rest;

  switch (verb) {
    case "atoms": {
      const flags = splitFlags(args, new Set(["range"]));
      rejectUnknownBool(flags.bool, new Set());
      if (flags.positional.length > 1) throw new CliError("atoms takes at most one <base>..<head> argument.");
      // The documented positional form `atoms <range>` wins; `--range` is the uniform alias.
      return { verb: "atoms", spec: parseSpec(flags.positional[0] ?? flags.value.get("range")) };
    }
    case "present": {
      const flags = splitFlags(args, new Set(["range"]));
      rejectUnknownBool(flags.bool, new Set(["no-open"]));
      if (flags.positional.length > 1) throw new CliError("present takes at most one grouping argument.");
      return {
        verb: "present",
        spec: specFromRange(flags),
        grouping: payloadFromPositional(flags.positional[0]),
        open: !flags.bool.has("no-open"),
      };
    }
    case "dispatch": {
      const flags = splitFlags(args, new Set(["range", "timeout", "idle-threshold"]));
      rejectUnknownBool(flags.bool, new Set(["wait"]));
      if (flags.positional.length > 0) throw new CliError("dispatch takes no positional arguments.");
      return {
        verb: "dispatch",
        spec: specFromRange(flags),
        wait: flags.bool.has("wait"),
        timeoutS: positiveSeconds(flags.value.get("timeout"), "timeout"),
        idleThresholdS: positiveSeconds(flags.value.get("idle-threshold"), "idle-threshold"),
      };
    }
    case "submit": {
      const flags = splitFlags(args, new Set(["range", "reviewer"]));
      rejectUnknownBool(flags.bool, new Set());
      if (flags.positional.length > 1) throw new CliError("submit takes at most one batch argument.");
      return {
        verb: "submit",
        spec: specFromRange(flags),
        batch: payloadFromPositional(flags.positional[0]),
        reviewer: flags.value.get("reviewer") ?? null,
      };
    }
    case "instructions": {
      const flags = splitFlags(args, new Set());
      rejectUnknownBool(flags.bool, new Set());
      if (flags.positional.length > 0) throw new CliError("instructions takes no arguments.");
      return { verb: "instructions" };
    }
    case "serve": {
      const flags = splitFlags(args, new Set(["range", "grouping"]));
      rejectUnknownBool(flags.bool, new Set(["open-browser"]));
      const groupingPath = flags.value.get("grouping");
      if (groupingPath === undefined) throw new CliError("serve needs --grouping <path>.");
      return {
        verb: "serve",
        spec: specFromRange(flags),
        groupingPath,
        openBrowser: flags.bool.has("open-browser"),
      };
    }
    default:
      // Explicit `clear-diff review …`, or a bare `clear-diff [<base>..<head>]` → the
      // porcelain (axis c). `args` already drops a leading `review` verb token.
      return parseReview(args);
  }
}

/**
 * The porcelain's argv grammar. `--reviewer` repeats (one per lens), so it is parsed
 * by hand rather than through `splitFlags` (whose value map keeps only the last).
 */
function parseReview(argv: readonly string[]): ReviewCommand {
  const positional: string[] = [];
  const reviewers: string[] = [];
  let headless = false;
  let fake = false;
  let range: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "headless") headless = true;
    else if (name === "fake") fake = true;
    else if (name === "reviewer" || name === "range") {
      const value = argv[++i];
      if (value === undefined) throw new CliError(`Option --${name} needs a value.`);
      if (name === "reviewer") {
        // The label names a lens file (`~/.clear-diff/reviewers/<label>.md`); keep it to a
        // safe slug so it can never escape that directory.
        if (!/^[a-z0-9-]+$/.test(value)) throw new CliError("--reviewer must be a lowercase slug (a-z, 0-9, -).");
        reviewers.push(value);
      } else range = value;
    } else throw new CliError(`Unknown option: --${name}`);
  }
  if (positional.length > 1) throw new CliError("Expected a single <base>..<head> argument.");
  return { verb: "review", spec: parseSpec(positional[0] ?? range), headless, reviewers, fake };
}
