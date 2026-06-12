import type { ClockPort } from "@cara/core";

/** Wall-clock time in epoch milliseconds. */
export class SystemClock implements ClockPort {
  now(): number {
    return Date.now();
  }
}

/** A ClockPort frozen at `ms`, for deterministic tests. */
export function fixedClock(ms: number): ClockPort {
  return { now: () => ms };
}
