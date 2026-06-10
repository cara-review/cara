// Deterministic grouping repair (ADR-0004).
//
// The agent's grouping is the most untrusted input in the system: it may
// describe and arrange, never define or alter the change. So this takes the
// raw proposal as `unknown` and repairs it into a Review that satisfies the
// bijection invariant — the union of all sections equals the master list,
// exactly. The agent cannot add, remove, hide, or duplicate an atom.
//
// Bijection is tracked over master-list *indices*, not hashes, so two atoms
// with identical payload stay distinct (each index is placed exactly once).
// A garbage proposal degrades to "git order, weak chapters": everything sweeps
// into a single trailing "Other changes" chapter (the ADR-0002 floor).
//
// Intended (untrusted) proposal shape the agent adapter targets:
//   { chapters: [{ title?, summary?, sections: [{ title?, summary?, atomHashes: string[] }] }] }
// Anything else is coerced defensively; missing/malformed pieces are dropped.

import type { Atom, Chapter, Review, Section } from "./model.ts";

const OTHER_CHANGES = "Other changes";

// Shape coercion shared with the summary gate (findMissingSummaries) so "blank" means
// identically the same thing in both — one parser, no drift (ADR-0012 §1).
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function title(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : fallback;
}

/** A summary present and non-blank, else null. The single coercion both repair and the gate use. */
function summary(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

/** A chapter (and optionally one of its sections) whose summary is absent or blank (ADR-0012 §1). */
export interface MissingSummary {
  /** 0-based index in the proposed `chapters` array. */
  readonly chapter: number;
  /** 0-based index in the chapter's `sections` array, or null for the chapter's own summary. */
  readonly section: number | null;
}

/**
 * Summaries are mandatory (ADR-0012 §1): walk the raw proposal (pre-repair, so the
 * engine-swept "Other changes" chapter is never in scope) and list every chapter and
 * section lacking a non-empty summary. Shares the shape coercion with `repairGrouping`,
 * so "blank" is defined once. Malformed (non-object) chapters/sections are skipped — repair
 * drops them, so they raise no summary gap.
 */
export function findMissingSummaries(proposed: unknown): readonly MissingSummary[] {
  const missing: MissingSummary[] = [];
  asArray(asRecord(proposed)?.["chapters"]).forEach((rawChapter, chapterIndex) => {
    const chapter = asRecord(rawChapter);
    if (!chapter) return;
    if (summary(chapter["summary"]) === null) missing.push({ chapter: chapterIndex, section: null });
    asArray(chapter["sections"]).forEach((rawSection, sectionIndex) => {
      const section = asRecord(rawSection);
      if (!section) return;
      if (summary(section["summary"]) === null) missing.push({ chapter: chapterIndex, section: sectionIndex });
    });
  });
  return missing;
}

/**
 * Thrown by `presentGrouping` when an agent-authored grouping omits a required summary
 * (ADR-0012 §1). Carries the missing list so the adapter can tell the agent exactly what to
 * add. The git-order floor opts out (`requireSummaries: false`) and never raises this.
 */
export class SummariesRequiredError extends Error {
  readonly missing: readonly MissingSummary[];
  constructor(missing: readonly MissingSummary[]) {
    super(`Grouping is missing ${missing.length} required summar${missing.length === 1 ? "y" : "ies"}.`);
    this.name = "SummariesRequiredError";
    this.missing = missing;
  }
}

/** Repair an untrusted proposal against the canonical master list. */
export function repairGrouping(masterList: readonly Atom[], proposed: unknown): Review {
  // Available master indices per hash, ascending — the claim queue.
  const available = new Map<string, number[]>();
  masterList.forEach((atom, index) => {
    const queue = available.get(atom.hash);
    if (queue) queue.push(index);
    else available.set(atom.hash, [index]);
  });

  const placed = new Array<boolean>(masterList.length).fill(false);

  /** Claim the lowest still-unplaced index for a hash, or null if none remain. */
  const claim = (hash: string): number | null => {
    const index = available.get(hash)?.shift();
    if (index === undefined) return null;
    placed[index] = true;
    return index;
  };

  const root = asRecord(proposed);
  const proposedChapters = asArray(root?.["chapters"]);

  const chapters: Chapter[] = [];
  for (const rawChapter of proposedChapters) {
    const chapter = asRecord(rawChapter);
    if (!chapter) continue;

    const sections: Section[] = [];
    for (const rawSection of asArray(chapter["sections"])) {
      const section = asRecord(rawSection);
      if (!section) continue;

      const indices: number[] = [];
      for (const rawHash of asArray(section["atomHashes"])) {
        if (typeof rawHash !== "string") continue; // unknown / malformed reference dropped
        const index = claim(rawHash);
        if (index !== null) indices.push(index);
      }
      if (indices.length === 0) continue; // drop empty section

      indices.sort((a, b) => a - b); // atoms always git order
      sections.push({
        title: title(section["title"], "Untitled section"),
        summary: summary(section["summary"]),
        atoms: indices.map((i) => masterList[i] as Atom),
      });
    }
    if (sections.length === 0) continue; // drop empty chapter

    chapters.push({
      title: title(chapter["title"], "Untitled chapter"),
      summary: summary(chapter["summary"]),
      sections,
    });
  }

  // Sweep every unplaced atom into a trailing "Other changes" chapter, git order.
  const unplaced = masterList.filter((_, index) => !placed[index]);
  if (unplaced.length > 0) {
    chapters.push({
      title: OTHER_CHANGES,
      summary: null,
      sections: [{ title: OTHER_CHANGES, summary: null, atoms: unplaced }],
    });
  }

  return { chapters, masterList };
}
