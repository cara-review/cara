// Section-level navigation over a snapshot — pure, DOM-free, unit-tested. Focus is an
// index path (chapter, section) within the current grouping; these helpers flatten that
// grouping into a single ordered list so `j`/`k` and auto-advance can walk it. Marks are
// canonical (ADR-0004): "reviewed" derives from `sectionRollup`, never a grouping flag.

import type { ReviewSnapshot, Section } from "./protocol.ts";
import { marksMap, sectionRollup } from "./selectors.ts";
import type { SectionPath } from "./store.ts";

/** Every Section as a flat, ordered list of paths (chapter-major). */
export function flatSectionPaths(snapshot: ReviewSnapshot): readonly SectionPath[] {
  return snapshot.review.chapters.flatMap((chapter, chapterIndex) =>
    chapter.sections.map((_, sectionIndex) => ({ chapter: chapterIndex, section: sectionIndex })),
  );
}

/** The Section a path points at, or null if the path is stale. */
export function sectionAt(snapshot: ReviewSnapshot, path: SectionPath): Section | null {
  return snapshot.review.chapters[path.chapter]?.sections[path.section] ?? null;
}

function indexOf(paths: readonly SectionPath[], path: SectionPath): number {
  return paths.findIndex((p) => p.chapter === path.chapter && p.section === path.section);
}

/** The next Section in flat order, clamped at the end (no wrap); null if none/stale. */
export function nextSection(snapshot: ReviewSnapshot, from: SectionPath): SectionPath | null {
  const paths = flatSectionPaths(snapshot);
  const here = indexOf(paths, from);
  if (here === -1) return null;
  return paths[Math.min(here + 1, paths.length - 1)] ?? null;
}

/** The previous Section in flat order, clamped at the start (no wrap); null if none/stale. */
export function prevSection(snapshot: ReviewSnapshot, from: SectionPath): SectionPath | null {
  const paths = flatSectionPaths(snapshot);
  const here = indexOf(paths, from);
  if (here === -1) return null;
  return paths[Math.max(here - 1, 0)] ?? null;
}

/**
 * The next Section still unreviewed, scanning forward from `from` and wrapping once.
 * `from` itself is excluded so a just-marked Section doesn't re-select itself. Returns
 * null when every Section is accounted for (done or skipped).
 */
export function nextUnreviewedSection(
  snapshot: ReviewSnapshot,
  from: SectionPath,
): SectionPath | null {
  const paths = flatSectionPaths(snapshot);
  const here = indexOf(paths, from);
  if (here === -1) return null;
  const marks = marksMap(snapshot);
  for (let step = 1; step < paths.length; step += 1) {
    const path = paths[(here + step) % paths.length];
    if (path === undefined) continue;
    const section = sectionAt(snapshot, path);
    if (section !== null && sectionRollup(section, marks).state === "unreviewed") return path;
  }
  return null;
}
