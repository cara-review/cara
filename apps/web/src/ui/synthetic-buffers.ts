// Pure transform: the two text buffers Monaco diffs for one file in a Section (ADR-0006).
// modified = the real head file. original = head with only THIS Section's atoms reverted to
// their base text, so only those atoms differ; every other change stays identical on both
// sides and folds away via Monaco's hideUnchangedRegions. DOM-free and unit-tested; the
// Monaco glue calls this per file group. The synthetic original is a render input only —
// never persisted, never sent to the core.

import type { Atom } from "../protocol.ts";

const baseLines = (atom: Atom): string[] =>
  atom.lines.filter((line) => line.kind === "removed").map((line) => line.text);

/**
 * Head text with `atoms` reverted to their base content. All `atoms` must belong to one file.
 * Reverted bottom-up (descending `newStart`) so each splice leaves earlier indices valid.
 * An atom's head footprint is `[newStart, newStart + newLines - 1]`; a pure deletion has
 * `newLines === 0` and occupies no head line, so its base lines reinsert after head line
 * `newStart` (git `-U0`: `@@ -5,2 +4,0 @@`), matching diff-model's convention.
 */
export function revertAtoms(headText: string, atoms: readonly Atom[]): string {
  const lines = headText === "" ? [] : headText.split("\n");
  for (const atom of [...atoms].sort((a, b) => b.newStart - a.newStart)) {
    if (atom.newLines === 0) lines.splice(atom.newStart, 0, ...baseLines(atom));
    else lines.splice(atom.newStart - 1, atom.newLines, ...baseLines(atom));
  }
  return lines.join("\n");
}

export interface DiffBuffers {
  /** Left side: head with only this Section's hunks reverted to base. */
  readonly original: string;
  /** Right side: the real head file. */
  readonly modified: string;
}

/** The two buffers Monaco diffs for one file in a Section: only `atoms` read as changes. */
export function syntheticBuffers(headText: string, atoms: readonly Atom[]): DiffBuffers {
  return { original: revertAtoms(headText, atoms), modified: headText };
}
