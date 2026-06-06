// @clear-diff/node — driven adapters + HTTP/WS server + composition root.
// Stub: depends on core to prove the dependency direction (node → core).
import { PACKAGE_ID as CORE_ID } from "@clear-diff/core";

export const PACKAGE_ID = "@clear-diff/node";

// Scaffold wiring probe: proves node resolves core across the workspace boundary.
export function corePackageId(): string {
  return CORE_ID;
}
