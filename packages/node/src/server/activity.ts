// Server-side UI-activity tracker (TN-26-027 Risk seam #2, ADR-0011 §4).
//
// `dispatch --wait` lets a CLI agent block until the human finishes. The server
// is the only place that sees the human's live activity (WS marks/comments) and
// their explicit "done" signal, so it owns the tracker. ClockPort-backed: the
// tracker never reads the wall clock itself, so the three-state decision is
// deterministic under a fixed clock in tests. One tracker per server (a server
// reviews exactly one context).

import type { ClockPort } from "@clear-diff/core";

export interface ReviewActivity {
  /** Bump the last-activity timestamp — call on every inbound mutation. */
  touch(): void;
  /** Record the human's explicit "done reviewing" signal. */
  complete(): void;
  readonly state: () => { readonly lastActivityTs: number; readonly completed: boolean };
}

export function createReviewActivity(clock: ClockPort): ReviewActivity {
  let lastActivityTs = clock.now();
  let completed = false;
  return {
    touch() {
      lastActivityTs = clock.now();
    },
    complete() {
      completed = true;
    },
    state: () => ({ lastActivityTs, completed }),
  };
}

/** The terminal state of a `dispatch --wait`, or `pending` to keep blocking. */
export type WaitDecision = "done" | "reviewIdle" | "reviewInProgress" | "pending";

/**
 * Pure three-state decision (TN-26-027 §b). `done` once the human signals complete;
 * `reviewIdle` after no activity for `idleMs` (stop polling, the human walked away);
 * `reviewInProgress` once the block window `maxBlockMs` elapses with activity still
 * live (re-poll). All time comparisons take an injected `now`, never the wall clock.
 */
export function classifyWait(args: {
  readonly completed: boolean;
  readonly lastActivityTs: number;
  readonly now: number;
  readonly startTs: number;
  readonly idleMs: number;
  readonly maxBlockMs: number;
}): WaitDecision {
  if (args.completed) return "done";
  if (args.now - args.lastActivityTs >= args.idleMs) return "reviewIdle";
  if (args.now - args.startTs >= args.maxBlockMs) return "reviewInProgress";
  return "pending";
}
