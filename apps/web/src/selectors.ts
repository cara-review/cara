// Pure derivations over a ReviewSnapshot. No DOM, no state — unit-tested directly.
//
// Mark state always derives from the canonical marks (keyed by atom hash, ADR-0004),
// never from grouping-held flags. A Section's change count is its atom count: after
// repair the grouping partitions the master list, so section counts roll up to the
// canonical total (the headline progress still reads from `snapshot.progress`).

import type { AtomHash, Disposition, ReviewSnapshot, Section } from "./protocol.ts";

export type SectionState = "unreviewed" | "done" | "skipped";

/** The snapshot's marks array as a hash→disposition map. */
export function marksMap(snapshot: ReviewSnapshot): Map<AtomHash, Disposition> {
  const marks = new Map<AtomHash, Disposition>();
  for (const mark of snapshot.marks) marks.set(mark.atomHash, mark.disposition);
  return marks;
}

export interface SectionRollup {
  readonly state: SectionState;
  readonly total: number;
  readonly addressed: number;
}

/**
 * Roll a Section's changes up to a single state + progress from the canonical marks.
 * Incomplete (any change unaddressed) → unreviewed; complete & all skipped → skipped;
 * otherwise done. `addressed`/`total` back the partly-reviewed reading.
 */
export function sectionRollup(
  section: Section,
  marks: ReadonlyMap<AtomHash, Disposition>,
): SectionRollup {
  const total = section.atoms.length;
  let addressed = 0;
  let allSkipped = total > 0;
  for (const atom of section.atoms) {
    const disposition = marks.get(atom.hash);
    if (disposition === undefined) {
      allSkipped = false;
      continue;
    }
    addressed += 1;
    if (disposition !== "skipped") allSkipped = false;
  }
  const state: SectionState =
    total === 0 || addressed < total ? "unreviewed" : allSkipped ? "skipped" : "done";
  return { state, total, addressed };
}

export interface SectionNode extends SectionRollup {
  readonly title: string;
  readonly summary: string | null;
}

export interface ChapterNode {
  readonly title: string;
  readonly summary: string | null;
  readonly sections: readonly SectionNode[];
}

/** The nav tree model: chapters → sections with rolled-up state + counts. */
export function navTree(snapshot: ReviewSnapshot): readonly ChapterNode[] {
  const marks = marksMap(snapshot);
  return snapshot.review.chapters.map((chapter) => ({
    title: chapter.title,
    summary: chapter.summary,
    sections: chapter.sections.map((section) => ({
      title: section.title,
      summary: section.summary,
      ...sectionRollup(section, marks),
    })),
  }));
}
