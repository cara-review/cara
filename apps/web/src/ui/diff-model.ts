// Pure transform: a Section's atoms → per-file groups, the unit the Monaco surface renders one
// diff editor per (ADR-0006). DOM-free and unit-tested. Consecutive atoms of the same file form
// one group; a non-consecutive recurrence opens a fresh card. The group carries the file's change
// status and a rename's previous path for its header. Adapter words ("hunk") never leak — a group
// is just a file's changed lines within this Section.

import type { Atom, ChangeStatus, Section } from "../protocol.ts";

export interface FileGroup {
  readonly path: string;
  readonly status: ChangeStatus;
  readonly previousPath: string | null;
  readonly atoms: readonly Atom[];
}

interface MutableGroup {
  path: string;
  status: ChangeStatus;
  previousPath: string | null;
  atoms: Atom[];
}

/** Group a Section's atoms into per-file cards (by consecutive path). */
export function groupByFile(section: Section): readonly FileGroup[] {
  const groups: MutableGroup[] = [];
  let current: MutableGroup | null = null;

  for (const atom of section.atoms) {
    if (current === null || current.path !== atom.path) {
      current = { path: atom.path, status: atom.status, previousPath: atom.previousPath, atoms: [atom] };
      groups.push(current);
      continue;
    }
    current.atoms.push(atom);
  }

  return groups;
}
