// `cara gate` (ADR-0013, ADR-0014): the ledger IS the gate. A read-only plumbing verb that
// recomputes live coverage over the canonical master list (the bijection is the denominator —
// ADR-0004), evaluates `--require` role predicates, and exits non-zero when the bar is not met.
//
// Two modes over the same predicate evaluator + envelope:
//   default   — coverage of THIS review's context (the current diff).
//   --repo    — coverage against the cross-context fact union (ADR-0014): content reviewed under
//               ANY context counts, measured over a baseline→target range. --by-file adds the
//               per-file dark-matter map. Advisory at repo scale (unsigned, baseline-scoped — §7).
//
// Roles a predicate may name:
//   addressed | accounted | human | agent | <tier>:commented | <reviewer-label>   (all / total)
// Coverage is exact (met/total ≥ threshold/100). Exit: 0 met, 1 not met, 2 indeterminate.

import type { DiffSpec, ReviewProgress } from "@cara/core";
import { UserFacingError } from "../user-facing-error.ts";
import { composeCore } from "../server/compose.ts";
import { coreConfig, type VerbContext } from "./verbs.ts";
import { emit, NEXT } from "./output.ts";
import type { GateCommand, GateRequirement } from "./parse.ts";

/** Gate not met — the bar wasn't cleared. Exit 1. */
export class GateNotMetError extends UserFacingError {
  readonly exitCode = 1;
}

/** Repo gate over an empty range — almost always a misconfigured baseline/target (ADR-0014 §7). Exit 2. */
export class GateIndeterminateError extends UserFacingError {
  readonly exitCode = 2;
}

interface RequirementResult {
  readonly role: string;
  readonly threshold: number;
  readonly percent: number;
  readonly met: number;
  readonly total: number;
  readonly pass: boolean;
}

export async function runGate(cmd: GateCommand, ctx: VerbContext): Promise<void> {
  const { service } = await composeCore(coreConfig(ctx, cmd.spec));
  return cmd.repo ? runRepoGate(cmd, ctx, service) : runContextGate(cmd, ctx, service);
}

/** Default: coverage of this review's own context. */
async function runContextGate(cmd: GateCommand, ctx: VerbContext, service: ReviewBackend): Promise<void> {
  // Read-only: `dispatch` recomputes the live master list and folds the ledger into `progress`.
  const { context, progress } = await service.dispatch(cmd.spec);
  const requirements = cmd.requirements.map((req) => evaluate(req, progress));
  const pass = requirements.every((r) => r.pass);
  const surplus = await crossContextSurplus(service, cmd.spec, progress);
  emit(ctx.io, {
    context,
    pass,
    trust: "advisory-unsigned",
    coverage: coverageSummary(progress, cmd.requirements),
    requirements,
    progress,
    next:
      surplus > 0
        ? NEXT.gateCrossContext(surplus)
        : gateNext(cmd.requirements.length, pass, requirements.filter((r) => !r.pass)),
  });
  if (!pass) throw new GateNotMetError(failSummary(requirements.filter((r) => !r.pass)));
}

/**
 * Atoms this context leaves unaddressed that the cross-context ledger union *would* credit.
 * The self-narration guard (ADR-0011): a context gate at 0% while the ledger holds full
 * coverage — facts recorded under each reviewer's own worktree context — reads as "reviews
 * never landed" and sends the agent hunting a non-bug. When this context misses atoms the
 * repo-wide fold covers, the `next` hint points at `--repo` (advisory at repo scale, §7).
 * Only runs when the context gate is already incomplete — a fully-addressed gate pays nothing.
 */
async function crossContextSurplus(service: ReviewBackend, spec: DiffSpec, progress: ReviewProgress): Promise<number> {
  if (progress.addressed >= progress.total) return 0;
  const repo = await service.repoCoverage(spec);
  return Math.max(0, repo.progress.addressed - progress.addressed);
}

/** `--repo`: coverage against the cross-context fact union over a baseline→target range (ADR-0014). */
async function runRepoGate(cmd: GateCommand, ctx: VerbContext, service: ReviewBackend): Promise<void> {
  const { context, progress, byFile } = await service.repoCoverage(cmd.spec);

  // An empty net range is indeterminate, never a silent green (ADR-0014 §7).
  if (progress.total === 0) {
    emit(ctx.io, { context, repo: true, pass: null, indeterminate: true, trust: "advisory-unsigned", progress, next: NEXT.gateIndeterminate });
    throw new GateIndeterminateError(
      "Repo gate indeterminate: the range resolved to no introduced content. Check --range <baseline>..<target>.",
    );
  }

  const requirements = cmd.requirements.map((req) => evaluate(req, progress));
  const pass = requirements.every((r) => r.pass);
  const unseen = byFile.filter((f) => f.progress.accounted === 0).map((f) => f.path);
  emit(ctx.io, {
    context,
    repo: true,
    pass,
    trust: "advisory-unsigned",
    coverage: coverageSummary(progress, cmd.requirements),
    requirements,
    progress,
    ...(cmd.byFile
      ? { byFile: byFile.map((f) => ({ path: f.path, coverage: coverageSummary(f.progress, cmd.requirements) })), unseen }
      : {}),
    next: gateNext(cmd.requirements.length, pass, requirements.filter((r) => !r.pass)),
  });
  if (!pass) throw new GateNotMetError(failSummary(requirements.filter((r) => !r.pass)));
}

/** The slice of the service the gate uses — read-only coverage views. */
type ReviewBackend = Awaited<ReturnType<typeof composeCore>>["service"];

/** Atoms credited to a role over the master list: overall, by tier footprint/scrutiny, or by reviewer label. */
function roleCount(progress: ReviewProgress, role: string): number {
  switch (role) {
    case "addressed":
      return progress.addressed;
    case "accounted":
      return progress.accounted;
    case "human":
    case "agent":
      return progress.scrutiny.find((s) => s.tier === role)?.accounted ?? 0;
    case "human:commented":
    case "agent:commented":
      return progress.scrutiny.find((s) => s.tier === role.slice(0, role.indexOf(":")))?.commented ?? 0;
    default:
      return progress.byReviewer?.find((r) => r.reviewer === role)?.addressed ?? 0;
  }
}

/** Exact ratio comparison (no float rounding): met/total ≥ threshold/100, vacuously true on an empty diff. */
function evaluate(req: GateRequirement, progress: ReviewProgress): RequirementResult {
  const met = roleCount(progress, req.role);
  const total = progress.total;
  return {
    role: req.role,
    threshold: req.threshold,
    percent: percentOf(met, total),
    met,
    total,
    pass: total === 0 || met * 100 >= req.threshold * total,
  };
}

/** A flat role→percent readout: the standard roles, every labelled reviewer, and any required role. */
function coverageSummary(progress: ReviewProgress, requirements: readonly GateRequirement[]): Record<string, number> {
  const roles = new Set<string>(["addressed", "accounted", "human", "agent"]);
  for (const reviewer of progress.byReviewer ?? []) roles.add(reviewer.reviewer);
  for (const req of requirements) roles.add(req.role);
  const out: Record<string, number> = {};
  for (const role of roles) out[role] = percentOf(roleCount(progress, role), progress.total);
  return out;
}

/** Coverage percent for display (rounded); an empty diff is vacuously 100%. */
function percentOf(met: number, total: number): number {
  return total === 0 ? 100 : Math.round((met / total) * 100);
}

function failSummary(failed: readonly RequirementResult[]): string {
  return `Review gate not met: ${failed.map((r) => `${r.role} ${r.percent}% < ${r.threshold}%`).join(", ")}.`;
}

function gateNext(required: number, pass: boolean, failed: readonly RequirementResult[]): string {
  if (required === 0) return NEXT.gateReadout;
  return pass ? NEXT.gatePass : NEXT.gateFail(failed.map((r) => r.role));
}
