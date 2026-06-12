// `cara review` — the porcelain (ADR-0011), reached by `cara review` or a leading range. It drives the
// SAME LLM-free plumbing an external agent drives (getAtoms → grouping → present →
// dispatch/submit), but supplies the one LLM itself. Two modes:
//
//   • human-in-loop (default): group → boot the browser → wait for the human, answering
//     their open comments from the diff, until done/idle → export a comment file.
//   • headless `--headless [--reviewer …]`: N lens passes, each submitting agent-tier
//     marks/comments under its label, looping until the gap report is clean → JSON summary.
//
// The LLM is reached only through the `PorcelainLlm` interface, so a stub drives the whole
// loop in tests with no network. LLM output is untrusted: groupings go through the core's
// repairGrouping, and findings/answers are sanitized here before submit.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AtomHash,
  AtomsView,
  CommentView,
  ConfigPort,
  ReviewContext,
  ReviewSnapshot,
  SubmitBatch,
} from "@cara/core";
import { SummariesRequiredError } from "@cara/core";
import { composeCore } from "../server/compose.ts";
import { contextHash } from "../context-hash.ts";
import { loadPorcelainConfig, type PorcelainConfig } from "./config.ts";
import { AnthropicLlm, describeMissingSummaries } from "./llm.ts";
import { FakeLlm } from "./fake-llm.ts";
import type { GroupingRequest, LensFindings, PorcelainLlm } from "./llm.ts";
import { groupingPath, isAlive, readDiscovery, removeDiscovery } from "./discovery.ts";
import { spawnDetachedServer } from "./serve.ts";
import { handReshapeToServer } from "./reshape-client.ts";
import { callWait } from "./wait.ts";
import { emit } from "./output.ts";
import { CliError, type PresentCommand, type ReviewCommand } from "./parse.ts";
import type { VerbContext } from "./verbs.ts";

/** Wait once on the human's session. `closed` = the browser/server is gone — settle now. */
export type ReviewWait = (
  context: ReviewContext,
) => Promise<
  | { readonly state: "done" | "reviewInProgress" | "reviewIdle"; readonly progress?: unknown }
  | { readonly state: "closed" }
>;

/**
 * The porcelain's context: the plumbing `VerbContext` plus the LLM/wait seams only the
 * `review` path uses. Keeping these off `VerbContext` keeps the plumbing verbs' type free
 * of any LLM-shaped dependency (the boundary the dynamic import already draws at runtime).
 */
export interface PorcelainContext extends VerbContext {
  /** Porcelain LLM override (tests / `--fake` resolution lives below). */
  readonly makeLlm?: () => PorcelainLlm;
  /** Porcelain wait override for the human-in-loop poll (injected in tests). */
  readonly waitOnce?: ReviewWait;
}

const DEFAULT_REVIEWERS = ["security", "architecture", "quality"] as const;
const MAX_ROUNDS = 3;
const MAX_WAIT_ITERS = 100;
const MAX_BODY = 4_000;

// Each lens runs the methodology's two stages (per-change sweep, then seams) through its own concern.
const SHIPPED_LENSES: Record<string, string> = {
  security:
    "Review for security in two stages. Sweep: per change, flag injection, auth/authz gaps, " +
    "secret handling, unsafe input, path traversal, untrusted-data flows. Seams: trace untrusted " +
    "data across changed boundaries and hunt missing validation, bounds, or sanitisation the " +
    "change should have added. Flag concrete risks; skip the rest.",
  architecture:
    "Review for architecture in two stages. Sweep: per change, flag layer-boundary and " +
    "dependency-direction breaks, leaky abstractions, duplication. Seams: trace contracts between " +
    "changed components and symmetric surfaces where one side changed but its mirror did not. " +
    "Flag structural problems; skip the rest.",
  quality:
    "Review for quality in two stages. Sweep: per change, flag correctness bugs, unclear code, " +
    "dead code, error handling, naming. Seams: trace caller↔callee across changed files and hunt " +
    "missing error paths, cleanup, or timeouts the change should have added. Flag real defects " +
    "and confusing code; skip the rest.",
};

export async function runReview(cmd: ReviewCommand, ctx: PorcelainContext): Promise<void> {
  const config = await loadPorcelainConfig(ctx.home);
  const configPort: ConfigPort = { load: () => Promise.resolve({ editorCommand: config.editor.command }) };
  const { service } = await composeCore({
    cwd: ctx.cwd,
    spec: cmd.spec,
    config: configPort,
    ...(ctx.clock ? { clock: ctx.clock } : {}),
  });

  const headless = cmd.headless || cmd.reviewers.length > 0;
  if (headless) return runHeadless(cmd, ctx, config, service);
  return runHumanLoop(cmd, ctx, config, service);
}

type Service = Awaited<ReturnType<typeof composeCore>>["service"];

/** Construct the LLM: a test override, the `--fake` stub, or the real Anthropic client. */
function resolveLlm(cmd: ReviewCommand, ctx: PorcelainContext, config: PorcelainConfig): PorcelainLlm {
  if (ctx.makeLlm) return ctx.makeLlm();
  if (cmd.fake) return new FakeLlm();
  if (config.llm === null) {
    throw new CliError(
      "cara review needs an [llm] block in ~/.cara/config.toml (or pass --fake for the stub).",
    );
  }
  return new AnthropicLlm({ model: config.llm.model, apiKeyEnv: config.llm.apiKeyEnv });
}

// --- Headless multi-reviewer ----------------------------------------------------

async function runHeadless(cmd: ReviewCommand, ctx: PorcelainContext, config: PorcelainConfig, service: Service): Promise<void> {
  const view = await service.getAtoms(cmd.spec);
  const known = new Set(view.atoms.map((a) => a.hash));
  const reviewers = cmd.reviewers.length > 0 ? cmd.reviewers : [...DEFAULT_REVIEWERS];
  const llm = view.atoms.length === 0 ? null : resolveLlm(cmd, ctx, config);

  if (llm !== null) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      for (const reviewer of reviewers) {
        // One review() call covers both methodology stages (sweep + seams) for this lens; findings
        // land via submit, so cross-cutting seam findings are accounted like any other.
        const lens = await loadLens(ctx.home, reviewer);
        const findings = await llm.review({ atoms: view.atoms, methodology: view.methodology, lens });
        const batch = sanitizeFindings(findings, known);
        if (batch.marks?.length || batch.comments?.length) {
          await service.submit(cmd.spec, batch, { tier: "agent", reviewer });
        }
      }
      const probe = await service.submit(cmd.spec, {}, { tier: "agent", reviewer: null });
      if (probe.gap.missing.length === 0) break;
    }
  }

  const result = await service.submit(cmd.spec, {}, { tier: "agent", reviewer: null });
  const dispatch = await service.dispatch(cmd.spec);
  // Per-reviewer comments are attributable precisely (each carries its author label). The
  // cross-cutting mark breakdown in `progress.byReviewer` credits EVERY reviewer label that
  // dispositioned each atom — coverage folds the event log by existence, so when two lenses
  // mark the same atom both are counted (see marks.coverageProgress).
  emit(ctx.io, {
    context: dispatch.context,
    gap: result.gap,
    progress: result.progress,
    reviewers: reviewers.map((reviewer) => ({
      reviewer,
      comments: dispatch.comments
        .filter((c) => c.reviewer === reviewer)
        .map((c) => ({ atomHash: c.atomHash, path: c.path, lineRange: c.lineRange, body: c.body })),
    })),
    next:
      result.gap.missing.length === 0
        ? `All ${result.gap.total} accounted across ${reviewers.length} reviewer(s).`
        : `${result.gap.missing.length} atoms unaccounted after ${MAX_ROUNDS} rounds.`,
  });
}

// --- Human-in-loop --------------------------------------------------------------

async function runHumanLoop(cmd: ReviewCommand, ctx: PorcelainContext, config: PorcelainConfig, service: Service): Promise<void> {
  const view = await service.getAtoms(cmd.spec);

  // An LLM exists when the user opted into it (mode "llm"), or a stub is injected. In
  // git-order mode with no stub there is no LLM: floor the grouping, and the human (not
  // the porcelain) answers their own comments.
  const useLlm = config.grouping.mode === "llm" || cmd.fake || ctx.makeLlm !== undefined;
  const llm: PorcelainLlm | null = useLlm ? resolveLlm(cmd, ctx, config) : null;

  const notices: string[] = [];
  const initial = await buildGrouping(service, cmd, llm, view, null);
  if (initial.warning) notices.push(initial.warning);
  const context = initial.snapshot.context;
  await showGrouping(ctx, cmd, context, initial.grouping, initial.requireSummaries);

  const wait: ReviewWait = ctx.waitOnce ?? defaultWait(ctx.stateDir);
  for (let i = 0; i < MAX_WAIT_ITERS; i++) {
    const verdict = await wait(context);
    if (verdict.state === "closed" || verdict.state === "reviewIdle") break;
    if (verdict.state === "reviewInProgress") continue;
    // done. Only the LLM path acts further (git-order leaves the human to self-answer).
    if (llm === null) break;
    const dispatch = await service.dispatch(cmd.spec);

    // A human reshape request (ADR-0012 §3) takes priority: re-group per their note and
    // live-refresh the open browser (showGrouping hands off to the live server), which
    // appends a `presented` event and clears the request. The atoms are unchanged — only
    // the grouping moves — so reuse `view`. Keep waiting.
    if (dispatch.reshape !== null) {
      const reshaped = await buildGrouping(service, cmd, llm, view, dispatch.reshape);
      if (reshaped.warning) notices.push(reshaped.warning);
      await showGrouping(ctx, cmd, context, reshaped.grouping, reshaped.requireSummaries);
      continue;
    }

    // Otherwise answer every open comment from its atom's diff, then loop (human may reopen).
    const open = dispatch.comments.filter((c) => c.status === "open" && c.answer === null);
    if (open.length === 0) break;
    const answers: { commentId: string; answer: string }[] = [];
    for (const comment of open) {
      const atom = view.atoms.find((a) => a.hash === comment.atomHash);
      const body = await llm.answer({
        atoms: atom ? [atom] : [],
        methodology: view.methodology,
        question: comment.body,
      });
      answers.push({ commentId: comment.id, answer: body.slice(0, MAX_BODY) });
    }
    await service.submit(cmd.spec, { answers }, { tier: "agent", reviewer: null });
  }

  const dispatch = await service.dispatch(cmd.spec);
  const file = await exportComments(ctx.stateDir, context, dispatch.comments);
  emit(ctx.io, {
    context,
    progress: dispatch.progress,
    comments: dispatch.comments.length,
    commentFile: file,
    ...(notices.length ? { notices } : {}),
    next: "Review complete.",
  });
}

/**
 * Build a validated grouping + its snapshot. The git-order floor carries no summaries and is
 * exempt (ADR-0012 §1). The LLM path must supply them: on a `SummariesRequiredError` it retries
 * the grouping call once, then falls to the floor with a surfaced notice (no silent loss). A
 * non-null `reshape` is folded into the grouping prompt as the human's request (ADR-0012 §3).
 *
 * Returns the gate decision (`requireSummaries`) the serving process must re-apply: `false`
 * for the floor (both the no-LLM path and the misses-twice fallback) so it is never re-rejected
 * on the boot/handoff; `true` for a validated agent grouping.
 */
async function buildGrouping(
  service: Service,
  cmd: ReviewCommand,
  llm: PorcelainLlm | null,
  view: AtomsView,
  reshape: string | null,
): Promise<{ grouping: unknown; snapshot: ReviewSnapshot; warning: string | null; requireSummaries: boolean }> {
  if (llm === null) {
    const grouping = floorGrouping(view.atoms.map((a) => a.hash));
    const snapshot = await service.presentGrouping(cmd.spec, grouping, { requireSummaries: false });
    return { grouping, snapshot, warning: null, requireSummaries: false };
  }
  let req: GroupingRequest = { atoms: view.atoms, methodology: view.methodology, ...(reshape !== null ? { reshape } : {}) };
  for (let attempt = 0; attempt < 2; attempt++) {
    const grouping = await llm.group(req);
    try {
      const snapshot = await service.presentGrouping(cmd.spec, grouping, { requireSummaries: true });
      return { grouping, snapshot, warning: null, requireSummaries: true };
    } catch (error) {
      if (!(error instanceof SummariesRequiredError)) throw error;
      // Don't resend an identical request — name the chapters/sections left blank so the retry
      // converges instead of repeating the omission (A/B finding 11). A second miss floors below.
      req = { ...req, summaryReminder: describeMissingSummaries(grouping, error.missing) };
    }
  }
  const grouping = floorGrouping(view.atoms.map((a) => a.hash));
  const snapshot = await service.presentGrouping(cmd.spec, grouping, { requireSummaries: false });
  return {
    grouping,
    snapshot,
    warning: "LLM grouping omitted required summaries twice; fell back to the git-order floor.",
    requireSummaries: false,
  };
}

/**
 * Persist the grouping and route it to the single server for this context (ADR-0012 §4),
 * mirroring `runPresent`'s decision tree: a live server gets the new grouping via the
 * live-refresh hand-off (marks intact); a stale record is cleaned and we boot; with no record
 * we boot. Never two servers for one context. `requireSummaries` (ADR-0012 §1) rides through both
 * the handoff and the boot so the floor — exempt — is never rejected by the serving process.
 */
async function showGrouping(
  ctx: PorcelainContext,
  cmd: ReviewCommand,
  context: ReviewContext,
  grouping: unknown,
  requireSummaries: boolean,
): Promise<void> {
  await mkdir(ctx.stateDir, { recursive: true });
  await writeFile(groupingPath(ctx.stateDir, context), JSON.stringify(grouping), "utf8");

  const info = await readDiscovery(ctx.stateDir, context);
  if (info !== null && isAlive(info.pid)) {
    const handoff = ctx.handoff ?? handReshapeToServer;
    await handoff(info.url, context, grouping, requireSummaries);
    return;
  }
  if (info !== null) await removeDiscovery(ctx.stateDir, context);
  const presentCmd: PresentCommand = { verb: "present", spec: cmd.spec, grouping: { kind: "stdin" }, open: true };
  const boot =
    ctx.bootServer ??
    ((c, id, gate) => spawnDetachedServer({ cmd: c, context: id, stateDir: ctx.stateDir, cwd: ctx.cwd, requireSummaries: gate }));
  await boot(presentCmd, context, requireSummaries);
}

/** Production wait: read server discovery, settle if the browser is gone, else block. */
function defaultWait(stateDir: string): ReviewWait {
  return async (context) => {
    const info = await readDiscovery(stateDir, context);
    if (info === null || !isAlive(info.pid)) return { state: "closed" };
    const result = await callWait(info.url, context, {});
    return result.state === "done"
      ? { state: "done", progress: result.progress }
      : { state: result.state, progress: result.progress };
  };
}

// --- Shared helpers -------------------------------------------------------------

/** A single "Other changes" chapter over every atom in git order. The git-order floor. */
function floorGrouping(hashes: readonly string[]): unknown {
  return { chapters: [{ title: "Other changes", sections: [{ title: "Changes", atomHashes: hashes }] }] };
}

/** Drop findings that name an unknown atom or a bad disposition; cap comment length. */
function sanitizeFindings(findings: LensFindings, known: ReadonlySet<string>): SubmitBatch {
  const marks = findings.marks
    .filter((m) => known.has(m.atomHash) && (m.disposition === "done" || m.disposition === "skipped"))
    .map((m) => ({ atomHash: m.atomHash as AtomHash, disposition: m.disposition }));
  const comments = findings.comments
    .filter((c) => known.has(c.atomHash) && typeof c.body === "string" && c.body.trim() !== "")
    .map((c) => ({ atomHash: c.atomHash as AtomHash, body: c.body.slice(0, MAX_BODY) }));
  const batch: { marks?: typeof marks; comments?: typeof comments } = {};
  if (marks.length) batch.marks = marks;
  if (comments.length) batch.comments = comments;
  return batch;
}

/** A reviewer lens: an override at `~/.cara/reviewers/<label>.md`, else the shipped default. */
async function loadLens(home: string, label: string): Promise<string> {
  try {
    return await readFile(join(home, ".cara", "reviewers", `${label}.md`), "utf8");
  } catch {
    return SHIPPED_LENSES[label] ?? `Review the changes for ${label} concerns.`;
  }
}

/** Compose a standalone markdown comment file from the dispatch view, for the human-in-loop path. */
async function exportComments(stateDir: string, context: ReviewContext, comments: readonly CommentView[]): Promise<string> {
  const path = join(stateDir, `${contextHash(context)}.comments.md`);
  const body = comments
    .map((c) => `## ${c.path}:${c.lineRange.start}\n\n${c.body}${c.answer ? `\n\n> ${c.answer}` : ""}`)
    .join("\n\n");
  await writeFile(path, `${body}\n`, "utf8");
  return path;
}
