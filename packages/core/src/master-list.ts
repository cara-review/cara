// The master list (ADR-0004): the canonical atom set, computed deterministically
// from the diff with zero agent involvement. Counts and completion derive from
// this, never from the (untrusted) grouping.

import type { Atom, RawHunk } from "./model.ts";
import { hashAtom } from "./identity.ts";

/**
 * Map RawHunks to Atoms, preserving git order. The DiffSource yields hunks in
 * file-then-position order; that order is the atoms' permanent order (ADR-0002).
 *
 * Hunks with byte-identical payload and path collapse to the same hash (one
 * identity), but each is kept as a distinct list entry so the change's surface
 * area is counted in full; placement is tracked by index, not hash (see grouping).
 */
export function buildMasterList(hunks: readonly RawHunk[]): Atom[] {
  return hunks.map((hunk) => ({ ...hunk, hash: hashAtom(hunk) }));
}
