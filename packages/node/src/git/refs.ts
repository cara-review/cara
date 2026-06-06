// Resolve a DiffSpec to the two git refs the adapters read from. Shared so
// DiffSource and WorkspaceReader agree on what "base" and "head" mean for a
// given review. The trunk a worktree is reviewed against is `origin/main`.

import type { DiffSpec } from "@clear-diff/core";

/** A side of the diff in git terms: a committed revision, or the live worktree. */
export type GitRef = { readonly kind: "rev"; readonly rev: string } | { readonly kind: "worktree" };

export interface SpecRefs {
  readonly base: GitRef;
  readonly head: GitRef;
}

const TRUNK = "origin/main";

/** Map a DiffSpec to its base/head git refs. Throws for PR specs (not yet supported). */
export function refsForSpec(spec: DiffSpec): SpecRefs {
  switch (spec.kind) {
    case "worktree":
      return { base: { kind: "rev", rev: TRUNK }, head: { kind: "worktree" } };
    case "range":
      return { base: { kind: "rev", rev: spec.base }, head: { kind: "rev", rev: spec.head } };
    case "pr":
      throw new Error("PR diffs not yet supported");
  }
}
