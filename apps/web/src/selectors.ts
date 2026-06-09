// Pure derivations over a ReviewSnapshot. No DOM, no state — unit-tested directly.
//
// Mark state always derives from the canonical marks (keyed by atom hash, ADR-0004),
// never from grouping-held flags. A Section's change count is its atom count: after
// repair the grouping partitions the master list, so section counts roll up to the
// canonical total (the headline progress still reads from `snapshot.progress`).

import type { AtomHash, Disposition, MarkAuthor, ReviewSnapshot, Section } from "./protocol.ts";

export type SectionState = "unreviewed" | "done" | "skipped";

/** The snapshot's marks array as a hash→disposition map. Used by the diff surface. */
export function marksMap(snapshot: ReviewSnapshot): Map<AtomHash, Disposition> {
  const marks = new Map<AtomHash, Disposition>();
  for (const mark of snapshot.marks) marks.set(mark.atomHash, mark.disposition);
  return marks;
}

interface MarkRecord {
  readonly disposition: Disposition;
  readonly author: MarkAuthor;
}

/** The snapshot's marks array as a hash→{disposition,author} map. Single source for badge derivations. */
function marksWithAuthors(snapshot: ReviewSnapshot): Map<AtomHash, MarkRecord> {
  const map = new Map<AtomHash, MarkRecord>();
  for (const mark of snapshot.marks) map.set(mark.atomHash, { disposition: mark.disposition, author: mark.author });
  return map;
}

/**
 * Derive the agent-badge for a section's marks. Returns non-null only when every marked
 * atom is agent-tier; any human mark (or no marks) yields null. Single-pass over the
 * section's atoms using the combined marks map, so tier and reviewer always come from
 * the same record and cannot desync.
 */
function sectionAgentBadge(
  section: Section,
  marks: ReadonlyMap<AtomHash, MarkRecord>,
): { readonly reviewer: string | null } | null {
  const markedRecords = section.atoms.map((atom) => marks.get(atom.hash)).filter((r) => r !== undefined);
  if (markedRecords.length === 0) return null;
  if (markedRecords.some((r) => r.author.tier !== "agent")) return null;
  const labels = new Set(markedRecords.map((r) => r.author.reviewer));
  return { reviewer: labels.size === 1 ? ([...labels][0] ?? null) : null };
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
  /** Non-null when every marked atom is agent-tier; null for human marks, mixed, or unmarked. */
  readonly agentBadge: { readonly reviewer: string | null } | null;
}

export interface ChapterNode {
  readonly title: string;
  readonly summary: string | null;
  readonly sections: readonly SectionNode[];
}

/** The nav tree model: chapters → sections with rolled-up state + counts + tier badge. */
export function navTree(snapshot: ReviewSnapshot): readonly ChapterNode[] {
  const marks = marksMap(snapshot);
  const withAuthors = marksWithAuthors(snapshot);
  return snapshot.review.chapters.map((chapter) => ({
    title: chapter.title,
    summary: chapter.summary,
    sections: chapter.sections.map((section) => ({
      title: section.title,
      summary: section.summary,
      agentBadge: sectionAgentBadge(section, withAuthors),
      ...sectionRollup(section, marks),
    })),
  }));
}
