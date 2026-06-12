// `clear-diff gate` (ADR-0013): the ledger IS the gate. A read-only plumbing verb that
// recomputes live coverage over the canonical master list (the bijection is the
// denominator — ADR-0004) folded with the committed ledger, evaluates `--require` role
// predicates, and exits non-zero when the bar is not met. CI gates on a content-pinned,
// role-attributed fact instead of a marker file (TN-26-031). LLM-free, no key.
//
// Roles a predicate may name:
//   addressed   — atoms with any disposition (done/skipped)        / total
//   accounted   — atoms dispositioned OR commented                 / total
//   human|agent — that tier's accounted footprint (TN-26-029)      / total
//   <tier>:commented — atoms that tier commented on (substance, not a bare sweep) / total
//   <label>     — atoms a labelled reviewer dispositioned          / total
// Coverage is exact (met/total ≥ threshold/100), vacuously met on an empty diff.

import type { ReviewProgress } from "@clear-diff/core";
import { UserFacingError } from "../user-facing-error.ts";
import { composeCore } from "../server/compose.ts";
import { coreConfig, type VerbContext } from "./verbs.ts";
import { emit, NEXT } from "./output.ts";
import type { GateCommand, GateRequirement } from "./parse.ts";

/** Gate not met — an expected outcome (the bar wasn't cleared), surfaced as a non-zero exit. */
export class GateNotMetError extends UserFacingError {}

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
  // Read-only: `dispatch` recomputes the live master list and folds the ledger into
  // `progress` — the coverage numbers. The gate adds only policy (predicates + exit code).
  const { context, progress } = await service.dispatch(cmd.spec);

  const requirements = cmd.requirements.map((req) => evaluate(req, progress));
  const pass = requirements.every((r) => r.pass);
  const failed = requirements.filter((r) => !r.pass);

  emit(ctx.io, {
    context,
    pass,
    coverage: coverageSummary(progress, cmd.requirements),
    requirements,
    progress,
    next: gateNext(cmd.requirements.length, pass, failed),
  });

  if (!pass) {
    throw new GateNotMetError(
      `Review gate not met: ${failed.map((r) => `${r.role} ${r.percent}% < ${r.threshold}%`).join(", ")}.`,
    );
  }
}

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

function gateNext(required: number, pass: boolean, failed: readonly RequirementResult[]): string {
  if (required === 0) return NEXT.gateReadout;
  return pass ? NEXT.gatePass : NEXT.gateFail(failed.map((r) => r.role));
}
