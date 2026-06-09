// The five agent-facing verbs (ADR-0011, TN-26-027 §b). Each composes the LLM-free
// backend, drives one use-case, and prints a self-narrating JSON envelope (the
// `instructions` verb prints plain text). Plumbing only: no grouping/LLM config is ever
// read here (decision #7), and channel-inferred tiers are set structurally — a CLI
// `submit` is always the agent tier, never forgeable to human.

import { homedir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import type {
  AtomHash,
  ClockPort,
  ConfigPort,
  Disposition,
  DiffSpec,
  ReviewContext,
  SubmitBatch,
} from "@clear-diff/core";
import { buildMethodology } from "@clear-diff/core";
import { FileInstructions } from "../instructions.ts";
import { composeCore, composeOverrides } from "../server/compose.ts";
import { emit, NEXT, parseJson, readPayload, VERB_REFERENCE, type CliIo } from "./output.ts";
import { CliError, type DispatchCommand, type PresentCommand, type SubmitCommand } from "./parse.ts";
import { groupingPath, isAlive, readDiscovery } from "./discovery.ts";
import { spawnDetachedServer } from "./serve.ts";
import { callWait } from "./wait.ts";

export interface VerbContext {
  readonly cwd: string;
  readonly stateDir: string;
  /** Home directory for the porcelain config + reviewer lenses (injected in tests). */
  readonly home: string;
  readonly io: CliIo;
  readonly config?: ConfigPort;
  readonly clock?: ClockPort;
  /** Boot the browser server for `present` (injected in tests; default = detached spawn). */
  readonly bootServer?: (cmd: PresentCommand, context: ReviewContext) => Promise<{ url: string }>;
}

/** The composition config for a verb, threading test overrides without `undefined` keys. */
function coreConfig(ctx: VerbContext, spec: DiffSpec) {
  return { cwd: ctx.cwd, spec, stateDir: ctx.stateDir, ...composeOverrides(ctx) };
}

export async function runAtoms(spec: DiffSpec, ctx: VerbContext): Promise<void> {
  const { service } = await composeCore(coreConfig(ctx, spec));
  const view = await service.getAtoms(spec);
  emit(ctx.io, { ...view, next: view.atoms.length === 0 ? NEXT.atomsEmpty : NEXT.atoms });
}

export async function runPresent(cmd: PresentCommand, ctx: VerbContext): Promise<void> {
  const { service } = await composeCore(coreConfig(ctx, cmd.spec));
  const raw = await readPayload(cmd.grouping, ctx.io);
  const grouping = parseJson(raw);
  const snapshot = await service.presentGrouping(cmd.spec, grouping);
  const context = snapshot.context;

  // Persist the raw grouping so the detached server (or a record) can replay it.
  await mkdir(ctx.stateDir, { recursive: true });
  await writeFile(groupingPath(ctx.stateDir, context), raw, "utf8");

  if (!cmd.open) {
    emit(ctx.io, { context, opened: false, progress: snapshot.progress, next: NEXT.presentNoOpen });
    return;
  }
  const boot =
    ctx.bootServer ??
    ((c: PresentCommand, id: ReviewContext) =>
      spawnDetachedServer({ cmd: c, context: id, stateDir: ctx.stateDir, cwd: ctx.cwd }));
  const { url } = await boot(cmd, context);
  emit(ctx.io, { context, opened: true, url, progress: snapshot.progress, next: NEXT.presentOpened });
}

export async function runDispatch(cmd: DispatchCommand, ctx: VerbContext): Promise<void> {
  const { service, diffSource } = await composeCore(coreConfig(ctx, cmd.spec));

  if (!cmd.wait) {
    const view = await service.dispatch(cmd.spec);
    emit(ctx.io, { ...view, next: NEXT.dispatch });
    return;
  }

  const context = await diffSource.resolveContext(cmd.spec);
  const info = await readDiscovery(ctx.stateDir, context);
  if (info === null || !isAlive(info.pid)) {
    // No live browser session to wait on — autonomous, or the human already closed.
    // Settle from the store immediately (ADR-0011 §4).
    const view = await service.dispatch(cmd.spec);
    emit(ctx.io, { state: "done", context, comments: view.comments, progress: view.progress, next: NEXT.waitDone });
    return;
  }

  // Seconds → whole milliseconds: the server's `wait` input is integer ms, so a
  // fractional `--timeout`/`--idle-threshold` must round here, not reach the wire raw.
  const opts: { maxBlockMs?: number; idleMs?: number } = {};
  if (cmd.timeoutS !== null) opts.maxBlockMs = Math.round(cmd.timeoutS * 1000);
  if (cmd.idleThresholdS !== null) opts.idleMs = Math.round(cmd.idleThresholdS * 1000);
  const result = await callWait(info.url, context, opts);
  if (result.state === "done") {
    emit(ctx.io, { state: "done", context, comments: result.comments, progress: result.progress, next: NEXT.waitDone });
  } else if (result.state === "reviewInProgress") {
    emit(ctx.io, { state: "reviewInProgress", context, progress: result.progress, next: NEXT.waitInProgress });
  } else {
    emit(ctx.io, { state: "reviewIdle", context, progress: result.progress, next: NEXT.waitIdle });
  }
}

export async function runSubmit(cmd: SubmitCommand, ctx: VerbContext): Promise<void> {
  const { service, diffSource } = await composeCore(coreConfig(ctx, cmd.spec));
  const parsed = parseJson(await readPayload(cmd.batch, ctx.io));
  const record = asObject(parsed, "batch");
  const reviewer = cmd.reviewer ?? (typeof record["reviewer"] === "string" ? (record["reviewer"] as string) : null);

  const result = await service.submit(cmd.spec, coerceBatch(record), { tier: "agent", reviewer });
  const context = await diffSource.resolveContext(cmd.spec);
  const clean = result.gap.missing.length === 0;
  emit(ctx.io, {
    context,
    gap: result.gap,
    progress: result.progress,
    next: clean ? NEXT.submitClean(result.gap.total) : NEXT.submitGap(result.gap.missing.length),
  });
}

export async function runInstructions(ctx: VerbContext): Promise<void> {
  const instructions = await new FileInstructions(homedir(), ctx.cwd).load();
  ctx.io.write(`${buildMethodology(instructions)}\n\n${VERB_REFERENCE}\n`);
}

// --- Batch coercion: trust nothing the agent sends, fail loudly ----------------

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new CliError(`${label} must be a JSON array.`);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw new CliError(`${label} must be a non-empty string.`);
  return value;
}

function asDisposition(value: unknown, label: string): Disposition {
  if (value !== "done" && value !== "skipped") throw new CliError(`${label} must be "done" or "skipped".`);
  return value;
}

/** Coerce untrusted agent JSON into a SubmitBatch, validating every field. */
function coerceBatch(record: Record<string, unknown>): SubmitBatch {
  const batch: {
    marks?: { atomHash: AtomHash; disposition: Disposition }[];
    comments?: { atomHash: AtomHash; body: string }[];
    answers?: { commentId: string; answer: string }[];
  } = {};

  if (record["marks"] !== undefined) {
    batch.marks = asArray(record["marks"], "marks").map((m, i) => {
      const r = asObject(m, `marks[${i}]`);
      return {
        atomHash: asString(r["atomHash"], `marks[${i}].atomHash`) as AtomHash,
        disposition: asDisposition(r["disposition"], `marks[${i}].disposition`),
      };
    });
  }
  if (record["comments"] !== undefined) {
    batch.comments = asArray(record["comments"], "comments").map((c, i) => {
      const r = asObject(c, `comments[${i}]`);
      return {
        atomHash: asString(r["atomHash"], `comments[${i}].atomHash`) as AtomHash,
        body: asString(r["body"], `comments[${i}].body`),
      };
    });
  }
  if (record["answers"] !== undefined) {
    batch.answers = asArray(record["answers"], "answers").map((a, i) => {
      const r = asObject(a, `answers[${i}]`);
      return {
        commentId: asString(r["commentId"], `answers[${i}].commentId`),
        answer: asString(r["answer"], `answers[${i}].answer`),
      };
    });
  }
  return batch;
}
