// `clear-diff review` — the porcelain (ADR-0011). The bare invocation. It drives the
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
import type { AtomHash, CommentView, ConfigPort, ReviewContext, SubmitBatch } from "@clear-diff/core";
import { composeCore } from "../server/compose.ts";
import { contextHash } from "../review-store.ts";
import { loadPorcelainConfig, type PorcelainConfig } from "./config.ts";
import { AnthropicLlm } from "./llm.ts";
import { FakeLlm } from "./fake-llm.ts";
import type { LensFindings, PorcelainLlm } from "./llm.ts";
import { groupingPath, isAlive, readDiscovery } from "./discovery.ts";
import { spawnDetachedServer } from "./serve.ts";
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

const SHIPPED_LENSES: Record<string, string> = {
  security:
    "Review for security: injection, auth/authz gaps, secret handling, unsafe input, " +
    "path traversal, and untrusted-data flows. Flag concrete risks; skip the rest.",
  architecture:
    "Review for architecture: layer boundaries, dependency direction, separation of " +
    "concerns, leaky abstractions, and duplication. Flag structural problems; skip the rest.",
  quality:
    "Review for quality: correctness, clarity, dead code, error handling, and naming. " +
    "Flag real defects and confusing code; skip the rest.",
};

export async function runReview(cmd: ReviewCommand, ctx: PorcelainContext): Promise<void> {
  const config = await loadPorcelainConfig(ctx.home);
  const configPort: ConfigPort = { load: () => Promise.resolve({ editorCommand: config.editor.command }) };
  const { service } = await composeCore({
    cwd: ctx.cwd,
    spec: cmd.spec,
    stateDir: ctx.stateDir,
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
      "clear-diff review needs an [llm] block in ~/.clear-diff/config.toml (or pass --fake for the stub).",
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
  // cross-cutting mark breakdown in `progress.byReviewer` credits the *last* reviewer to
  // disposition each atom — marks are one-record-per-atom, so when two lenses mark the same
  // atom only the latest label is retained (see marks.reviewProgress).
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

  const grouping =
    llm === null
      ? floorGrouping(view.atoms.map((a) => a.hash))
      : await llm.group({ atoms: view.atoms, methodology: view.methodology });

  const snapshot = await service.presentGrouping(cmd.spec, grouping);
  const context = snapshot.context;

  // Persist the grouping so the detached server replays it (same path the `present` verb uses).
  await mkdir(ctx.stateDir, { recursive: true });
  await writeFile(groupingPath(ctx.stateDir, context), JSON.stringify(grouping), "utf8");

  const presentCmd: PresentCommand = { verb: "present", spec: cmd.spec, grouping: { kind: "stdin" }, open: true };
  const boot = ctx.bootServer ?? ((c, id) => spawnDetachedServer({ cmd: c, context: id, stateDir: ctx.stateDir, cwd: ctx.cwd }));
  await boot(presentCmd, context);

  const wait: ReviewWait = ctx.waitOnce ?? defaultWait(ctx.stateDir);
  for (let i = 0; i < MAX_WAIT_ITERS; i++) {
    const verdict = await wait(context);
    if (verdict.state === "closed" || verdict.state === "reviewIdle") break;
    if (verdict.state === "reviewInProgress") continue;
    // done — answer every open comment from its atom's diff, then loop (human may reopen).
    if (llm === null) break;
    const open = (await service.dispatch(cmd.spec)).comments.filter((c) => c.status === "open" && c.answer === null);
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
    next: "Review complete.",
  });
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

/** A reviewer lens: an override at `~/.clear-diff/reviewers/<label>.md`, else the shipped default. */
async function loadLens(home: string, label: string): Promise<string> {
  try {
    return await readFile(join(home, ".clear-diff", "reviewers", `${label}.md`), "utf8");
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
