// Marking + focus glue between the keyboard / surface and the store. DOM-free. Marks are
// per-atom on the wire (ADR-0004) — a whole-Section mark is just every atom marked, issued
// sequentially so out-of-order snapshot replies can't overwrite each other. After any mark
// the Section's state is re-derived canonically; once it leaves "unreviewed", focus
// auto-advances to the next unreviewed Section (the block-by-block and whole-Section paths
// converge here).

import type { Atom, Disposition } from "../protocol.ts";
import { marksMap, sectionRollup } from "../selectors.ts";
import type { AppState, AppStore, SectionPath } from "../store.ts";
import { nextSection, nextUnreviewedSection, prevSection, sectionAt } from "../navigation.ts";

/** Focus a Section: make it active and expand its Chapter if collapsed (never collapse). */
export function focusSection(store: AppStore, path: SectionPath): void {
  store.setActiveSection(path);
  if (!store.getState().expandedChapters.has(path.chapter)) store.toggleChapter(path.chapter);
}

/** `j`/`k`: move focus to the adjacent Section in flat order (clamped). */
export function moveFocus(store: AppStore, direction: "next" | "prev"): void {
  const state = store.getState();
  if (state.snapshot === null || state.activeSection === null) return;
  const target = (direction === "next" ? nextSection : prevSection)(state.snapshot, state.activeSection);
  if (target !== null) focusSection(store, target);
}

/** Move to the next still-unreviewed Section after `from`, if any remain. */
function autoAdvance(store: AppStore, from: SectionPath): void {
  const snapshot = store.getState().snapshot;
  if (snapshot === null) return;
  const target = nextUnreviewedSection(snapshot, from);
  if (target !== null) focusSection(store, target);
}

/** True when focus still rests on `path` — the marks ran without the user navigating away. */
function focusStillOn(store: AppStore, path: SectionPath): boolean {
  const active = store.getState().activeSection;
  return active !== null && active.chapter === path.chapter && active.section === path.section;
}

function activeSectionAtoms(
  state: AppState,
): { path: SectionPath; atoms: readonly Atom[]; marks: ReturnType<typeof marksMap> } | null {
  if (state.snapshot === null || state.activeSection === null) return null;
  const section = sectionAt(state.snapshot, state.activeSection);
  if (section === null) return null;
  return { path: state.activeSection, atoms: section.atoms, marks: marksMap(state.snapshot) };
}

/** Mark every atom of the focused Section to `disposition` (skipping no-op atoms), then advance. */
async function markActiveSection(store: AppStore, disposition: Disposition): Promise<void> {
  const active = activeSectionAtoms(store.getState());
  if (active === null) return;
  for (const atom of active.atoms) {
    if (active.marks.get(atom.hash) !== disposition) await store.mark(atom.hash, disposition);
  }
  // The marks are async; if the user selected another Section meanwhile, that newer focus
  // wins — auto-advance must not clobber it. Only advance when focus is still on the marked
  // Section.
  if (focusStillOn(store, active.path)) autoAdvance(store, active.path);
}

/** `D`: mark the focused Section done and advance. */
export function markSectionDone(store: AppStore): Promise<void> {
  return markActiveSection(store, "done");
}

/** `S`: skip the focused Section (skip ≠ delete) and advance. */
export function skipSection(store: AppStore): Promise<void> {
  return markActiveSection(store, "skipped");
}

/** Tick / un-tick a whole file's changes: done when every atom is done; one click flips them all. */
export async function toggleFile(store: AppStore, atoms: readonly Atom[]): Promise<void> {
  const before = store.getState();
  if (before.snapshot === null || before.activeSection === null) return;
  const marks = marksMap(before.snapshot);
  const allDone = atoms.every((atom) => marks.get(atom.hash) === "done");
  const active = before.activeSection;

  // Marks are per-atom on the wire (ADR-0004); a file toggle is just every atom marked, issued
  // sequentially so out-of-order snapshot replies can't overwrite each other.
  for (const atom of atoms) {
    if (allDone) {
      await store.unmark(atom.hash);
    } else if (marks.get(atom.hash) !== "done") {
      await store.mark(atom.hash, "done");
    }
  }

  // Re-read after the marks: completion is judged on the fresh snapshot, but still for the
  // Section we acted on (a mark never regroups, so the path stays valid).
  const after = store.getState().snapshot;
  if (after === null) return;
  const section = sectionAt(after, active);
  if (
    section !== null &&
    sectionRollup(section, marksMap(after)).state !== "unreviewed" &&
    focusStillOn(store, active)
  ) {
    autoAdvance(store, active);
  }
}
