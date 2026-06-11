// SHA-256 of a ReviewContext string: a stable, path-safe per-review key (ADR-0005).
// Shared so the ledger's tree layout and the CLI's per-context state files
// (discovery, grouping, comment export) all key reviews the same way.

import { createHash } from "node:crypto";
import type { ReviewContext } from "@clear-diff/core";

export function contextHash(context: ReviewContext): string {
  return createHash("sha256").update(context).digest("hex");
}
