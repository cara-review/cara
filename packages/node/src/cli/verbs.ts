// The agent-facing verbs (ADR-0011). Each composes the LLM-free backend, drives one
// use-case, and prints a self-narrating JSON envelope (the `instructions` verb prints
// plain text). `gate` lives alongside in its own module (gate.ts). Plumbing only: no
// grouping/LLM config is ever read here, and channel-inferred tiers are set structurally —
// a CLI `submit` is always the agent tier, never forgeable to human.

import { homedir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import type {
  AtomHash,
  ClockPort,
  CommentLinePointer,
  ConfigPort,
  Disposition,
  DiffSpec,
  FactMeta,
  ReviewContext,
  SubmitBatch,
} from "@cara/core";
import { buildMethodology, SummariesRequiredError } from "@cara/core";
import { FileInstructions } from "../instructions.ts";
import { composeCore, composeOverrides } from "../server/compose.ts";
import { emit, NEXT, parseJson, readPayload, VERB_REFERENCE, type CliIo } from "./output.ts";
import { CliError, reviewerSlug, type DispatchCommand, type PresentCommand, type SubmitCommand } from "./parse.ts";
import { groupingPath, isAlive, readDiscovery, removeDiscovery } from "./discovery.ts";
import { spawnDetachedServer } from "./serve.ts";
import { handReshapeToServer } from "./reshape-client.ts";
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
  readonly bootServer?: (
    cmd: PresentCommand,
    context: ReviewContext,
    requireSummaries: boolean,
  ) => Promise<{ url: string }>;
  /** Hand a new grouping to a live server for `present` (injected in tests; default = WS client). */
  readonly handoff?: (
    url: string,
    context: ReviewContext,
    grouping: unknown,
    requireSummaries: boolean,
  ) => Promise<void>;
}

/** The composition config for a verb, threading test overrides without `undefined` keys. */
export function coreConfig(ctx: VerbContext, spec: DiffSpec) {
  return { cwd: ctx.cwd, spec, ...composeOverrides(ctx) };
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

  // The summary gate (ADR-0012 §1) runs here, before any boot/hand-off, so a
  // grouping missing a summary is rejected with no browser churn — exit code stays
  // boring (a usage envelope, not a failure). The live-server path re-validates as a
  // backstop on the untrusted handover, but a valid grouping never reaches it short.
  let snapshot;
  try {
    snapshot = await service.presentGrouping(cmd.spec, grouping);
  } catch (error) {
    if (error instanceof SummariesRequiredError) {
      emit(ctx.io, { error: "summaries_required", missing: error.missing, next: NEXT.summariesRequired });
      return;
    }
    throw error;
  }
  const context = snapshot.context;

  // Persist the raw grouping so the detached server (or a record) can replay it.
  await mkdir(ctx.stateDir, { recursive: true });
  await writeFile(groupingPath(ctx.stateDir, context), raw, "utf8");

  if (!cmd.open) {
    emit(ctx.io, { context, opened: false, progress: snapshot.progress, next: NEXT.presentNoOpen });
    return;
  }

  // Single server per context (ADR-0012 §4): a live server gets the new grouping
  // (live-refresh, marks intact) rather than a sibling; a stale record is cleaned and
  // we boot; with no record we boot. Never two servers for one context. The check→act is
  // lock-free: two simultaneous presents racing the empty state may both boot (last
  // writer's discovery wins) — accepted (TN-26-028 edge cases), as marks are
  // order-independent (ADR-0005) and the handover is idempotent.
  // An agent `present` is always summary-gated above (line 64), so a grouping that reaches a
  // re-present here has already passed — the floor exemption is internal to the porcelain
  // (review.ts), never the agent verb. Thread `true` so the serving process re-gates identically.
  const info = await readDiscovery(ctx.stateDir, context);
  if (info !== null && isAlive(info.pid)) {
    const handoff = ctx.handoff ?? handReshapeToServer;
    await handoff(info.url, context, grouping, true);
    emit(ctx.io, { context, opened: true, reshaped: true, url: info.url, progress: snapshot.progress, next: NEXT.presentReshaped });
    return;
  }
  if (info !== null) await removeDiscovery(ctx.stateDir, context);

  const boot =
    ctx.bootServer ??
    ((c: PresentCommand, id: ReviewContext, requireSummaries: boolean) =>
      spawnDetachedServer({ cmd: c, context: id, stateDir: ctx.stateDir, cwd: ctx.cwd, requireSummaries }));
  const { url } = await boot(cmd, context, true);
  emit(ctx.io, { context, opened: true, url, progress: snapshot.progress, next: NEXT.presentOpened });
}

export async function runDispatch(cmd: DispatchCommand, ctx: VerbContext): Promise<void> {
  const { service, diffSource } = await composeCore(coreConfig(ctx, cmd.spec));

  if (!cmd.wait) {
    const view = await service.dispatch(cmd.spec);
    emit(ctx.io, { ...view, next: dispatchNext(view.reshape) });
    return;
  }

  const context = await diffSource.resolveContext(cmd.spec);
  const info = await readDiscovery(ctx.stateDir, context);
  if (info === null || !isAlive(info.pid)) {
    // No live browser session to wait on — autonomous, or the human already closed.
    // A dead pid is a stale record; clean it so the next caller doesn't re-probe it.
    if (info !== null) await removeDiscovery(ctx.stateDir, context);
    // Settle from the store immediately (ADR-0011 §4).
    const view = await service.dispatch(cmd.spec);
    emit(ctx.io, {
      state: "done",
      context,
      comments: view.comments,
      progress: view.progress,
      reshape: view.reshape,
      next: view.reshape !== null ? NEXT.reshape(view.reshape) : NEXT.waitDone,
    });
    return;
  }

  // Seconds → whole milliseconds: the server's `wait` input is a positive integer
  // ms, so a fractional `--timeout`/`--idle-threshold` must round here, not reach the
  // wire raw. Floor at 1ms so a sub-millisecond value can't round to 0 and be rejected.
  const opts: { maxBlockMs?: number; idleMs?: number } = {};
  if (cmd.timeoutS !== null) opts.maxBlockMs = Math.max(1, Math.round(cmd.timeoutS * 1000));
  if (cmd.idleThresholdS !== null) opts.idleMs = Math.max(1, Math.round(cmd.idleThresholdS * 1000));
  const result = await callWait(info.url, context, opts);
  if (result.state === "done") {
    emit(ctx.io, {
      state: "done",
      context,
      comments: result.comments,
      progress: result.progress,
      reshape: result.reshape,
      next: result.reshape !== null ? NEXT.reshape(result.reshape) : NEXT.waitDone,
    });
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
  const reviewer = cmd.reviewer ?? (typeof record["reviewer"] === "string" ? reviewerSlug(record["reviewer"]) : null);

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

/** `dispatch`'s next hint: a pending human Reshape redirects the agent to re-present. */
function dispatchNext(reshape: string | null): string {
  return reshape !== null ? NEXT.reshape(reshape) : NEXT.dispatch;
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

/** Max length for a free-text body/answer, mirroring the browser channel's cap (router.ts). */
const MAX_BODY = 4000;

function asBoundedString(value: unknown, label: string): string {
  const text = asString(value, label);
  if (text.length > MAX_BODY) throw new CliError(`${label} is too long (max ${MAX_BODY} characters).`);
  return text;
}

function asDisposition(value: unknown, label: string): Disposition {
  if (value !== "done" && value !== "skipped") throw new CliError(`${label} must be "done" or "skipped".`);
  return value;
}

/** Max length for a line pointer's content — one source line, bounded like the browser channel. */
const MAX_LINE_TEXT = 1000;

/**
 * Coerce an optional within-hunk line pointer (ADR-0012 §2): content + side, never a number.
 * The agent's pointer is first-class — validated here so a documented port capability is no
 * longer silently dropped. Absent → undefined; malformed → fail loudly (the file's contract).
 */
function asLinePointer(value: unknown, label: string): CommentLinePointer | undefined {
  if (value === undefined) return undefined;
  const r = asObject(value, label);
  const side = r["side"];
  if (side !== "added" && side !== "removed") throw new CliError(`${label}.side must be "added" or "removed".`);
  const text = asString(r["text"], `${label}.text`);
  if (text.length > MAX_LINE_TEXT) throw new CliError(`${label}.text is too long (max ${MAX_LINE_TEXT} characters).`);
  return { side, text };
}

/** Bounds on descriptive `meta` (ADR-0015 §3): input-hardening so an audit field can't bloat or forge a log line. */
const MAX_META_ENTRIES = 12;
const MAX_META_KEY = 40;
const MAX_META_VALUE = 200;

/**
 * Coerce an optional batch-level `meta` (ADR-0015): a flat string→string map, bounded, with
 * slug keys and printable values (no control characters — values reach terminal/CI logs).
 * Empty ⇒ undefined (omit the field). Never interpreted by core; never gate-trusted.
 */
function coerceMeta(value: unknown): FactMeta | undefined {
  if (value === undefined) return undefined;
  const record = asObject(value, "meta");
  const entries = Object.entries(record);
  if (entries.length === 0) return undefined;
  if (entries.length > MAX_META_ENTRIES) throw new CliError(`meta has too many entries (max ${MAX_META_ENTRIES}).`);
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!/^[a-z0-9-]+$/.test(key) || key.length > MAX_META_KEY) {
      throw new CliError(`meta key "${key}" must be a lowercase slug (a-z, 0-9, -) up to ${MAX_META_KEY} chars.`);
    }
    if (typeof raw !== "string") throw new CliError(`meta.${key} must be a string.`);
    if (raw.length > MAX_META_VALUE) throw new CliError(`meta.${key} is too long (max ${MAX_META_VALUE} characters).`);
    if ([...raw].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) {
      throw new CliError(`meta.${key} must not contain control characters.`);
    }
    out[key] = raw;
  }
  return out;
}

/** Coerce untrusted agent JSON into a SubmitBatch, validating every field. */
function coerceBatch(record: Record<string, unknown>): SubmitBatch {
  const meta = coerceMeta(record["meta"]);
  const batch: {
    marks?: { atomHash: AtomHash; disposition: Disposition }[];
    comments?: { atomHash: AtomHash; body: string; line?: CommentLinePointer }[];
    answers?: { commentId: string; answer: string }[];
    meta?: FactMeta;
  } = { ...(meta ? { meta } : {}) };

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
      const line = asLinePointer(r["line"], `comments[${i}].line`);
      return {
        atomHash: asString(r["atomHash"], `comments[${i}].atomHash`) as AtomHash,
        body: asBoundedString(r["body"], `comments[${i}].body`),
        ...(line ? { line } : {}),
      };
    });
  }
  if (record["answers"] !== undefined) {
    batch.answers = asArray(record["answers"], "answers").map((a, i) => {
      const r = asObject(a, `answers[${i}]`);
      return {
        commentId: asString(r["commentId"], `answers[${i}].commentId`),
        answer: asBoundedString(r["answer"], `answers[${i}].answer`),
      };
    });
  }
  return batch;
}
