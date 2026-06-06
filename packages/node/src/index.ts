// @clear-diff/node — driven adapters + HTTP/WS server + composition root.
// Stub: depends on core to prove the dependency direction (node → core).
import { buildMasterList, type RawHunk } from "@clear-diff/core";

export { JsonlReviewStore } from "./review-store.ts";

export const PACKAGE_ID = "@clear-diff/node";

// Scaffold wiring probe: proves node resolves core across the workspace boundary.
export function coreAtomCount(hunks: readonly RawHunk[]): number {
  return buildMasterList(hunks).length;
}
